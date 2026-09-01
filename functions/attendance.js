/**
 * A day nobody started.
 *
 * A rep who never punches in produces silence: no session, no visits, nothing
 * to look at and nobody told. This turns that silence into a record.
 *
 * It marks leave automatically, which is a real decision and worth being
 * honest about: the app does not know the officer was absent. It knows no
 * punch-in arrived, and a flat battery looks exactly like a lie-in. So every
 * record it writes carries `autoMarked: true`, says so on screen, and can be
 * appealed by the officer with a reason their manager then approves or
 * refuses. The automation has teeth; the last word belongs to a person.
 *
 * Runs on the server rather than on the officer's device, unlike the
 * abandoned-session sweep. It has to fire whether or not the app is ever
 * opened — an officer who does not open the app is the entire subject.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { getFirestore } = require('firebase-admin/firestore')

const REGION = 'asia-south1'
const TZ = 'Asia/Kolkata'

/**
 * When the day is judged.
 *
 * Late enough that a slow morning is not an absence, early enough that the
 * answer arrives while somebody can still do something about it. Change these
 * two lines and the schedules below together — the cron and the label have to
 * agree or the message tells the officer the wrong deadline.
 */
const MORNING = { cron: '0 11 * * *', label: '11am' }
const AFTERNOON = { cron: '0 15 * * *', label: '3pm' }

const SALES_ROLES = ['offline_sales', 'online_sales']

/** Local date in IST, as YYYY-MM-DD. */
function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

/** Sunday in IST. Nobody is expected in the field, so nothing is judged. */
function isSunday(date) {
  return new Date(date + 'T00:00:00+05:30').getUTCDay() === 0
}

/**
 * The sweep, at whichever cutoff called it.
 *
 * `full` upgrades the morning's half day rather than adding a second record —
 * a rep who missed both cutoffs was absent once, not twice.
 */
async function sweep(kind) {
  const db = getFirestore()
  const date = today()

  if (isSunday(date)) {
    console.log(`[attendance] ${date} is a Sunday — nothing to judge`)
    return
  }

  const holiday = await db.collection('holidays').where('date', '==', date).limit(1).get()
  if (!holiday.empty) {
    console.log(`[attendance] ${date} is ${holiday.docs[0].data().name} — nothing to judge`)
    return
  }

  const [users, sessions, leaves] = await Promise.all([
    db.collection('users').where('status', '==', 'approved').get(),
    db.collection('duty_sessions').where('date', '==', date).get(),
    db.collection('leave_records').where('date', '==', date).get(),
  ])

  const started = new Set(sessions.docs.map(d => d.data().uid))
  // Anything not already dismissed counts as covered: a leave the officer
  // asked for, one a manager marked, or one this sweep wrote earlier today.
  const leaveByUid = new Map()
  leaves.docs.forEach(d => {
    const l = d.data()
    if (l.status === 'removed' || l.status === 'rejected') return
    leaveByUid.set(l.uid, { id: d.id, ...l })
  })

  const reps = users.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(u => SALES_ROLES.includes(u.role))

  let written = 0
  for (const rep of reps) {
    if (started.has(rep.uid)) continue

    const existing = leaveByUid.get(rep.uid)
    const leaveType = kind === 'full' ? 'full_day' : 'half_day'

    if (existing) {
      // Only ever upgrade our own half day. A leave a person marked, or one
      // the officer is already appealing, is not ours to overwrite.
      const ours = existing.autoMarked === true
      const isHalf = existing.leaveType === 'half_day'
      const untouched = existing.status === 'active'
      if (!(kind === 'full' && ours && isHalf && untouched)) continue

      await db.doc(`leave_records/${existing.id}`).update({
        leaveType: 'full_day',
        auditLog: [...(existing.auditLog || []), {
          action: 'admin_marked',
          by: 'system',
          byName: 'Automatic',
          at: Date.now(),
        }],
      })
      await notify(db, rep, date, 'full_day', AFTERNOON.label)
      written++
      continue
    }

    await db.collection('leave_records').add({
      uid: rep.uid,
      name: rep.name || '',
      role: rep.role,
      date,
      leaveType,
      note: `No punch-in by ${kind === 'full' ? AFTERNOON.label : MORNING.label}.`,
      markedAt: Date.now(),
      markedBy: 'system',
      markedByName: 'Automatic',
      status: 'active',
      autoMarked: true,
      auditLog: [{
        action: 'admin_marked', by: 'system', byName: 'Automatic', at: Date.now(),
      }],
    })
    await notify(db, rep, date, leaveType, kind === 'full' ? AFTERNOON.label : MORNING.label)
    written++
  }

  console.log(`[attendance] ${date} ${kind}: ${reps.length} reps, ${written} marked`)
}

/**
 * Tell the officer, not the office.
 *
 * They are the one who can explain it, and they cannot appeal something they
 * were never told about. Management sees it in the leave tracker either way.
 */
async function notify(db, rep, date, leaveType, by) {
  await db.collection('alerts').add({
    type: 'leave_approved',
    message:
      `No punch-in by ${by} on ${date}, so ${leaveType === 'full_day' ? 'a full day' : 'a half day'} `
      + 'of leave was marked automatically. If that is wrong, open Leave and ask for it to be '
      + 'cancelled — say what happened and your manager will decide.',
    relatedId: rep.uid,
    toUid: rep.uid,
    read: false,
    createdAt: Date.now(),
  })
}

exports.markMissingDutyMorning = onSchedule(
  { schedule: MORNING.cron, timeZone: TZ, region: REGION },
  async () => { await sweep('half') },
)

exports.markMissingDutyAfternoon = onSchedule(
  { schedule: AFTERNOON.cron, timeZone: TZ, region: REGION },
  async () => { await sweep('full') },
)
