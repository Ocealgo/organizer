/**
 * Delivering the alerts the app already writes.
 *
 * Every event this app thinks is worth telling somebody about already writes
 * an `alerts` document, addressed with `toUid` for one person or
 * `toRole: 'admin_group'` for management: leave approved, a week of expenses
 * cleared or sent back, cash collected, a credit limit crossed, a day closed
 * automatically, a shop's pin moved.
 *
 * That collection was a notification queue with one delivery mechanism — a
 * bell inside the app, which only works when the app is already open, which is
 * exactly when nobody needs telling. This is the other half.
 *
 * Nothing here decides what is worth sending. The decision was made where the
 * alert was written, by code that knows what happened; this only finds the
 * device and hands it over. Adding a new kind of alert needs no change here.
 */
const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { getFirestore } = require('firebase-admin/firestore')
const { getMessaging } = require('firebase-admin/messaging')

const REGION = 'asia-south1'

/**
 * Roles that receive anything addressed to the admin group.
 *
 * Must stay identical to `isManagement()` in src/auth/permissions.ts, which is
 * what the in-app bell uses. They disagreed once — this required a manager to
 * also hold view_reports — and the result was a manager who could see an alert
 * on their screen but never got it on their phone, with nothing anywhere
 * explaining the difference. One definition, or the channel decides who hears.
 */
const MANAGEMENT_ROLES = ['admin', 'super_admin', 'sales_manager']

/**
 * Every live token for a set of users.
 *
 * A person is not a device: one rep may have the Android app and an installed
 * web app on the same phone, or a new handset whose old token is still on
 * file. All of them get it; the dead ones are pruned when the send fails.
 */
async function tokensFor(db, uids) {
  if (uids.length === 0) return []
  const out = []
  // `in` takes at most thirty values, and a growing team will pass that.
  for (let i = 0; i < uids.length; i += 30) {
    const snap = await db.collection('push_tokens')
      .where('uid', 'in', uids.slice(i, i + 30))
      .get()
    snap.forEach(d => out.push(d.id))
  }
  return out
}

/** Who an alert is for, resolved to uids. */
async function recipientsFor(db, alert) {
  if (alert.toUid) return [alert.toUid]

  // Untagged means management, the same way the bell reads it — a forgotten
  // tag should reach fewer people rather than everybody. `everyone` is the
  // explicit opt-out of that.
  const wantsEveryone = alert.toRole === 'everyone'

  const users = await db.collection('users').where('status', '==', 'approved').get()
  const uids = []
  users.forEach(d => {
    const u = d.data()
    if (wantsEveryone) { uids.push(d.id); return }
    if (MANAGEMENT_ROLES.includes(u.role)) uids.push(d.id)
  })
  return uids
}

/**
 * Send, and forget the devices that are gone.
 *
 * A token dies when somebody uninstalls, clears their browser, or — on iOS —
 * simply does not open the app for long enough that the system evicts its
 * storage. Left on file they are tried forever; the send result says which
 * ones failed for good, so those are deleted rather than retried tomorrow.
 */
async function sendTo(db, tokens, data) {
  if (tokens.length === 0) return { sent: 0, pruned: 0 }

  const messaging = getMessaging()
  let sent = 0
  let pruned = 0

  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500)
    const res = await messaging.sendEachForMulticast({
      tokens: batch,
      // Data-only on purpose. A `notification` payload is shown by the browser
      // before the service worker runs, so a message carrying both appears
      // twice on some platforms. The worker composes it in one place.
      data,
      android: { priority: 'high' },
      webpush: {
        headers: { Urgency: 'high' },
        fcmOptions: { link: data.url || '/' },
      },
    })

    await Promise.all(res.responses.map(async (r, n) => {
      if (r.success) { sent++; return }
      const code = r.error && r.error.code
      if (code === 'messaging/registration-token-not-registered'
        || code === 'messaging/invalid-registration-token') {
        pruned++
        await db.collection('push_tokens').doc(batch[n]).delete().catch(() => {})
      }
    }))
  }
  return { sent, pruned }
}

/** One line, short enough to survive a notification shade. */
function titleFor(alert) {
  switch (alert.type) {
    case 'leave_approved': return 'Your leave'
    case 'leave_requested': return 'Leave to approve'
    case 'expense_submitted': return 'Expenses'
    case 'credit_settlement': return 'Cash collected'
    case 'credit_limit_exceeded': return 'Past a credit limit'
    case 'duty_auto_closed': return 'A day was left open'
    case 'party_pin_moved': return 'A shop moved'
    case 'new_allocation': return 'New order'
    case 'new_party': return 'New outlet'
    case 'visit_share_requested': return 'A visit to share'
    case 'visit_log_submitted': return 'Visit log submitted'
    default: return 'Ocealgo'
  }
}

exports.pushOnAlert = onDocumentCreated(
  { document: 'alerts/{alertId}', region: REGION },
  async (event) => {
    const alert = event.data && event.data.data()
    if (!alert || !alert.message) return

    const db = getFirestore()
    const uids = await recipientsFor(db, alert)
    if (uids.length === 0) return

    const tokens = await tokensFor(db, uids)
    const result = await sendTo(db, tokens, {
      title: titleFor(alert),
      body: String(alert.message).slice(0, 240),
      tag: `alert-${alert.type || 'general'}`,
      url: '/',
    })
    console.log(`[push] ${alert.type}: ${result.sent} sent, ${result.pruned} pruned`)
  },
)

/**
 * The end-of-day nudge, sent rather than scheduled.
 *
 * The Android build sets a local notification at punch-in and needs none of
 * this. A web app cannot — there is no API that fires at six in the evening
 * with the app closed — so the server watches instead, which also means it
 * reaches somebody whose phone was off when they punched in.
 *
 * Runs on the hour in local time. `REMINDER_HOUR` in src/device/notify.ts is
 * the same eighteen; if one moves, move both.
 */
exports.endOfDayReminder = onSchedule(
  { schedule: '0 18 * * *', timeZone: 'Asia/Kolkata', region: REGION },
  async () => {
    const db = getFirestore()
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

    const open = await db.collection('duty_sessions')
      .where('date', '==', today)
      .where('status', '==', 'active')
      .get()
    if (open.empty) { console.log('[push] nobody still on duty'); return }

    const uids = [...new Set(open.docs.map(d => d.data().uid).filter(Boolean))]
    const tokens = await tokensFor(db, uids)
    const result = await sendTo(db, tokens, {
      title: 'End your day',
      body: 'You are still punched in. Record your closing meter reading before you finish.',
      tag: 'end-of-day',
      url: '/',
    })
    console.log(`[push] end of day: ${uids.length} still out, ${result.sent} sent`)
  },
)
