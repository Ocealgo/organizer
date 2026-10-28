import type { DutySession, Holiday, LeaveRecord } from '../types'

/**
 * A rep's attendance, a day at a time — read the same way by the rep's own
 * calendar and by the admin's register, so the two can never disagree.
 *
 * Nothing here is recorded anew. A day is what the duty session and the leave
 * records already say about it: started and ended, closed by the nightly job,
 * marked half or absent by the missed-punch-in sweep, leave a manager approved,
 * a Sunday, a holiday. This file only decides which of those a day is.
 *
 * It is attendance as the app recorded it. Whether payroll counts days the same
 * way is a decision outside the app; the screens say "as recorded" for that
 * reason.
 */

export type Mark =
  | 'present'       // started and ended (or still out today)
  | 'auto_closed'   // started, never ended — the nightly job closed it
  | 'half'          // half a day: marked by the sweep, or approved leave
  | 'absent'        // the sweep marked the whole day: no punch-in by the cutoff
  | 'leave'         // a full day of approved leave
  | 'requested'     // leave asked for, not yet approved, nothing worked
  | 'off'           // Sunday, nothing worked
  | 'holiday'       // a declared holiday, nothing worked
  | 'not_yet'       // today, not started yet
  | 'future'        // a day still to come
  | 'none'          // a past working day with no record at all

export interface Day {
  date: string
  mark: Mark
  session?: DutySession
  leave?: LeaveRecord
  holiday?: string
  /** The leave was the app's conclusion, not a person's — and may be appealed. */
  automatic: boolean
  /** An appeal is with the manager. */
  appealPending: boolean
  /**
   * A Sunday or a declared holiday. Set whatever else the day was, so a day
   * worked on one shows both facts: that it was a day off, and that it was
   * worked anyway.
   */
  dayOff: boolean
}

/** One letter per mark, so a mark never rests on its colour alone. */
export const MARK_LETTER: Record<Mark, string> = {
  present: 'P', auto_closed: 'P', half: '½', absent: 'A', leave: 'L', requested: 'L?',
  off: '', holiday: 'H', not_yet: '', future: '', none: '–',
}

export const MARK_LABEL: Record<Mark, string> = {
  present: 'Present', auto_closed: 'Present · day not ended', half: 'Half day', absent: 'Absent',
  leave: 'Leave', requested: 'Leave requested', off: 'Sunday', holiday: 'Holiday',
  not_yet: 'Not started yet', future: '', none: 'No record',
}

/** Leave that stands — approved, or under appeal and so still in force until decided. */
const standing = (l: LeaveRecord) => l.status === 'active' || l.status === 'unmark_requested'

export function datesOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  return Array.from({ length: new Date(y, m, 0).getDate() },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

/** One rep's month, day by day. */
export function monthOf(
  uid: string, month: string, today: string,
  sessions: DutySession[], leaves: LeaveRecord[], holidays: Holiday[],
): Day[] {
  return daysOf(uid, datesOfMonth(month), today, sessions, leaves, holidays)
}

/** One rep's days, any run of them — a week, a range, a single day. */
export function daysOf(
  uid: string, dates: string[], today: string,
  sessions: DutySession[], leaves: LeaveRecord[], holidays: Holiday[],
): Day[] {
  const holidayOn = new Map(holidays.map(h => [h.date, h.name]))
  return dates.map(date => dayOf(uid, date, today, sessions, leaves, holidayOn))
}

/** One rep's day. */
export function dayOf(
  uid: string, date: string, today: string,
  sessions: DutySession[], leaves: LeaveRecord[], holidayOn: Map<string, string>,
): Day {
  const session = sessions.find(s => s.uid === uid && s.date === date)
  const all = leaves.filter(l => l.uid === uid && l.date === date)
  const leave = all.find(standing) ?? all.find(l => l.status === 'pending_approval')
  const automatic = !!leave?.autoMarked
  const appealPending = leave?.status === 'unmark_requested'
  const sunday = new Date(date + 'T00:00:00').getDay() === 0
  const holiday = holidayOn.get(date)
  const base = { date, session, leave, holiday, automatic, appealPending, dayOff: sunday || !!holiday }

  // Worked. Half a day of leave on a worked day is still half a day.
  if (session) {
    if (leave && standing(leave) && leave.leaveType === 'half_day') return { ...base, mark: 'half' as Mark }
    return { ...base, mark: (session.autoClosed ? 'auto_closed' : 'present') as Mark }
  }
  // A declared holiday is a day off for everyone, whatever else is on it. An
  // automatic absence written before the holiday was declared does not stand
  // against it, and leave taken on a holiday was never needed.
  if (base.holiday) return { ...base, mark: 'holiday' as Mark }
  if (leave && standing(leave)) {
    if (leave.leaveType === 'half_day') return { ...base, mark: 'half' as Mark }
    return { ...base, mark: (automatic ? 'absent' : 'leave') as Mark }
  }
  if (leave?.status === 'pending_approval') return { ...base, mark: 'requested' as Mark }
  if (sunday) return { ...base, mark: 'off' as Mark }
  if (date > today) return { ...base, mark: 'future' as Mark }
  if (date === today) return { ...base, mark: 'not_yet' as Mark }
  return { ...base, mark: 'none' as Mark }
}

/**
 * A day in a few words, for a manager scanning the team — Monitor reps' lists
 * and cards. An absence under appeal says so: it needs a decision, not a
 * verdict.
 */
export function statusOf(d: Day): { text: string; tone: 'good' | 'warn' | 'off' | 'muted' } {
  const s = d.session
  const off = d.holiday ? `Holiday — ${d.holiday}` : 'Sunday'
  switch (d.mark) {
    case 'present': {
      const when = s?.endAt ? `${hhmm(s.startAt)}–${hhmm(s.endAt)}` : `out since ${hhmm(s?.startAt)}`
      return { text: `${d.dayOff ? `${off} · worked` : 'Present'} · ${when}`, tone: 'good' }
    }
    case 'auto_closed':
      return { text: `${d.dayOff ? `${off} · worked` : 'Present'} · from ${hhmm(s?.startAt)}, day not ended`, tone: 'warn' }
    case 'half':
      return { text: d.appealPending ? 'Half day — appeal waiting'
        : (d.automatic ? 'Half day — no punch-in in the morning' : 'Half day leave')
          + (s ? ` · worked from ${hhmm(s.startAt)}` : ''), tone: 'warn' }
    case 'absent':
      return { text: d.appealPending ? 'Absent — appeal waiting' : 'Absent — no punch-in', tone: 'warn' }
    case 'leave': return { text: `On leave — full day${d.leave?.reason ? ` · ${d.leave.reason}` : ''}`, tone: 'muted' }
    case 'requested': return { text: 'Leave requested — not approved yet', tone: 'warn' }
    case 'holiday': return { text: off, tone: 'off' }
    case 'off': return { text: 'Sunday', tone: 'off' }
    case 'not_yet': return { text: 'Not started yet', tone: 'muted' }
    case 'none': return { text: 'No record', tone: 'muted' }
    default: return { text: '', tone: 'muted' }
  }
}

export interface Summary {
  /** Working days so far: not Sundays, not holidays, not in the future. */
  working: number
  present: number
  half: number
  absent: number
  leave: number
  /** Present, but the day was never ended — so no distance was claimed. */
  autoClosed: number
  /** Past working days with nothing at all — no session, no leave. */
  none: number
  /** Worked on a Sunday or a holiday — on top of the working days, not among them. */
  offWorked: number
  appealsPending: number
  /**
   * Days off taken, as leave is counted: a full day of leave or an absence is
   * one, a half day is half — so two half days are one day of leave. Sundays
   * and holidays never count, whatever was recorded on them.
   */
  leaveDays: number
  /** Of those, leave the person asked for and had approved, in days. */
  appliedDays: number
  /** Of those, leave the app marked for no punch-in, in days. */
  autoDays: number
  /** Working days in the whole run — the month, future days included. */
  scheduled: number
}

export function summaryOf(days: Day[]): Summary {
  const n = (f: (d: Day) => boolean) => days.filter(f).length
  return {
    working: n(d => !d.dayOff && d.mark !== 'future'),
    // Present on a working day. A day off worked is counted on its own, so
    // "14 of 16 working days" never reads as 15 of 16.
    present: n(d => (d.mark === 'present' || d.mark === 'auto_closed') && !d.dayOff),
    offWorked: n(d => (d.mark === 'present' || d.mark === 'auto_closed') && d.dayOff),
    half: n(d => d.mark === 'half'),
    absent: n(d => d.mark === 'absent'),
    leave: n(d => d.mark === 'leave'),
    autoClosed: n(d => d.mark === 'auto_closed'),
    none: n(d => d.mark === 'none'),
    appealsPending: n(d => d.appealPending),
    leaveDays: n(d => !d.dayOff && (d.mark === 'leave' || d.mark === 'absent'))
      + n(d => !d.dayOff && d.mark === 'half') / 2,
    appliedDays: n(d => !d.dayOff && d.mark === 'leave')
      + n(d => !d.dayOff && d.mark === 'half' && !d.automatic) / 2,
    autoDays: n(d => !d.dayOff && d.mark === 'absent')
      + n(d => !d.dayOff && d.mark === 'half' && d.automatic) / 2,
    scheduled: n(d => !d.dayOff),
  }
}

/**
 * The totals at the end of each register row, in words, for the screen and the
 * PDF alike. The same columns as the leave report, so the two read the same.
 * `days` marks a count that can end in a half.
 */
export const REGISTER_TOTALS: { head: string; title: string; of: (s: Summary) => number; days?: boolean; key?: boolean }[] = [
  { head: 'Working days', title: 'Days due to be worked in the month — not Sundays, not holidays', of: s => s.scheduled },
  { head: 'Present', title: 'Working days present so far', of: s => s.present },
  { head: 'Half days', title: 'Half days — half-day leave, or no punch-in by the morning cutoff', of: s => s.half },
  { head: 'Leave taken', title: 'Days off in total: a full day of leave or an absence is one, a half day is half — two half days are one day', of: s => s.leaveDays, days: true, key: true },
  { head: 'Applied', title: 'Leave the person asked for and a manager approved, in days', of: s => s.appliedDays, days: true },
  { head: 'Automatic', title: 'Leave the app marked because there was no punch-in, in days', of: s => s.autoDays, days: true },
]

/** A count of days that may end in a half: 3, 2½, ½. */
export const fmtDays = (n: number) => {
  const whole = Math.floor(n)
  return n - whole >= 0.5 ? (whole ? `${whole}½` : '½') : String(whole)
}

/**
 * Leave counted in days, from the records themselves — for a list of leave
 * rather than a calendar.
 *
 * One person's day counts once however many records sit on it: a full day is
 * one, a half day is half, a full day beside a half day is still one. Two half
 * days on different dates add up to one. Leave on a Sunday or a declared
 * holiday was never needed and counts nothing. Only leave that stands —
 * approved, or under appeal and so in force until decided.
 */
export function leaveDaysOf(leaves: LeaveRecord[], holidays: Holiday[] | Set<string>): {
  days: number; full: number; half: number; absent: number
} {
  const off = holidays instanceof Set ? holidays : new Set(holidays.map(h => h.date))
  const byDay = new Map<string, LeaveRecord[]>()
  for (const l of leaves) {
    if (!standing(l)) continue
    if (off.has(l.date) || new Date(l.date + 'T00:00:00').getDay() === 0) continue
    const k = `${l.uid}|${l.date}`
    byDay.set(k, [...(byDay.get(k) ?? []), l])
  }
  let full = 0, half = 0, absent = 0
  for (const rs of byDay.values()) {
    const whole = rs.find(l => l.leaveType !== 'half_day')
    if (!whole) half++
    else if (whole.autoMarked) absent++
    else full++
  }
  return { days: full + absent + half / 2, full, half, absent }
}

const hhmm = (ms?: number) => ms
  ? new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''

/** What a day's detail line says, for the calendar and the register alike. */
export function describe(d: Day): string {
  // A day off that was worked: say both, the day off first.
  if (d.dayOff && (d.mark === 'present' || d.mark === 'auto_closed')) {
    const off = d.holiday ? `Holiday — ${d.holiday}` : 'Sunday'
    return `${off} · worked anyway · ${describeWorked(d)}`
  }
  return describeWorked(d)
}

function describeWorked(d: Day): string {
  const s = d.session
  const km = s && typeof s.claimedDistanceKm === 'number' ? ` · ${s.claimedDistanceKm} km` : ''
  switch (d.mark) {
    case 'present':
      return s?.endAt ? `Worked ${hhmm(s.startAt)}–${hhmm(s.endAt)}${km}` : `Started ${hhmm(s?.startAt)} · still out`
    case 'auto_closed':
      return `Started ${hhmm(s?.startAt)} · not ended, closed automatically at ${hhmm(s?.endAt)} · no distance claimed`
    case 'half':
      return (d.automatic ? 'Half day, marked automatically — no punch-in by the morning cutoff'
        : 'Half day of leave, approved')
        + (s ? ` · worked from ${hhmm(s.startAt)}` : '')
        + (d.appealPending ? ' · appeal with your manager' : '')
    case 'absent':
      return 'Absent, marked automatically — no punch-in by the afternoon cutoff'
        + (d.appealPending ? ' · appeal with your manager' : '')
    case 'leave': return `Leave, approved${d.leave?.reason ? ` · ${d.leave.reason}` : ''}`
    case 'requested': return 'Leave requested, waiting for approval'
    case 'holiday':
      return `Holiday — ${d.holiday ?? ''}`.replace(/ — $/, '')
        + (d.leave?.autoMarked ? ' · an automatic absence was recorded before the holiday was declared; it does not count'
          : d.leave && d.leave.status !== 'removed' && d.leave.status !== 'rejected' ? ' · leave on it is not needed' : '')
    case 'off': return 'Sunday'
    case 'not_yet': return 'Not started yet today'
    case 'none': return 'No record for this day'
    default: return ''
  }
}
