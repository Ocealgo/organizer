import type { BrowserContext } from '@playwright/test'

/**
 * The moment the suite runs as: 11am on the most recent working day.
 *
 * The app reads the clock in ways a spec cannot ignore. Sunday is a day off —
 * no "Start the day", no leave to ask for, nothing to log. After 6pm an open
 * day grows a reminder with a second "End the day" on it. Run at the wrong
 * hour or on the wrong day, the suite went red for reasons that had nothing to
 * do with the code under test.
 *
 * So every run starts at 11am, Monday to Saturday, and the clock ticks on from
 * there. The shift is only ever backwards — today at 11 if that has passed,
 * otherwise the working day before — because a browser that thinks it is ahead
 * of the auth server sees every token as expired.
 *
 * The browser and the seeds share this clock: an order seeded "today" and a
 * screen showing "today" have to be the same day.
 */
const START = (() => {
  const d = new Date()
  d.setHours(11, 0, 0, 0)
  if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1)
  while (d.getDay() === 0) d.setDate(d.getDate() - 1)
  return d.getTime()
})()
/**
 * The sandbox imports the seed for its accounts and its world, and with it this
 * clock — which put the sandbox's "today" on yesterday whenever it started
 * before 11am. The sandbox is a place to stand in real time, so it keeps the
 * real clock; only the specs are pinned.
 */
const IN_SANDBOX = typeof process !== 'undefined' && /sandbox\.mjs$/.test(process.argv?.[1] ?? '')
export const OFFSET_MS = IN_SANDBOX ? 0 : START - Date.now()

/** Now, as the suite sees it. Use in place of Date.now(). */
export const testNow = (): number => Date.now() + OFFSET_MS

/** A Date for now, as the suite sees it. Use in place of new Date(). */
export const testDate = (): Date => new Date(testNow())

/**
 * Shift the browser's Date by the same offset, before any page script runs.
 *
 * Only Date is replaced. Timers keep running in real time, so Firebase's own
 * retries and listeners behave exactly as they do without this.
 */
export async function shiftClock(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript((offset: number) => {
    const Real = Date
    const now = () => Real.now() + offset
    class Shifted extends Real {
      constructor(...args: any[]) {
        if (args.length === 0) super(now())
        else super(...(args as [any]))
      }
      static now() { return now() }
    }
    ;(globalThis as any).Date = Shifted
  }, OFFSET_MS)
}
