/**
 * A day nobody started.
 *
 * A rep who never punches in produces silence: no session, no visits, nothing
 * to look at and nobody told. This turns that silence into a record — a warning
 * first, then half a day, then the whole day.
 *
 * It marks leave automatically, which is a real decision and worth being honest
 * about: the app does not know the officer was absent. It knows no punch-in
 * arrived, and a flat battery looks exactly like a lie-in. So every record it
 * writes carries `autoMarked`, says so on screen, and can be appealed by the
 * officer with a reason their manager approves or refuses. The automation has
 * teeth; the last word belongs to a person.
 *
 * Runs on the server rather than on the officer's device, unlike the
 * abandoned-session sweep. It has to fire whether or not the app is ever
 * opened — an officer who does not open the app is the entire subject.
 *
 * WHY IT TICKS EVERY FIVE MINUTES
 * A cron expression is baked into a Cloud Scheduler job at deploy time, so a
 * function scheduled for 10:00 cannot be moved by editing a setting — only by
 * redeploying. The times belong to whoever runs the business, not to whoever
 * last deployed, so the schedule is dumb and frequent and the decision lives in
 * `config/settings`. A change takes effect the same day. The cost is around 288
 * near-empty invocations a day against a two-million monthly allowance.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { getFirestore } = require('firebase-admin/firestore')

const REGION = 'asia-south1'
const TZ = 'Asia/Kolkata'

/**
 * Everyone who can actually punch in.
 *
 * Not everyone who is not an admin. `offline_marketing` and `online_marketing`
 * are routed to their own screens and never see a duty form, so sweeping them
 * in would mark them absent every day of their working lives with no way to
 * comply — only to appeal, daily, forever. A rule somebody cannot obey is not
 * an accountability measure, it is a broken app.
 *
 * A super admin can widen this in Settings if that ever changes. The default is
 * the set of people the app gives a punch-in button to.
 */
const CAN_PUNCH_IN = ['offline_sales', 'online_sales', 'sales_manager']

/** Never swept, whatever the settings say. Somebody has to be able to fix this. */
const NEVER = ['admin', 'super_admin']

/** Used until a super admin says otherwise, in Settings. */
const DEFAULTS = {
  halfDayAt: '10:00',
  fullDayAt: '14:00',
  warnMinutes: 10,
  // When a half day ends and the afternoon may be worked. Read by the app, not
  // by this sweep — it decides who is marked, not who may start.
  halfDayResumeAt: '13:00',
}

/** Local date in IST, as YYYY-MM-DD. */
function istDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

/** Local time in IST as "HH:MM", zero-padded so string comparison is time comparison. */
function istTime() {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit',
  })
}

/** Sunday in IST. */
function isSunday(date) {
  return new Date(date + 'T00:00:00+05:30').getUTCDay() === 0
}

/** "10:00" minus 10 → "09:50". Clamped at midnight; a cutoff that early is nonsense anyway. */
function minus(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number)
  const total = Math.max(0, h * 60 + m - minutes)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const VALID = /^([01]\d|2[0-3]):([0-5]\d)$/

async function settings(db) {
  try {
    const snap = await db.doc('config/settings').get()
    const a = (snap.data() || {}).attendance || {}
    return {
      // A malformed value falls back rather than throwing. This runs unattended
      // every five minutes; a typo in a settings field must not stop the sweep.
      halfDayAt: VALID.test(a.halfDayAt) ? a.halfDayAt : DEFAULTS.halfDayAt,
      fullDayAt: VALID.test(a.fullDayAt) ? a.fullDayAt : DEFAULTS.fullDayAt,
      warnMinutes: Number.isFinite(a.warnMinutes) && a.warnMinutes >= 0 && a.warnMinutes <= 120
        ? a.warnMinutes : DEFAULTS.warnMinutes,
      enabled: a.enabled !== false,
      // Which roles are swept, and who is let off individually. An admin can
      // never be swept whatever this says.
      roles: Array.isArray(a.roles) && a.roles.length
        ? a.roles.filter(r => !NEVER.includes(r))
        : CAN_PUNCH_IN,
      // Exemptions are stored as the people let OFF rather than the people
      // included, so somebody hired next month is covered from their first day
      // instead of quietly escaping until a super admin remembers to tick them.
      exemptUids: Array.isArray(a.exemptUids) ? a.exemptUids : [],
      halfDayResumeAt: VALID.test(a.halfDayResumeAt) ? a.halfDayResumeAt : DEFAULTS.halfDayResumeAt,
    }
  } catch {
    return { ...DEFAULTS, enabled: true, roles: CAN_PUNCH_IN, exemptUids: [] }
  }
}

/**
 * Reps who have not punched in, and are not already accounted for.
 *
 * Anything not dismissed counts as accounted for: leave the officer asked for,
 * leave a manager marked, and leave this sweep wrote earlier today.
 */
async function outstanding(db, date, cfg) {
  const [users, sessions, leaves] = await Promise.all([
    db.collection('users').where('status', '==', 'approved').get(),
    db.collection('duty_sessions').where('date', '==', date).get(),
    db.collection('leave_records').where('date', '==', date).get(),
  ])

  const started = new Set(sessions.docs.map(d => d.data().uid))
  const leaveByUid = new Map()
  leaves.docs.forEach(d => {
    const l = d.data()
    if (l.status === 'removed' || l.status === 'rejected') return
    leaveByUid.set(l.uid, { id: d.id, ...l })
  })

  const reps = users.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(u => !NEVER.includes(u.role))
    .filter(u => cfg.roles.includes(u.role))
    .filter(u => !cfg.exemptUids.includes(u.uid))

  return { reps, started, leaveByUid }
}

/**
 * Ten minutes' notice, to the people it applies to.
 *
 * Only those who have not started — nobody should be told to do a thing they
 * did at nine o'clock. Written as an `alerts` document rather than sent
 * directly, because that is already the queue: `pushOnAlert` sends the push and
 * the bell reads the same row. Nothing here needs to know what FCM is.
 */
async function warn(db, date, stage, deadline, cfg) {
  const { reps, started, leaveByUid } = await outstanding(db, date, cfg)
  let sent = 0
  for (const rep of reps) {
    if (started.has(rep.uid) || leaveByUid.has(rep.uid)) continue
    await db.collection('alerts').add({
      type: 'duty_not_started',
      message:
        `Start your day by ${deadline} or today is recorded as `
        + `${stage === 'half' ? 'a half day off' : 'a full day off'}. `
        + 'Open the app and punch in — it takes a moment.',
      relatedId: rep.uid,
      toUid: rep.uid,
      // Taps straight through to the punch-in form rather than the home screen.
      url: '/?go=duty',
      read: false,
      createdAt: Date.now(),
    })
    sent++
  }
  console.log(`[attendance] ${date} warn-${stage}: ${sent} warned`)
}

/**
 * Mark the day.
 *
 * `full` upgrades the morning's half day rather than adding a second record —
 * somebody absent all day was absent once, not twice. It only ever edits its
 * own: a leave a person marked, or one already under appeal, is not ours.
 */
async function mark(db, date, stage, deadline, cfg) {
  const { reps, started, leaveByUid } = await outstanding(db, date, cfg)
  let written = 0

  for (const rep of reps) {
    if (started.has(rep.uid)) continue
    const existing = leaveByUid.get(rep.uid)
    const leaveType = stage === 'full' ? 'full_day' : 'half_day'

    if (existing) {
      const ours = existing.autoMarked === true
      const isHalf = existing.leaveType === 'half_day'
      const untouched = existing.status === 'active'
      if (!(stage === 'full' && ours && isHalf && untouched)) continue

      await db.doc(`leave_records/${existing.id}`).update({
        leaveType: 'full_day',
        note: `No punch-in by ${deadline}.`,
        auditLog: [...(existing.auditLog || []), {
          action: 'admin_marked', by: 'system', byName: 'Automatic', at: Date.now(),
        }],
      })
      await tell(db, rep, date, 'full_day', deadline)
      written++
      continue
    }

    await db.collection('leave_records').add({
      uid: rep.uid,
      name: rep.name || '',
      role: rep.role,
      date,
      leaveType,
      note: `No punch-in by ${deadline}.`,
      markedAt: Date.now(),
      markedBy: 'system',
      markedByName: 'Automatic',
      status: 'active',
      autoMarked: true,
      auditLog: [{ action: 'admin_marked', by: 'system', byName: 'Automatic', at: Date.now() }],
    })
    await tell(db, rep, date, leaveType, deadline)
    written++
  }

  console.log(`[attendance] ${date} ${stage}: ${written} marked of ${reps.length} reps`)
}

/**
 * Tell the officer, not the office.
 *
 * They are the one who can explain it, and they cannot appeal something they
 * were never told about. Management sees it in the leave tracker regardless.
 */
async function tell(db, rep, date, leaveType, deadline) {
  await db.collection('alerts').add({
    type: 'duty_not_started',
    message:
      `No punch-in by ${deadline}, so ${leaveType === 'full_day' ? 'a full day' : 'a half day'} `
      + 'of leave was recorded automatically. If that is wrong, open Leave, cancel it and say '
      + 'what happened — your manager decides.',
    relatedId: rep.uid,
    toUid: rep.uid,
    url: '/?go=leaves',
    read: false,
    createdAt: Date.now(),
  })
}

/**
 * One document per day holding which stages have already fired.
 *
 * Marking is naturally idempotent — a rep who already has leave is skipped — but
 * warning is not, and without this the same person is told every five minutes
 * for ten minutes.
 */
async function claim(db, date, stage) {
  const ref = db.doc(`attendance_runs/${date}`)
  const snap = await ref.get()
  if ((snap.data() || {})[stage]) return false
  await ref.set({ [stage]: Date.now(), date }, { merge: true })
  return true
}

exports.attendanceSweep = onSchedule(
  { schedule: 'every 5 minutes', timeZone: TZ, region: REGION },
  async () => {
    const db = getFirestore()
    const cfg = await settings(db)
    if (!cfg.enabled) return

    const date = istDate()
    if (isSunday(date)) return

    const holiday = await db.collection('holidays').where('date', '==', date).limit(1).get()
    if (!holiday.empty) return

    const now = istTime()
    const warnHalf = minus(cfg.halfDayAt, cfg.warnMinutes)
    const warnFull = minus(cfg.fullDayAt, cfg.warnMinutes)

    // Latest applicable stage first, so a sweep that missed its slot — a cold
    // start, a deploy, an outage — still does the right thing rather than
    // nothing. Each stage is claimed once per day.
    if (now >= cfg.fullDayAt) {
      if (await claim(db, date, 'full')) await mark(db, date, 'full', cfg.fullDayAt, cfg)
      return
    }
    if (now >= warnFull) {
      if (await claim(db, date, 'warnFull')) await warn(db, date, 'full', cfg.fullDayAt, cfg)
      return
    }
    if (now >= cfg.halfDayAt) {
      if (await claim(db, date, 'half')) await mark(db, date, 'half', cfg.halfDayAt, cfg)
      return
    }
    if (now >= warnHalf) {
      if (await claim(db, date, 'warnHalf')) await warn(db, date, 'half', cfg.halfDayAt, cfg)
    }
  },
)
