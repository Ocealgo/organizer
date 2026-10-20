/**
 * Sandbox only: pretend today is a different kind of day.
 *
 * Half the field app turns on what day it is — a Sunday is a day off, a
 * holiday is a day off, a working day has a target and a duty gate, a
 * finished day offers its expenses. Testing those by hand meant waiting for
 * the right day. This moves the app's clock back to the latest day of the
 * kind asked for, keeping the time of day, so every screen behaves as it
 * would then.
 *
 * The day is worked out by the switch when it is pressed — it needs the
 * declared holidays, which only the database knows — and stored as a date
 * with the real day it was chosen on. On a new real day the choice lapses and
 * the clock is real again, rather than drifting a day further back each night.
 *
 * Inert unless VITE_SANDBOX is set, which only `.env.sandbox` does: e2e runs
 * and live builds never set it. Imported first in main.tsx, so it is in place
 * before any module reads the clock.
 *
 * Only ever backwards. A browser ahead of the auth server sees every token as
 * expired; one a few days behind does not notice.
 */
export type SandboxDay = 'real' | 'workday' | 'sunday' | 'holiday'

export const SANDBOX = import.meta.env.VITE_SANDBOX === 'true'
const KEY = 'sandbox:day'

const RealDate = Date
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** Today by the wall clock, whatever the app has been told. */
export const realToday = () => ymd(new RealDate())

interface Stored { kind: SandboxDay; date: string; chosenOn: string; holidayName?: string }

function readStored(): Stored | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null
    if (!v || !v.date || v.chosenOn !== realToday() || v.date > realToday()) return null
    return v
  } catch {
    return null
  }
}

/**
 * Choose a kind of day. Working day skips Sundays and the declared holidays;
 * holiday is the latest declared one, today included. Returns a message when
 * there is no such day to go to, and does not reload.
 */
export function chooseSandboxDay(kind: SandboxDay, holidays: { date: string; name: string }[] = []): string | null {
  if (kind === 'real') {
    try { localStorage.removeItem(KEY) } catch { /* nothing to clear */ }
    location.reload()
    return null
  }
  const today = realToday()
  const off = new Set(holidays.map(h => h.date))
  let date: string | null = null
  let holidayName: string | undefined
  if (kind === 'holiday') {
    const past = holidays.filter(h => h.date <= today).sort((a, b) => b.date.localeCompare(a.date))[0]
    if (!past) return 'No holiday declared yet. Add one in Attendance → Holidays.'
    date = past.date
    holidayName = past.name
  } else {
    const d = new RealDate()
    for (let i = 0; i < 400; i++) {
      const s = ymd(d)
      const sunday = d.getDay() === 0
      if (kind === 'sunday' ? sunday : !sunday && !off.has(s)) { date = s; break }
      d.setDate(d.getDate() - 1)
    }
  }
  if (!date) return 'No such day in the last year.'
  try {
    localStorage.setItem(KEY, JSON.stringify({ kind, date, chosenOn: today, holidayName } satisfies Stored))
  } catch { /* private window: stays real */ }
  location.reload()
  return null
}

const stored = SANDBOX ? readStored() : null

/** How many days back the chosen day is. */
const daysBack = (() => {
  if (!stored) return 0
  const a = new RealDate(realToday() + 'T00:00:00').getTime()
  const b = new RealDate(stored.date + 'T00:00:00').getTime()
  return Math.max(0, Math.round((a - b) / 86_400_000))
})()

if (daysBack > 0) {
  const offset = -daysBack * 86_400_000
  const now = () => RealDate.now() + offset
  class Shifted extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) super(now())
      else super(...(args as [any]))
    }
    static now() { return now() }
  }
  ;(globalThis as any).Date = Shifted
}

export const sandboxDay = {
  choice: (stored?.kind ?? 'real') as SandboxDay,
  daysBack,
  holidayName: stored?.holidayName,
}
