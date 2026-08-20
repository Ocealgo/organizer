/**
 * "I cannot get in — tell somebody who can help."
 *
 * A rep who has forgotten their password cannot sign in, so this is the one
 * thing in the app that has to work with no account behind it. That makes it
 * the only public write surface here, and it is shaped accordingly.
 *
 * Who is told is not configured anywhere new. `MAY_RESET` already says which
 * roles may reset which, so the audience for a request is simply everyone
 * whose role is allowed to act on it — a super admin hears about an admin, an
 * admin hears about a manager, a manager hears about an officer. One list, so
 * the people notified can never drift from the people permitted.
 *
 * It cannot be used to find out who has an account. A number nobody uses and a
 * number belonging to the managing director produce byte-for-byte the same
 * answer, the same way resolveLogin does — otherwise this becomes a tool for
 * enumerating staff ten digits at a time.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')

const REGION = 'asia-south1'
const INDIAN_MOBILE = /^[6-9]\d{9}$/

/** Mirrors MAY_RESET in index.js, inverted: who may act on this person. */
const MAY_RESET = {
  super_admin: ['admin', 'sales_manager', 'offline_sales', 'online_sales',
    'offline_marketing', 'online_marketing'],
  admin: ['sales_manager', 'offline_sales', 'online_sales',
    'offline_marketing', 'online_marketing'],
  sales_manager: ['offline_sales', 'online_sales'],
}

const ROLE_LABEL = {
  super_admin: 'Super admin', admin: 'Admin', sales_manager: 'Sales manager',
  offline_sales: 'Sales officer', online_sales: 'Online sales',
  offline_marketing: 'Marketing', online_marketing: 'Online marketing',
}

/** Every role permitted to reset somebody of this role. */
function rolesWhoCanHelp(targetRole) {
  return Object.keys(MAY_RESET).filter(r => MAY_RESET[r].includes(targetRole))
}

exports.requestPasswordReset = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const phone = String(request.data?.phone ?? '').trim()

    // A malformed number is the caller's own mistake and is safe to name — it
    // cannot be used to probe for accounts.
    if (!INDIAN_MOBILE.test(phone)) {
      throw new HttpsError('invalid-argument', 'Not a valid Indian mobile number.')
    }

    const db = getFirestore()

    try {
      const authUser = await getAuth().getUserByPhoneNumber(`+91${phone}`)
      const snap = await db.doc(`users/${authUser.uid}`).get()
      if (!snap.exists) return { ok: true }

      const user = snap.data()
      if (user.status !== 'approved') return { ok: true }

      // One open request per person. Somebody pressing the button five times
      // should not put five rows in front of their manager, or five
      // notifications on their phone.
      const existing = await db.collection('password_requests')
        .where('uid', '==', authUser.uid)
        .where('status', '==', 'open')
        .limit(1)
        .get()
      if (!existing.empty) return { ok: true }

      const helpers = rolesWhoCanHelp(user.role)
      if (helpers.length === 0) return { ok: true }

      const req = await db.collection('password_requests').add({
        uid: authUser.uid,
        name: user.name ?? '',
        role: user.role,
        // Stored so the queue can be read without a second lookup per row, and
        // so a rules read can be scoped by it.
        helperRoles: helpers,
        status: 'open',
        requestedAt: Date.now(),
        createdAt: FieldValue.serverTimestamp(),
      })

      // The alert collection is already the notification queue — the bell
      // reads it and a trigger pushes it — so this needs no delivery of its
      // own. `admin_group` covers admins and managers holding view_reports;
      // the request row itself is what scopes it exactly.
      await db.collection('alerts').add({
        type: 'password_reset_requested',
        message: `${user.name || 'Somebody'} (${ROLE_LABEL[user.role] || user.role}) cannot sign in and has asked for a password reset`,
        relatedId: req.id,
        toRole: 'admin_group',
        read: false,
        createdAt: Date.now(),
      })

      return { ok: true }
    } catch {
      // A number nobody uses looks exactly like one that worked.
      return { ok: true }
    }
  },
)

/**
 * Close any open request for somebody whose password was just reset, and say
 * who dealt with it.
 *
 * Called from adminResetPassword rather than being its own action: the request
 * is answered by the reset actually happening, not by somebody ticking it off.
 * Anything else lets a queue disagree with reality.
 */
exports.resolveOpenRequests = async function (db, targetUid, handler) {
  const open = await db.collection('password_requests')
    .where('uid', '==', targetUid)
    .where('status', '==', 'open')
    .get()
  if (open.empty) return

  for (const doc of open.docs) {
    const req = doc.data()
    await doc.ref.update({
      status: 'done',
      handledBy: handler.uid,
      handledByName: handler.name,
      handledAt: Date.now(),
    })

    // Tell the same audience who dealt with it, so nobody else picks up a job
    // that is finished — and mark the original read so the unread badge
    // clears rather than sitting there pointing at nothing.
    await db.collection('alerts').add({
      type: 'password_reset_requested',
      message: `${handler.name} reset the password for ${req.name || 'a colleague'} — nothing more to do`,
      relatedId: doc.id,
      toRole: 'admin_group',
      read: false,
      createdAt: Date.now(),
    })

    const old = await db.collection('alerts')
      .where('relatedId', '==', doc.id)
      .where('read', '==', false)
      .get()
    for (const a of old.docs) {
      if (a.data().type === 'password_reset_requested'
        && a.data().message.includes('cannot sign in')) {
        await a.ref.update({ read: true })
      }
    }
  }
}
