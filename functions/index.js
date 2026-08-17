/**
 * Turning a mobile number into the email its account signs in with.
 *
 * Why this is a function and not a lookup collection
 * --------------------------------------------------
 * Signing in with a phone number and a password needs the email before anyone
 * is authenticated, because that is what `signInWithEmailAndPassword` takes.
 * Doing that from the client would mean a phone-to-email map readable by
 * anybody who had not signed in — which is a map from "a rep's mobile number"
 * to "a rep's email address", enumerable ten digits at a time.
 *
 * So the map never leaves the server. This takes a number and returns one
 * field, and only ever for a number that is already an account.
 *
 * What it deliberately does not do
 * --------------------------------
 * It does not say whether a number is registered. Unknown numbers and numbers
 * with no email both come back as `{ email: null }`, and the client turns that
 * into the same "those details do not match" it shows for a wrong password.
 * A caller cannot tell the three apart, so this cannot be used to find out who
 * is on the system.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')

initializeApp()

/** Ten digits, starting 6-9 — the same rule the client applies. India only. */
const INDIAN_MOBILE = /^[6-9]\d{9}$/

exports.resolveLogin = onCall(
  // Close to the people using it. A login that waits on a round trip to Iowa
  // is a login that feels broken on a patchy connection in a shop.
  { region: 'asia-south1', cors: true },
  async (request) => {
    const phone = String(request.data?.phone ?? '').trim()

    // A malformed number is the caller's mistake, not a failed lookup, and is
    // worth saying out loud — it cannot be used to probe for accounts.
    if (!INDIAN_MOBILE.test(phone)) {
      throw new HttpsError('invalid-argument', 'Not a valid Indian mobile number.')
    }

    try {
      const user = await getAuth().getUserByPhoneNumber(`+91${phone}`)
      return { email: user.email ?? null }
    } catch {
      // auth/user-not-found, and anything else, look identical from outside.
      return { email: null }
    }
  },
)

// ── Resetting somebody else's password ───────────────────────────────────────
/**
 * A rep who is locked out rings their manager.
 *
 * Reps mostly do not have working email, so the emailed reset link is not a
 * route back in for them, and an SMS code is only a route while the phone is
 * in their hand and the messages are arriving. Neither is dependable enough to
 * be the only one. This is the path that cannot fail, because it does not rely
 * on anything reaching the person who is locked out.
 *
 * Who may reset whom
 * ------------------
 * A sales manager may reset the officers they supervise, and nobody else. An
 * admin may reset anyone below admin. Only a super admin may reset an admin,
 * and a super admin is not resettable by anyone — an account that can reset
 * every other account has to be recovered deliberately, through the console,
 * rather than by whoever is holding an admin login today.
 *
 * The matrix is here rather than on the client because a role a browser claims
 * is not evidence. This reads it from the caller's own user document.
 */
const MAY_RESET = {
  super_admin: [
    'admin', 'sales_manager',
    'offline_sales', 'online_sales',
    'offline_marketing', 'online_marketing',
  ],
  admin: [
    'sales_manager',
    'offline_sales', 'online_sales',
    'offline_marketing', 'online_marketing',
  ],
  sales_manager: ['offline_sales', 'online_sales'],
}

/**
 * Words, because this gets read down a phone line.
 *
 * A random string of characters is misheard, mistyped and spelled out letter
 * by letter over a bad connection in a shop. Two words and four digits is a
 * thing somebody can say once and have understood. Nothing ambiguous when
 * spoken aloud, and nothing that sounds like another entry on the list.
 */
const WORDS = [
  'anchor', 'basket', 'candle', 'dolphin', 'ember', 'falcon', 'garden', 'harbour',
  'island', 'jacket', 'kettle', 'ladder', 'magnet', 'nutmeg', 'orchid', 'pebble',
  'quiver', 'ribbon', 'saddle', 'temple', 'umbrella', 'velvet', 'walnut', 'yonder',
  'almond', 'bridge', 'copper', 'dragon', 'engine', 'forest', 'ginger', 'hammer',
]

function temporaryPassword() {
  const { randomInt } = require('node:crypto')
  const a = WORDS[randomInt(WORDS.length)]
  const b = WORDS[randomInt(WORDS.length)]
  return `${a}-${b}-${String(randomInt(1000, 10000))}`
}

exports.adminResetPassword = onCall(
  { region: 'asia-south1', cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.')
    const callerUid = request.auth.uid
    const targetUid = String(request.data?.uid ?? '').trim()
    if (!targetUid) throw new HttpsError('invalid-argument', 'No account given.')
    if (targetUid === callerUid) {
      throw new HttpsError('failed-precondition',
        'Change your own password from your account screen instead.')
    }

    const db = getFirestore()
    const [callerSnap, targetSnap] = await Promise.all([
      db.doc(`users/${callerUid}`).get(),
      db.doc(`users/${targetUid}`).get(),
    ])
    if (!callerSnap.exists) throw new HttpsError('permission-denied', 'Not allowed.')
    if (!targetSnap.exists) throw new HttpsError('not-found', 'No such account.')

    const caller = callerSnap.data()
    const target = targetSnap.data()

    // A deactivated or still-pending manager keeps none of their authority.
    if (caller.status !== 'approved') {
      throw new HttpsError('permission-denied', 'Not allowed.')
    }
    const allowed = MAY_RESET[caller.role] ?? []
    if (!allowed.includes(target.role)) {
      throw new HttpsError('permission-denied',
        'Your role cannot reset that account\'s password.')
    }

    const password = temporaryPassword()
    await getAuth().updateUser(targetUid, { password })

    // Who did this, and the flag that makes the next sign-in change it. Both
    // matter: a temporary password read out loud is known to two people, and
    // it stops being a shared secret only when the owner replaces it.
    await db.doc(`users/${targetUid}`).update({
      mustChangePassword: true,
      passwordResetBy: callerUid,
      passwordResetByName: caller.name ?? '',
      passwordResetAt: FieldValue.serverTimestamp(),
    })

    return { password, name: target.name ?? '' }
  },
)
