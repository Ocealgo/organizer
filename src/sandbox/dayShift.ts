/**
 * Sandbox only: pretend today is a different kind of day.
 *
 * Half the field app turns on what day it is — a Sunday is a day off, a
 * working day has a target and a duty gate, a finished day offers its
 * expenses. Testing those by hand meant waiting for the right day. This moves
 * the app's clock back to the latest day of the kind asked for, keeping the
 * time of day, so every screen behaves as it would then.
 *
 * Inert unless VITE_SANDBOX is set, which only `.env.sandbox` does: e2e runs
 * and live builds never set it. Imported first in main.tsx, so it is in place
 * before any module reads the clock.
 *
 * Only ever backwards. A browser ahead of the auth server sees every token as
 * expired; one a few days behind does not notice.
 */
export type SandboxDay = 'real' | 'workday' | 'sunday'

export const SANDBOX = import.meta.env.VITE_SANDBOX === 'true'
const KEY = 'sandbox:day'

function readChoice(): SandboxDay {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'workday' || v === 'sunday' ? v : 'real'
  } catch {
    return 'real'
  }
}

export function chooseSandboxDay(day: SandboxDay) {
  try { localStorage.setItem(KEY, day) } catch { /* private window: stays real */ }
  location.reload()
}

const RealDate = Date
const choice: SandboxDay = SANDBOX ? readChoice() : 'real'

/** How many days back the chosen kind of day is. */
const daysBack = (() => {
  if (choice === 'real') return 0
  const d = new RealDate()
  let n = 0
  const wanted = (day: number) => (choice === 'sunday' ? day === 0 : day !== 0)
  while (!wanted(d.getDay())) { d.setDate(d.getDate() - 1); n++ }
  return n
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

export const sandboxDay = { choice, daysBack }
