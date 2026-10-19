import {
  dailyTargetFor, packetsOrdered, packetsOrderedOn, routePlaces, productDailyTargets,
  type OutletVisit, type Party, type SalesRoute, type SalesTarget, type UnifiedAllocation,
} from '../../types'
import { localDateStr } from '../../utils/date'

/**
 * The three questions Reports home answers first, worked out away from the
 * screen so the arithmetic can be read on its own:
 *
 *   are we on track for the month       → pace
 *   do visits turn into orders          → strike rate
 *   are the beats actually being worked → coverage
 *
 * None of it is new data. Targets, orders, visits and beats are all already
 * recorded; nothing here asks anyone to type anything more.
 */

// ── working days ─────────────────────────────────────────────────────────────

/** Every date of a month, YYYY-MM-DD. */
export function datesOf(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

/** The month's days a rep can be expected to work: not a Sunday, not a holiday. */
export function workingDaysOf(month: string, holidays: Set<string>): string[] {
  return datesOf(month).filter(d =>
    new Date(d + 'T00:00:00').getDay() !== 0 && !holidays.has(d))
}

// ── 1. pace ──────────────────────────────────────────────────────────────────

export interface Pace {
  uid: string
  name: string
  /** The month's target, in packets. */
  target: number
  /** What the days up to and including today were meant to add up to. */
  dueByToday: number
  /** Packets actually ordered this month so far, cancellations excluded. */
  done: number
  /** Where the month ends if the rest of it goes the way it has so far. */
  projected: number
  /** Packets a working day from tomorrow to clear the target; null on the last day. */
  neededPerDay: number | null
  daysLeft: number
}

export interface PacePoint {
  label: string
  /** Target, added up day by day. */
  target: number
  /** Ordered, added up day by day — through today only. */
  actual: number | null
  /** The projection, from today to the month's end. */
  projected: number | null
}

/**
 * Where each rep — and the team — stands against the month's target.
 *
 * "Due by today" comes from the days the target was divided into. A target set
 * for the month but never divided falls back to an even spread over the
 * working days, so it still has a pace rather than none.
 *
 * The projection is the month so far, extended at the same rate per working
 * day. Plain on purpose: a projection nobody can do in their head is one
 * nobody will believe.
 */
export function paceOf(
  targets: SalesTarget[],
  allocations: UnifiedAllocation[],
  month: string,
  today: string,
  holidays: Set<string>,
  /**
   * One product. Its target is the rep's split for it, its days the planner's
   * per-product days; a rep with no split for it has no target for it.
   */
  productId?: string,
): { reps: Pace[]; team: Pace; series: PacePoint[] } {
  const work = workingDaysOf(month, holidays)
  const elapsed = work.filter(d => d <= today)
  const left = work.filter(d => d > today)

  /** The month's figure for the product asked about, or the whole target. */
  const monthFigure = (t: SalesTarget) =>
    productId ? (t.byProduct?.[productId] ?? 0) : (t.units || 0)
  /** The planner's own figure for a day, or null where it set none. */
  const setFigure = (t: SalesTarget, d: string): number | null =>
    productId ? (productDailyTargets(t, d)?.[productId] ?? null) : dailyTargetFor(t, d)
  /** A rep's figure for one day — divided where it was, spread evenly where not. */
  const dayFigure = (t: SalesTarget, d: string, divided: boolean): number => {
    if (divided) return setFigure(t, d) ?? 0
    return work.includes(d) && work.length ? monthFigure(t) / work.length : 0
  }

  const reps: (Pace & { divided: boolean; t: SalesTarget })[] = targets
    .filter(t => t.month === month && monthFigure(t) > 0)
    .map(t => {
      const divided = datesOf(month).some(d => setFigure(t, d) !== null)
      const dueByToday = Math.round(datesOf(month)
        .filter(d => d <= today)
        .reduce((n, d) => n + dayFigure(t, d, divided), 0))
      const done = packetsOrdered(allocations as any, t.uid, month, productId)
      const rate = elapsed.length ? done / elapsed.length : 0
      const target = monthFigure(t)
      return {
        uid: t.uid, name: t.name, target, dueByToday, done,
        projected: Math.round(done + rate * left.length),
        neededPerDay: left.length ? Math.ceil(Math.max(0, target - done) / left.length) : null,
        daysLeft: left.length,
        divided, t,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const sum = (f: (p: Pace) => number) => reps.reduce((n, p) => n + f(p), 0)
  const teamTarget = sum(p => p.target)
  const teamDone = sum(p => p.done)
  const team: Pace = {
    uid: 'team', name: 'Team',
    target: teamTarget,
    dueByToday: sum(p => p.dueByToday),
    done: teamDone,
    projected: sum(p => p.projected),
    neededPerDay: left.length ? Math.ceil(Math.max(0, teamTarget - teamDone) / left.length) : null,
    daysLeft: left.length,
  }

  // Day by day, added up. The actual line stops at today; the projection
  // starts there, so the two meet rather than overlap.
  const teamRate = elapsed.length ? teamDone / elapsed.length : 0
  let target = 0, actual = 0, projected = teamDone
  const series: PacePoint[] = datesOf(month).map(d => {
    target += reps.reduce((n, p) => n + dayFigure(p.t, d, p.divided), 0)
    if (d <= today) actual += reps.reduce((n, p) => n + packetsOrderedOn(allocations as any, p.uid, d, productId), 0)
    if (d > today && work.includes(d)) projected += teamRate
    return {
      label: new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      target: Math.round(target),
      actual: d <= today ? actual : null,
      projected: d >= today ? Math.round(projected) : null,
    }
  })

  return { reps: reps.map(({ divided, t, ...p }) => p), team, series }
}

// ── 2. strike rate ───────────────────────────────────────────────────────────

/**
 * A visit that ended in an order. `orderPlaced` is the flag the outlet screen
 * sets; "order booked" as the recorded outcome says the same thing, and either
 * is enough.
 */
export const isProductive = (v: OutletVisit) =>
  v.orderPlaced === true || v.remarksCategory === 'order_booked'

export interface Strike {
  visits: number
  productive: number
  /** Whole percent, or null with no visits — 0 of 0 is not a rate. */
  rate: number | null
}

/**
 * "Did this visit order this product?"
 *
 * The visit carries the ids of the orders raised during it, and that decides.
 * A visit from before that link was kept falls back to an order by the same
 * rep, at the same shop, on the same day — the order the visit produced in all
 * but name.
 */
export function orderedProductAt(allocations: UnifiedAllocation[], productId: string) {
  const byId = new Map(allocations.map(a => [a.id!, a]))
  const sameDay = new Set(allocations
    .filter(a => a.status !== 'cancelled' && a.productId === productId && a.createdAt)
    .map(a => `${a.createdBy}|${a.partyId}|${localDateStr(new Date(a.createdAt))}`))
  return (v: OutletVisit) => {
    const ids = v.allocationIds ?? []
    if (ids.length) {
      return ids.some(id => {
        const a = byId.get(id)
        return !!a && a.status !== 'cancelled' && a.productId === productId
      })
    }
    // Without the link, the visit must itself have ended in an order — a
    // second, empty call at the same shop that day did not order anything.
    return isProductive(v) && sameDay.has(`${v.uid}|${v.partyId}|${v.date}`)
  }
}

export function strikeOf(
  visits: OutletVisit[],
  /** Counts a visit as productive only when it ordered this — for one product. */
  productive_?: (v: OutletVisit) => boolean,
): Strike {
  const vs = visits.filter(v => v.status !== 'abandoned')
  const productive = vs.filter(productive_ ?? isProductive).length
  return {
    visits: vs.length,
    productive,
    rate: vs.length ? Math.round((productive / vs.length) * 100) : null,
  }
}

/** Below this many visits a rate says more about luck than about selling. */
export const MIN_VISITS_FOR_RATE = 5

// ── 3. coverage ──────────────────────────────────────────────────────────────

export interface Coverage {
  id: string
  name: string
  places: string
  /** Shops the beat is meant to cover. */
  shops: number
  /** Of those, visited at least once in the window. */
  visited: number
  /** Of those, ordered at least once in the window — "effective coverage". */
  ordered: number
}

/** A shop that is still in business with us — rejected or closed ones are not owed a visit. */
const live = (p: Party) => (p as any).status !== 'inactive' && (p as any).status !== 'rejected'

/**
 * For each beat: how many of its shops were visited, and how many ordered.
 *
 * Visited is reach; ordered is what reach turned into. The gap between the two
 * columns is the selling; the gap between visited and the beat's size is the
 * walking.
 */
/** Narrowing for the coverage table. Every field optional; none means everything. */
export interface CoverageFilter {
  /**
   * One rep: only the beats they were assigned in the window, and only their
   * own visits and orders counted against them.
   */
  uid?: string
  /** The beats that rep was assigned — worked out by the caller from the plans. */
  beatIds?: Set<string>
  /** One place: only that area's shops, and only beats that have some. */
  area?: string
  /** One product: "ordered" means ordered this. Visited stays every visit. */
  productId?: string
}

export function coverageOf(
  routes: SalesRoute[],
  parties: Party[],
  visits: OutletVisit[],
  allocations: UnifiedAllocation[],
  range: { from: string; to: string },
  filter: CoverageFilter = {},
): { beats: Coverage[]; all: Coverage; offBeat: number } {
  const liveIds = new Set(parties.filter(live)
    .filter(p => !filter.area || (p.place || '') === filter.area)
    .map(p => p.id!))
  const inRange = (d: string) => d >= range.from && d <= range.to
  const visitedIds = new Set(visits
    .filter(v => v.status !== 'abandoned' && inRange(v.date) && (!filter.uid || v.uid === filter.uid))
    .map(v => v.partyId))
  const orderedIds = new Set(allocations
    .filter(a => a.status !== 'cancelled' && a.createdAt
      && inRange(localDateStr(new Date(a.createdAt))) && a.partyId
      && (!filter.uid || a.createdBy === filter.uid)
      && (!filter.productId || a.productId === filter.productId))
    .map(a => a.partyId as string))

  const of = (ids: string[], id: string, name: string, places: string): Coverage => {
    const own = ids.filter(x => liveIds.has(x))
    return {
      id, name, places,
      shops: own.length,
      visited: own.filter(x => visitedIds.has(x)).length,
      ordered: own.filter(x => orderedIds.has(x)).length,
    }
  }

  const active = routes.filter(r => r.active !== false)
  const shown = active.filter(r => !filter.beatIds || filter.beatIds.has(r.id!))
  const beats = shown
    .map(r => of([...new Set(r.outletIds ?? [])], r.id!, r.name,
      // With an area picked, the beat names only that area — the rest of its
      // round is not what is being counted.
      filter.area ? filter.area : routePlaces(r).join(', ')))
    .filter(c => c.shops > 0)
    .sort((a, b) => a.name.localeCompare(b.name))

  const onABeat = new Set(active.flatMap(r => r.outletIds ?? []))
  // With a person picked, "all shops" is all the shops on their beats.
  const allIds = filter.beatIds
    ? [...new Set(shown.flatMap(r => r.outletIds ?? []))]
    : [...liveIds]
  return {
    beats,
    all: of(allIds, 'all', filter.beatIds ? 'All their beats' : 'All shops', ''),
    offBeat: filter.beatIds ? 0 : [...liveIds].filter(x => !onABeat.has(x)).length,
  }
}

export const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : null

// ── growth ───────────────────────────────────────────────────────────────────

export interface MonthTotal {
  month: string
  /** "Jun 2026" */
  label: string
  value: number
  packets: number
  orders: number
  /** False for the month still under way. */
  complete: boolean
  /**
   * The first month with any orders, when they only start after the first
   * week — the month somebody began using the app, not a month of selling.
   * Shown, but kept out of the growth: against it, the next month always
   * looks like a leap.
   */
  partial: boolean
}

/** The last `count` months ending with the current one, oldest first. */
export function lastMonths(today: string, count: number): string[] {
  const [y, m] = today.split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(y, m - 1 - (count - 1 - i), 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
}

/** Orders by calendar month, cancellations excluded. */
export function monthlyTotals(
  allocations: UnifiedAllocation[], months: string[], today: string,
  productId?: string,
): MonthTotal[] {
  const current = today.slice(0, 7)
  return months.map(month => {
    const mine = allocations.filter(a => a.status !== 'cancelled' && a.createdAt
      && (!productId || a.productId === productId)
      && localDateStr(new Date(a.createdAt)).slice(0, 7) === month)
    const firstDay = mine.length
      ? Math.min(...mine.map(a => new Date(a.createdAt).getDate())) : null
    return {
      month,
      label: new Date(month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
      value: Math.round(mine.reduce((n, a) => n + (a.totalAmount || 0), 0)),
      packets: mine.reduce((n, a) => n + (a.packets || 0), 0),
      orders: mine.length,
      complete: month < current,
      partial: false,
      firstDay,
    }
  }).map((t, i, all) => {
    // Only the first month that has anything can be the one somebody started in.
    const isFirst = t.orders > 0 && all.slice(0, i).every(x => x.orders === 0)
    const { firstDay, ...rest } = t
    return { ...rest, partial: isFirst && firstDay !== null && firstDay > 7 }
  })
}

/**
 * Month on month, and the average monthly rate across them.
 *
 * Only complete months count. The month under way is always "down" against a
 * whole one until its last day, which is not growth, only the calendar.
 *
 * The average is the compound monthly rate — the one steady rate that would
 * take the first complete month to the last. A plain average of the monthly
 * changes overstates it: +50% then −50% averages to zero but leaves you at
 * three quarters of where you started.
 */
export function growthOf(totals: MonthTotal[]): {
  /** Change against the month before, in whole percent; null where there is nothing to compare. */
  change: (number | null)[]
  /** Compound monthly growth over the complete months with orders, or null with fewer than three. */
  average: number | null
  /** How many complete months the average is over. */
  span: number
} {
  const change = totals.map((t, i) => {
    if (i === 0 || !t.complete || t.partial || totals[i - 1].partial) return null
    const before = totals[i - 1].value
    return before > 0 ? Math.round(((t.value - before) / before) * 100) : null
  })
  const done = totals.filter(t => t.complete && !t.partial && t.value > 0)
  if (done.length < 3) return { change, average: null, span: done.length }
  const first = done[0].value, last = done[done.length - 1].value
  const average = Math.round((Math.pow(last / first, 1 / (done.length - 1)) - 1) * 1000) / 10
  return { change, average, span: done.length }
}

// ── is there enough history to compare? ──────────────────────────────────────

/**
 * Whether the earlier period has enough in it for a comparison to mean
 * anything.
 *
 * Days with any visit or order, in each period. When the earlier one has
 * fewer than half as many working days of activity — a new rep, a new
 * install, a month before anybody used the app — every figure reads as a
 * leap of a thousand percent, which is true and useless. Better to say so.
 */
export function enoughHistory(
  visits: OutletVisit[], allocations: UnifiedAllocation[],
  current: { from: string; to: string }, previous: { from: string; to: string },
): boolean {
  const days = (r: { from: string; to: string }) => {
    const set = new Set<string>()
    visits.forEach(v => { if (v.date >= r.from && v.date <= r.to) set.add(v.date) })
    allocations.forEach(a => {
      if (!a.createdAt) return
      const d = localDateStr(new Date(a.createdAt))
      if (d >= r.from && d <= r.to) set.add(d)
    })
    return set.size
  }
  const now = days(current)
  return now === 0 || days(previous) >= now / 2
}
