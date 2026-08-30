export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function localMonthStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function localDateOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return localDateStr(d)
}

/**
 * Sunday, from a YYYY-MM-DD string.
 *
 * One definition because there were two. The old visit logger refused to open
 * on a Sunday while the field app had no idea what day it was, so whether a
 * rep could log Sunday work depended on which screen they happened to tap —
 * and the sales report meanwhile counted those visits against a working-day
 * total that excluded Sundays.
 *
 * Parsed with an explicit midnight so it is read in local time. `new
 * Date('2026-08-30')` alone is treated as UTC, which lands on the wrong day
 * for anyone east of Greenwich — India included.
 */
export function isSunday(date: string): boolean {
  return new Date(date + 'T00:00:00').getDay() === 0
}
