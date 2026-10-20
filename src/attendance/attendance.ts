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
  const holidayOn = new Map(holidays.map(h => [h.date, h.name]))
  return datesOfMonth(month).map(date => {
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
  })
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
  }
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
