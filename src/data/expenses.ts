import {
  collection, doc, getDocs, getDoc, query, where, writeBatch, increment,
} from 'firebase/firestore'
import { db } from '../firebase'
import {
  AppUser, AllowanceType, ExpenseConfig, ExpenseEntry, ExpenseReport,
} from '../types'
import { localDateStr } from '../utils/date'

/**
 * Claiming a day's expenses, from wherever the claim starts.
 *
 * The expense sheet raises them one at a time, by hand. The end of a duty day
 * proposes them in one go from what the day already recorded. Both write the
 * same documents to the same week and have to have the same consequences — so
 * the parts both need live here, once, rather than as a second copy in a second
 * screen. A second implementation drifting from the first is exactly how the
 * visit path once booked orders that locked no stock.
 */

/**
 * HQ and EX are defined by distance — within or beyond this many kilometres.
 * OS is not derivable: staying over is not visible in an odometer, and a two
 * hundred kilometre day that ended at home is EX.
 */
export const HQ_RADIUS_KM = 25

/** The allowance a day's distance points at, or null when there is no distance. */
export function allowanceForKm(km: number | null | undefined): AllowanceType | null {
  if (typeof km !== 'number') return null
  return km <= HQ_RADIUS_KM ? 'HQ' : 'EX'
}

/** Monday of the week a date falls in — the week a claim belongs to. */
export function weekStartOf(date: string): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1))
  return localDateStr(d)
}

function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return localDateStr(d)
}

/** Money, to the paisa. Keeps 13 km × 4.5 off the floating-point tail. */
export const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Whether a week can still be added to.
 *
 * Draft and sent-back weeks only, which is what the rules already enforce on
 * the report: once a week is submitted it is in somebody's queue, and once it
 * is cleared it has been paid. Offering an Add button on either would be a
 * button the database refuses — and here the refusal would land half way, with
 * the entry written and the week's total not.
 */
export function weekIsOpen(report: ExpenseReport | null): boolean {
  return !report || report.status === 'draft' || report.status === 'rejected'
}

/** Everything the end of a day needs to know before it can propose anything. */
export interface DayContext {
  config: ExpenseConfig
  /** The week this day belongs to, if one has been started. */
  report: ExpenseReport | null
  /** What has already been claimed for this day. */
  entries: ExpenseEntry[]
}

export async function loadDayContext(uid: string, date: string): Promise<DayContext> {
  const ws = weekStartOf(date)
  const [cfgSnap, reportSnap, entrySnap] = await Promise.all([
    getDoc(doc(db, 'expense_config', 'main')),
    // Scoped by userId, which is what lets the rules prove the read is the
    // rep's own rather than refusing the query outright.
    getDocs(query(collection(db, 'expense_reports'),
      where('userId', '==', uid), where('weekStart', '==', ws))),
    getDocs(query(collection(db, 'expense_entries'),
      where('userId', '==', uid), where('date', '==', date))),
  ])
  const config = (cfgSnap.exists() ? cfgSnap.data() : { hq: 200, ex: 300, os: 450 }) as ExpenseConfig
  const report = reportSnap.empty
    ? null
    : ({ id: reportSnap.docs[0].id, ...reportSnap.docs[0].data() } as ExpenseReport)
  return {
    config,
    report,
    entries: entrySnap.docs.map(d => ({ id: d.id, ...d.data() } as ExpenseEntry)),
  }
}

/** One line a day could add to its week. */
export type ProposedLine =
  | {
      kind: 'allowance'
      allowanceType: AllowanceType
      amount: number
      /** What the meter said, kept on the entry whatever band is chosen. */
      meterKm?: number
      suggested?: AllowanceType
    }
  | {
      kind: 'fuel'
      km: number
      rate: number
      amount: number
      /** What the meter said. A claim above it carries a reason. */
      meterKm?: number
      aboveMeterReason?: string
    }

/**
 * Add a day's lines to its week, in one write.
 *
 * Batched, so a week never ends up with the entries and not the total, or a
 * report and none of its lines. The total is moved by `increment` rather than
 * recomputed from a list on the device, so a second phone adding to the same
 * week at the same moment adds rather than overwrites.
 */
export async function addDayExpenses(
  user: AppUser,
  date: string,
  sessionId: string | undefined,
  lines: ProposedLine[],
  existing: ExpenseReport | null,
): Promise<number> {
  if (lines.length === 0) return 0
  if (!weekIsOpen(existing)) {
    throw new Error('This week has already been submitted, so nothing more can be added to it.')
  }

  const batch = writeBatch(db)
  const total = round2(lines.reduce((n, l) => n + l.amount, 0))

  // A week nobody has opened yet is created in the same write as its first
  // lines, already carrying their total.
  let reportId = existing?.id
  if (!reportId) {
    const ref = doc(collection(db, 'expense_reports'))
    const ws = weekStartOf(date)
    const fresh: Omit<ExpenseReport, 'id'> = {
      userId: user.uid, userName: user.name, userRole: user.role,
      weekStart: ws, weekEnd: addDays(ws, 6),
      status: 'draft', totalAmount: total, createdAt: Date.now(),
    }
    batch.set(ref, fresh)
    reportId = ref.id
  } else {
    batch.update(doc(db, 'expense_reports', reportId), { totalAmount: increment(total) })
  }

  for (const l of lines) {
    const ref = doc(collection(db, 'expense_entries'))
    const base = {
      reportId, userId: user.uid, date,
      ...(sessionId ? { dutySessionId: sessionId } : {}),
      createdAt: Date.now(),
    }
    if (l.kind === 'allowance') {
      batch.set(ref, {
        ...base,
        type: 'allowance', allowanceType: l.allowanceType, amount: l.amount,
        // The distance and what it pointed at, kept whether or not the rep
        // took the suggestion: a claim that departs from the meter is the one
        // worth being able to see later.
        ...(typeof l.meterKm === 'number' && l.suggested
          ? { allowanceFromKm: l.meterKm, allowanceSuggested: l.suggested }
          : {}),
      })
    } else {
      batch.set(ref, {
        ...base,
        type: 'variable', category: 'fuel', amount: l.amount,
        autoCalculated: true, distanceKm: l.km, ratePerKm: l.rate,
        ...(typeof l.meterKm === 'number' ? { meterKm: l.meterKm } : {}),
        ...(l.aboveMeterReason ? { aboveMeterReason: l.aboveMeterReason } : {}),
      })
    }
  }

  await batch.commit()
  return total
}

/**
 * Whether a fuel claim needs a reason, and the shortest acceptable one.
 *
 * Below the meter never does — claiming less than you drove is nobody's
 * problem. Above it does, because that is the one case the odometer cannot
 * vouch for, and it is the case the reviewer most needs a sentence about.
 */
export const ABOVE_METER_MIN_REASON = 5
export function needsMeterReason(claimedKm: number, meterKm: number | null | undefined): boolean {
  return typeof meterKm === 'number' && claimedKm > meterKm
}
