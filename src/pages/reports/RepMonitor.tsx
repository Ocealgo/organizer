import { useState, useEffect, useMemo } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import {
  AppUser, OutletVisit, DutySession, WorkPlan, SalesRoute, SalesTarget,
  UnifiedAllocation, OutletType, OUTLET_TYPE_LABEL, ExpenseEntry, Party, Product,
  dailyTargetFor, packetsOrderedOn, dateOfMs, routePlaces, productDailyTargets,
} from '../../types'
import { useTheme } from '../../context/ThemeContext'
import CustomSelect from '../../components/CustomSelect'
import DateInput from '../../components/DateInput'
import WeekPicker from '../../components/WeekPicker'
import FieldReport from '../admin/FieldReport'
import { PageHeader, Eyebrow, EmptyState, Note, TabBar, GhostButton } from '../../components/ui'
import RankedBars from '../../components/RankedBars'
import { localDateStr, localMonthStr, isSunday } from '../../utils/date'
import { pathLengthKm } from '../../device/location'

interface Props {
  onBack: () => void
  /** Which tab to open on — the dashboard's rep rows open Field activity. */
  initialTab?: Tab
  /** Field activity opened already filtered to one person. */
  initialWho?: string
}

type RangeMode = 'day' | 'week' | 'month' | 'custom'
type Outcome = 'all' | 'met' | 'missed' | 'untargeted'
type Tab = 'eod' | 'field' | 'report'
type ReportRange = 'week' | 'month' | 'custom'
type Rank = 'packets' | 'orders' | 'value'
const RANK_TITLE: Record<Rank, string> = {
  packets: 'Packets ordered', orders: 'Orders placed', value: 'Order value',
}
const RANK_CHIP: Record<Rank, string> = {
  packets: 'Packets', orders: 'Orders placed', value: 'Order value',
}
const RANK_FORMAT: Record<Rank, (n: number) => string> = {
  packets: n => `${n.toLocaleString('en-IN')} pkts`,
  orders: n => `${n.toLocaleString('en-IN')} order${n === 1 ? '' : 's'}`,
  value: n => `₹${n.toLocaleString('en-IN')}`,
}

/**
 * One rep over the report's range — everything the table shows and the graph
 * ranks, worked out once so the two cannot disagree.
 */
export interface RepWeek {
  uid: string
  name: string
  /** Where they actually went: the places of the shops they punched into. */
  areas: string[]
  visits: number
  shops: number
  daysWorked: number
  orders: number
  packets: number
  value: number
  /** Sum of the days' targets in range, or null when no day carried one. */
  target: number | null
  daysTargeted: number
  daysMet: number
  meterKm: number
  expenses: number
}

/**
 * One card per rep per day — the end of a day, said in six lines.
 *
 * The reports that existed answer different questions. Field activity is a
 * drill-down: one rep's day opened up, every remark and meter reading in it.
 * The sales report is a grid: totals per person over a range, for export. What
 * neither does is let somebody scan a week and see which days landed, which is
 * the question a manager actually opens the app with.
 *
 * So this is deliberately not another grid. A card is a fixed shape, and a
 * fixed shape can be read at a glance and compared with the one under it — the
 * whole value is in the sameness. Nothing here is computed that is not already
 * recorded somewhere else; it is the same facts, arranged to be scanned.
 */

/** Monday of the week containing `d`. */
function mondayOf(d: string): string {
  const x = new Date(d + 'T00:00:00')
  x.setDate(x.getDate() - (x.getDay() === 0 ? 6 : x.getDay() - 1))
  return localDateStr(x)
}

function addDays(d: string, n: number): string {
  const x = new Date(d + 'T00:00:00')
  x.setDate(x.getDate() + n)
  return localDateStr(x)
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return localDateStr(new Date(y, m, 0))
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from
  // A guard rather than trust: a custom range is two text inputs, and a
  // mistyped year should produce a short answer rather than a hung tab.
  let guard = 0
  while (cur <= to && guard++ < 200) { out.push(cur); cur = addDays(cur, 1) }
  return out
}

/** "Mon 12 Oct" — short enough to sit in a range. */
const shortDay = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

const longDay = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-IN',
    { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })

/** dd/mm/yyyy — the way a date is written on paper here. */
const plainDate = (d: string) => {
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

/** One rep's one day, with everything the card shows already worked out. */
interface Eod {
  uid: string
  name: string
  date: string
  /** The beat assigned, and the areas it covers. Absent when nobody assigned one. */
  routeName?: string
  routePlaces: string[]
  shops: number
  byType: { type: OutletType; n: number }[]
  target: number | null
  packets: number
  orders: number
  /** Whether they started the day at all — a card with no session says so. */
  present: boolean
  /**
   * What the odometer said. Null whenever there is no reading to give — no
   * session, a broken meter, no vehicle, or a day closed automatically with no
   * closing reading — and the card says "Nil" rather than guessing.
   */
  meterKm: number | null
  /**
   * Straight-line kilometres through the day's stops: where it started, each
   * shop punched into in order, where it finished.
   *
   * Not a road distance and not claimed as one. Nothing records which roads
   * anybody took, so this is the shortest the day could have been — a floor
   * under the meter, never a substitute for it. Null when there are fewer
   * than two positions to join.
   */
  visitKm: number | null
  /** What the rep claimed for the day, if anything. */
  expense: { total: number; allowance: number; fuel: number; other: number } | null
  /** A fuel claim above what the meter said — the one worth a second look. */
  fuelAboveMeter: boolean
}

export default function RepMonitor({ onBack, initialTab, initialWho }: Props) {
  const { t } = useTheme()

  const [reps, setReps] = useState<AppUser[]>([])
  const [visits, setVisits] = useState<OutletVisit[]>([])
  const [sessions, setSessions] = useState<DutySession[]>([])
  const [plans, setPlans] = useState<WorkPlan[]>([])
  const [routes, setRoutes] = useState<SalesRoute[]>([])
  const [targets, setTargets] = useState<SalesTarget[]>([])
  const [allocations, setAllocations] = useState<UnifiedAllocation[]>([])
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([])
  const [parties, setParties] = useState<Party[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [readError, setReadError] = useState<string | null>(null)
  /**
   * Ranged reads still owed their first answer. Until it reaches zero the
   * figures on screen are part-loaded — fine to watch fill in, wrong to
   * freeze into a PDF, so the download waits for it.
   */
  const [pending, setPending] = useState(0)

  const [tab, setTab] = useState<Tab>(initialTab ?? 'eod')

  // ── the report's own filters ───────────────────────────────────────────────
  // Separate from the end-of-day ones above, so moving between the tabs does not
  // drag one view's window into the other.
  const [rMode, setRMode] = useState<ReportRange>('week')
  const [rWeekStart, setRWeekStart] = useState(mondayOf(localDateStr()))
  const [rMonth, setRMonth] = useState(localMonthStr())
  const [rFrom, setRFrom] = useState(addDays(localDateStr(), -6))
  const [rTo, setRTo] = useState(localDateStr())
  /** '' means every product. */
  const [rProduct, setRProduct] = useState('')
  const [rBeat, setRBeat] = useState('')
  const [rank, setRank] = useState<Rank>('packets')
  /** The PDF is being built; the button says so and is not pressed twice. */
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  // ── filters ───────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<RangeMode>('day')
  /**
   * The last day that could have been worked, not literally today.
   *
   * Opening on a Sunday meant opening on a day with no target on it by
   * definition — every card read "No target" and the screen looked broken on
   * one day in seven. A monitor should open on the last day there was
   * something to monitor.
   */
  const [day, setDay] = useState(() => {
    let d = localDateStr()
    while (isSunday(d)) d = addDays(d, -1)
    return d
  })
  const [weekStart, setWeekStart] = useState(mondayOf(localDateStr()))
  const [month, setMonth] = useState(localMonthStr())
  const [customFrom, setCustomFrom] = useState(addDays(localDateStr(), -6))
  const [customTo, setCustomTo] = useState(localDateStr())
  const [who, setWho] = useState('')
  const [beat, setBeat] = useState('')
  const [outcome, setOutcome] = useState<Outcome>('all')
  /** Sundays and days nobody worked are noise until somebody asks for them. */
  const [showQuiet, setShowQuiet] = useState(false)

  const [eodFrom, eodTo] = useMemo((): [string, string] => {
    if (mode === 'day') return [day, day]
    if (mode === 'week') return [weekStart, addDays(weekStart, 6)]
    if (mode === 'month') return [`${month}-01`, lastDayOfMonth(month)]
    return customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom]
  }, [mode, day, weekStart, month, customFrom, customTo])

  /**
   * The report's window. A week is Monday to Saturday, matching the planner,
   * which treats Sunday as off — a weekly report that counted Sundays would
   * divide the same work by a different number of days than the targets were.
   */
  const [repFrom, repTo] = useMemo((): [string, string] => {
    if (rMode === 'week') return [rWeekStart, addDays(rWeekStart, 5)]
    if (rMode === 'month') return [`${rMonth}-01`, lastDayOfMonth(rMonth)]
    return rFrom <= rTo ? [rFrom, rTo] : [rTo, rFrom]
  }, [rMode, rWeekStart, rMonth, rFrom, rTo])

  // One set of listeners, pointed at whichever window is on screen.
  const [from, to] = tab === 'report' ? [repFrom, repTo] : [eodFrom, eodTo]

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'users'), s =>
      setReps(s.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser))
        .filter(u => u.status === 'approved'
          && (u.role === 'offline_sales' || u.role === 'online_sales'))
        .sort((a, b) => a.name.localeCompare(b.name))))
    const u2 = onSnapshot(collection(db, 'sales_routes'), s =>
      setRoutes(s.docs.map(d => ({ id: d.id, ...d.data() } as SalesRoute))))
    // For the report: where a visited shop is, and the products to filter by.
    const u2p = onSnapshot(collection(db, 'parties'), s =>
      setParties(s.docs.map(d => ({ id: d.id, ...d.data() } as Party))))
    const u2q = onSnapshot(collection(db, 'products'), s =>
      setProducts(s.docs.map(d => ({ id: d.id, ...d.data() } as Product))
        .filter(x => x.active).sort((a, b) => a.name.localeCompare(b.name))))
    return () => { u1(); u2(); u2p(); u2q() }
  }, [])

  useEffect(() => {
    if (tab === 'field') return
    setReadError(null)
    setPending(6)
    /** Wraps a listener so its first answer, good or bad, counts it as arrived. */
    const first = () => {
      let done = false
      return () => { if (!done) { done = true; setPending(n => Math.max(0, n - 1)) } }
    }
    const fail = (what: string, arrived: () => void) => (err: any) => {
      arrived()
      setReadError(err?.code === 'permission-denied'
        ? 'Firestore turned down a read. The deployed rules may be older than this build.'
        : `Could not load ${what}.`)
    }

    /**
     * Each collection by the field it is dated on, which is not the same field
     * in each. A visit and a session carry a `date` string; an order carries
     * `createdAt`, a timestamp — and that is the one a day's orders are counted
     * by, so it is bounded by the day's edges in milliseconds rather than by a
     * string compare that would not work on it.
     */
    const fromMs = new Date(from + 'T00:00:00').getTime()
    const toMs = new Date(to + 'T23:59:59.999').getTime()

    // Targets live one document per rep-month, so a range is asked for by the
    // months it touches rather than by its days.
    const months = [...new Set(eachDay(from, to).map(d => d.slice(0, 7)))].slice(0, 12)

    const arrived = Array.from({ length: 6 }, first)
    const unsubs = [
      onSnapshot(
        query(collection(db, 'outlet_visits'), where('date', '>=', from), where('date', '<=', to)),
        s => { arrived[0](); setVisits(s.docs.map(d => ({ id: d.id, ...d.data() } as OutletVisit))) },
        fail('the visits', arrived[0]),
      ),
      onSnapshot(
        query(collection(db, 'duty_sessions'), where('date', '>=', from), where('date', '<=', to)),
        s => { arrived[1](); setSessions(s.docs.map(d => ({ id: d.id, ...d.data() } as DutySession))) },
        fail('the days', arrived[1]),
      ),
      onSnapshot(
        query(collection(db, 'work_plans'), where('date', '>=', from), where('date', '<=', to)),
        s => { arrived[2](); setPlans(s.docs.map(d => ({ id: d.id, ...d.data() } as WorkPlan))) },
        fail('the beats assigned', arrived[2]),
      ),
      onSnapshot(
        query(collection(db, 'allocations_v2'),
          where('createdAt', '>=', fromMs), where('createdAt', '<=', toMs)),
        s => { arrived[3](); setAllocations(s.docs.map(d => ({ id: d.id, ...d.data() } as UnifiedAllocation))) },
        fail('the orders', arrived[3]),
      ),
      onSnapshot(
        query(collection(db, 'sales_targets'), where('month', 'in', months)),
        s => { arrived[4](); setTargets(s.docs.map(d => ({ id: d.id, ...d.data() } as SalesTarget))) },
        fail('the targets', arrived[4]),
      ),
      // Dated by the day the money was spent, a string, like visits.
      onSnapshot(
        query(collection(db, 'expense_entries'), where('date', '>=', from), where('date', '<=', to)),
        s => { arrived[5](); setExpenses(s.docs.map(d => ({ id: d.id, ...d.data() } as ExpenseEntry))) },
        fail('the expenses', arrived[5]),
      ),
    ]
    return () => unsubs.forEach(u => u())
  }, [from, to, tab])

  // ── one card per rep per day ───────────────────────────────────────────────
  const cards = useMemo((): Eod[] => {
    const days = eachDay(from, to)
    const people = who ? reps.filter(r => r.uid === who) : reps
    const out: Eod[] = []

    for (const date of days) {
      for (const r of people) {
        const plan = plans.find(p => p.uid === r.uid && p.date === date)
        const route = plan?.routeId ? routes.find(x => x.id === plan.routeId) : undefined
        // A beat filter asks about the beat that was assigned, so a day with no
        // beat on it cannot match one and is not offered as though it might.
        if (beat && plan?.routeId !== beat) continue

        // Abandoned visits are left out. They are a form somebody opened and
        // walked away from, and counting them would make a day look worked.
        const theirs = visits.filter(v =>
          v.uid === r.uid && v.date === date && v.status !== 'abandoned')
        const counts = new Map<OutletType, number>()
        theirs.forEach(v => counts.set(v.outletType, (counts.get(v.outletType) ?? 0) + 1))

        const target = dailyTargetFor(targets.find(x =>
          x.uid === r.uid && x.month === date.slice(0, 7)), date)
        const packets = packetsOrderedOn(allocations as any, r.uid, date)
        const orders = allocations.filter(a =>
          a.createdBy === r.uid && a.status !== 'cancelled'
          && a.createdAt && dateOfMs(a.createdAt) === date).length
        const session = sessions.find(s => s.uid === r.uid && s.date === date)
        const present = !!session

        const meterKm = session
          && (session.odometerStatus ?? 'recorded') === 'recorded'
          && typeof session.claimedDistanceKm === 'number'
          ? session.claimedDistanceKm
          : null

        // The day's positions, in the order they happened. A stop without a
        // fix is left out rather than guessed at.
        const points = [
          ...(session?.startLocation ? [session.startLocation] : []),
          ...theirs
            .filter(v => v.punchInLocation)
            .sort((a, b) => a.punchInAt - b.punchInAt)
            .map(v => v.punchInLocation!),
          ...(session?.endLocation && !session.autoClosed ? [session.endLocation] : []),
        ]
        const visitKm = points.length >= 2
          ? Math.round(pathLengthKm(points) * 10) / 10
          : null

        const spent = expenses.filter(e => e.userId === r.uid && e.date === date)
        const sum = (f: (e: ExpenseEntry) => boolean) =>
          Math.round(spent.filter(f).reduce((n, e) => n + (e.amount || 0), 0) * 100) / 100
        const expense = spent.length === 0 ? null : {
          total: sum(() => true),
          allowance: sum(e => e.type === 'allowance'),
          fuel: sum(e => e.type === 'variable' && e.category === 'fuel'),
          other: sum(e => e.type === 'variable' && e.category !== 'fuel'),
        }
        const fuelAboveMeter = spent.some(e =>
          e.category === 'fuel' && typeof e.distanceKm === 'number'
          && typeof (e.meterKm ?? meterKm) === 'number'
          && e.distanceKm > (e.meterKm ?? meterKm)!)

        /**
         * A day nobody expected anything of and nothing happened on.
         *
         * `target === null` is part of it, and that is the important part: a
         * day somebody set a figure for and then nothing was delivered on is
         * the most important card on this screen, not a quiet one. Without it
         * the days worth looking at were exactly the days being hidden.
         *
         * A Sunday is quiet unless a target says otherwise, for the same
         * reason — if somebody put a number on a Sunday they meant it.
         */
        const expected = target !== null
        const happened = present || theirs.length > 0 || packets > 0
        /**
         * Quiet: nothing was asked of the day and nothing happened on it.
         *
         * A Sunday was hidden on the first half alone — no target, so quiet —
         * which made a rep who actually worked a Sunday invisible to the
         * manager monitoring them. That is the least quiet Sunday there is.
         * So a day only goes quiet when nothing happened as well, and on a
         * weekday also only when no beat was assigned: a day somebody planned
         * and nobody showed up for is worth seeing.
         */
        const quiet = !expected && !happened && (isSunday(date) || !plan)
        if (!showQuiet && quiet) continue

        if (outcome === 'met' && !(target !== null && packets >= target)) continue
        if (outcome === 'missed' && !(target !== null && packets < target)) continue
        if (outcome === 'untargeted' && target !== null) continue

        out.push({
          uid: r.uid, name: r.name, date,
          routeName: plan?.routeName,
          routePlaces: route ? routePlaces(route) : [],
          shops: theirs.length,
          byType: [...counts.entries()]
            .map(([type, n]) => ({ type, n }))
            .sort((a, b) => b.n - a.n),
          target, packets, orders, present,
          meterKm, visitKm, expense, fuelAboveMeter,
        })
      }
    }
    // Newest day first, people alphabetical inside it.
    return out.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))
  }, [from, to, reps, who, beat, outcome, showQuiet, visits, sessions, plans, routes,
      targets, allocations, expenses])

  const byDay = useMemo(() => {
    const m = new Map<string, Eod[]>()
    cards.forEach(c => { if (!m.has(c.date)) m.set(c.date, []); m.get(c.date)!.push(c) })
    return [...m.entries()]
  }, [cards])

  /**
   * The report: one row per rep over the window, every figure from the same
   * pass.
   *
   * The product filter narrows what a product can be said to own — the
   * packets, their value, the targets and the days met — and nothing else.
   * A visit, a kilometre or a bus fare is not "of" a product, so filtering
   * those would be inventing a split the data does not have.
   *
   * The beat filter narrows the days: a day counts for a rep only when that
   * beat was the one assigned to them, which is the only way "how did Beach
   * Road go" has an answer when the same person works three beats a week.
   */
  /** The figure the graph ranks by, and the table sorts by. */
  const rankValue = (r: RepWeek) =>
    rank === 'packets' ? r.packets : rank === 'orders' ? r.orders : r.value

  const report = useMemo((): RepWeek[] => {
    if (tab !== 'report') return []
    // Up to today and no further. A month still under way is measured against
    // the days that have happened: holding a rep to the 30th on the 18th makes
    // every rep look a third short and every future day look missed.
    const today = localDateStr()
    const days = eachDay(repFrom, repTo).filter(d => d <= today)
    const placeOf = new Map(parties.map(pt => [pt.id!, pt.place || '']))

    return reps.map(r => {
      const planOn = (d: string) => plans.find(pl => pl.uid === r.uid && pl.date === d)
      const inScope = (d: string) => !rBeat || planOn(d)?.routeId === rBeat
      const scoped = days.filter(inScope)
      const inDays = new Set(scoped)

      const theirVisits = visits.filter(v =>
        v.uid === r.uid && inDays.has(v.date) && v.status !== 'abandoned')
      const theirOrders = allocations.filter(a =>
        a.createdBy === r.uid && a.status !== 'cancelled' && a.createdAt
        && inDays.has(dateOfMs(a.createdAt))
        && (!rProduct || a.productId === rProduct))
      const theirSessions = sessions.filter(se => se.uid === r.uid && inDays.has(se.date))
      const theirSpend = expenses.filter(e => e.userId === r.uid && inDays.has(e.date))

      // Targets and days met, a day at a time, for the product in question.
      let target = 0
      let daysTargeted = 0
      let daysMet = 0
      for (const d of scoped) {
        const t = targets.find(x => x.uid === r.uid && x.month === d.slice(0, 7))
        const goal = rProduct
          ? (productDailyTargets(t, d)?.[rProduct] ?? null)
          : dailyTargetFor(t, d)
        if (goal === null || goal <= 0) continue
        target += goal
        daysTargeted++
        const did = packetsOrderedOn(allocations as any, r.uid, d, rProduct || undefined)
        if (did >= goal) daysMet++
      }

      const areas = [...new Set(theirVisits
        .map(v => placeOf.get(v.partyId))
        .filter((x): x is string => !!x))].sort()

      return {
        uid: r.uid,
        name: r.name,
        areas,
        visits: theirVisits.length,
        shops: new Set(theirVisits.map(v => v.partyId)).size,
        daysWorked: theirSessions.length,
        orders: theirOrders.length,
        packets: theirOrders.reduce((n, a) => n + (a.packets || 0), 0),
        value: Math.round(theirOrders.reduce((n, a) => n + (a.totalAmount || 0), 0)),
        target: daysTargeted > 0 ? target : null,
        daysTargeted,
        daysMet,
        meterKm: Math.round(theirSessions.reduce((n, se) =>
          n + ((se.odometerStatus ?? 'recorded') === 'recorded' && typeof se.claimedDistanceKm === 'number'
            ? se.claimedDistanceKm : 0), 0)),
        expenses: Math.round(theirSpend.reduce((n, e) => n + (e.amount || 0), 0) * 100) / 100,
      }
    })
    // The table reads in the graph's order, so the two say the same thing in
    // the same sequence.
    .sort((a, b) => (rankValue(b) - rankValue(a))
      || a.name.localeCompare(b.name))
  }, [tab, repFrom, repTo, reps, plans, visits, allocations, sessions, expenses, targets,
      parties, rProduct, rBeat, rank])

  /**
   * The report as a PDF, with whatever filters are on screen — the file says
   * which, so it still makes sense once it has left the app.
   */
  const downloadPdf = async () => {
    setPdfBusy(true)
    setPdfError(null)
    try {
      const { downloadRepReportPdf } = await import('./repReportPdf')
      const counted = repTo > localDateStr() ? ' · counted up to today' : ''
      await downloadRepReportPdf(report, {
        period: `${shortDay(repFrom)} – ${shortDay(repTo)}`
          + (rMode === 'week' ? ' · Monday to Saturday' : '') + counted,
        product: rProduct ? products.find(x => x.id === rProduct)?.name ?? 'One product' : 'All products',
        beat: rBeat ? routes.find(x => x.id === rBeat)?.name ?? 'One beat' : 'Any beat',
        rankTitle: RANK_TITLE[rank],
        rankValue,
        rankFormat: RANK_FORMAT[rank],
        from: repFrom,
        to: repTo,
      })
    } catch (e) {
      console.error('[RepMonitor] PDF failed', e)
      setPdfError('The PDF could not be made. Try again, or check the connection if this keeps happening.')
    } finally {
      setPdfBusy(false)
    }
  }

  /** Who is first — more than one when they are level. Nobody, when nothing was ordered. */
  const leaders = useMemo(() => {
    const top = report.length ? rankValue(report[0]) : 0
    return top > 0 ? report.filter(r => rankValue(r) === top) : []
  }, [report, rank])

  const tally = useMemo(() => ({
    met: cards.filter(c => c.target !== null && c.packets >= c.target).length,
    missed: cards.filter(c => c.target !== null && c.packets < c.target).length,
    untargeted: cards.filter(c => c.target === null).length,
  }), [cards])

  // ── chrome ────────────────────────────────────────────────────────────────
  const chip = (active: boolean) => ({
    background: 'none',
    border: `0.5px solid ${active ? t.text2 : t.border}`,
    borderRadius: 99, padding: '6px 13px', fontSize: 12, fontWeight: 400 as const,
    color: active ? t.text : t.text3, cursor: 'pointer', whiteSpace: 'nowrap' as const,
  })

  /**
   * One figure of the card, label above value, sitting beside the next.
   *
   * Across rather than down, which is what makes a stack of these scannable:
   * the same figure is in the same column on every card, so a week of them
   * reads as four columns rather than as twenty-eight lines. Wrapping is left
   * to the row — on a phone they fall into two columns and then one.
   *
   * `met` carries meaning and nothing else does. A name wants weight, not a
   * colour saying the person succeeded.
   */
  const Cell = ({ label, value, sub, tone, grow }: {
    label: string
    value: React.ReactNode
    sub?: string
    tone?: 'warn' | 'met'
    /** Route is prose and needs the room; the numbers do not. */
    grow?: boolean
  }) => (
    <div style={{ flex: grow ? '2 1 190px' : '1 1 120px', minWidth: 0 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: t.text3, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        fontSize: 14, lineHeight: 1.35,
        color: tone === 'warn' ? t.warn : tone === 'met' ? t.good : t.text,
        fontWeight: tone ? 500 : 400,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: t.text3, marginTop: 2, lineHeight: 1.4 }}>
          {sub}
        </div>
      )}
    </div>
  )

  return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 56 }}>
      <PageHeader
        eyebrow="Reports"
        title="Monitor reps"
        subtitle={tab === 'eod'
          ? 'The end of each day, one card per person — what they covered and whether it met the target.'
          : tab === 'field'
            ? 'Attendance, meter readings and every outlet visit with its remarks.'
            : 'Who is leading over a stretch of days, and what sits behind it.'}
        onBack={onBack}
      />
      <TabBar<Tab>
        tabs={[
          { id: 'eod', label: 'End of day' },
          { id: 'field', label: 'Field activity' },
          { id: 'report', label: 'Report' },
        ]}
        value={tab} onChange={setTab}
      />

      {tab === 'field' && (
        <div style={{ maxWidth: 900 }}>
          <FieldReport embedded onBack={onBack} initialWho={initialWho} />
        </div>
      )}

      {tab !== 'field' && (
      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 860 }}>
        {readError && <Note tone="warn">{readError}</Note>}

        {tab === 'eod' && (<>
        {/* ── WHEN ──────────────────────────────────────────────────────── */}
        <div>
          <div style={{ marginBottom: 8 }}><Eyebrow>When</Eyebrow></div>
          <div className="oc-scroll-x" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(['day', 'week', 'month', 'custom'] as RangeMode[]).map(m => (
              <button key={m} className="oc-action" onClick={() => setMode(m)} style={chip(mode === m)}>
                {m === 'day' ? 'A day' : m === 'week' ? 'A week' : m === 'month' ? 'A month' : 'A range'}
              </button>
            ))}
          </div>
          <div className="oc-wrap" style={{ gap: 12 }}>
            {mode === 'day' && (
              <div style={{ flex: 1, minWidth: 150 }}>
                <DateInput type="date" value={day} onChange={setDay} ariaLabel="Day" />
              </div>
            )}
            {mode === 'week' && (
              <div style={{ flex: 1, minWidth: 150 }}>
                <WeekPicker value={weekStart} onChange={setWeekStart} days={7} />
              </div>
            )}
            {mode === 'month' && (
              <div style={{ flex: 1, minWidth: 150 }}>
                <DateInput type="month" value={month} onChange={setMonth} />
              </div>
            )}
            {mode === 'custom' && (
              <>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <DateInput type="date" value={customFrom} onChange={setCustomFrom} />
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <DateInput type="date" value={customTo} onChange={setCustomTo} />
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── WHO, WHICH BEAT, WHAT HAPPENED ────────────────────────────── */}
        <div className="oc-wrap" style={{ gap: 14 }}>
          <div style={{ flex: 1, minWidth: 170 }}>
            <div style={{ marginBottom: 8 }}><Eyebrow>Who</Eyebrow></div>
            <CustomSelect
              value={who} onChange={setWho}
              options={[{ value: '', label: 'Everybody' },
                ...reps.map(r => ({ value: r.uid, label: r.name }))]}
              placeholder="Everybody"
            />
          </div>
          <div style={{ flex: 1, minWidth: 170 }}>
            <div style={{ marginBottom: 8 }}><Eyebrow>Beat</Eyebrow></div>
            <CustomSelect
              value={beat} onChange={setBeat}
              options={[{ value: '', label: 'Any beat' },
                ...routes.filter(r => r.active !== false)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(r => ({ value: r.id!, label: r.name, sub: routePlaces(r).join(', ') }))]}
              placeholder="Any beat"
            />
          </div>
        </div>

        <div>
          <div style={{ marginBottom: 8 }}><Eyebrow>Against the target</Eyebrow></div>
          <div className="oc-scroll-x" style={{ display: 'flex', gap: 6 }}>
            {([
              ['all', `Everything · ${cards.length}`],
              ['met', `Met · ${tally.met}`],
              ['missed', `Missed · ${tally.missed}`],
              ['untargeted', `No target set · ${tally.untargeted}`],
            ] as [Outcome, string][]).map(([k, label]) => (
              <button key={k} className="oc-action" onClick={() => setOutcome(k)} style={chip(outcome === k)}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="oc-action" onClick={() => setShowQuiet(v => !v)}
              aria-pressed={showQuiet}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: 13,
                       color: t.text3, cursor: 'pointer' }}>
              {showQuiet ? 'Hide days nothing happened on' : 'Show days nothing happened on'}
            </button>
          </div>
        </div>

        {/* ── THE CARDS ─────────────────────────────────────────────────── */}
        {byDay.length === 0 ? (
          <EmptyState
            title="No days to show"
            body={outcome === 'all'
              ? 'Nothing was logged in this window. Widen the dates, or show the days nothing happened on.'
              : 'No day in this window matches that. Try "Everything".'}
          />
        ) : byDay.map(([date, rows]) => (
          <div key={date}>
            <div style={{ marginBottom: 10 }}><Eyebrow>{longDay(date)}</Eyebrow></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rows.map(c => {
                const met = c.target !== null && c.packets >= c.target
                const missed = c.target !== null && c.packets < c.target
                return (
                  <div key={`${c.uid}_${c.date}`} style={{
                    border: `0.5px solid ${missed ? t.border2 : t.border}`,
                    borderLeft: `2px solid ${met ? t.good : missed ? t.warn : t.border}`,
                    borderRadius: 6, padding: '14px 16px',
                  }}>
                    {/* Who and when, across the top. They are identity rather
                        than figures, so they head the card instead of taking a
                        column in the row below. */}
                    <div className="oc-wrap" style={{ alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                      <span style={{ fontSize: 11, letterSpacing: '0.06em',
                                     textTransform: 'uppercase', color: t.text3 }}>
                        EOD
                      </span>
                      <span style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{c.name}</span>
                      <span style={{ fontSize: 13, color: t.text3 }}>{plainDate(c.date)}</span>
                      <span style={{ flex: 1 }} />
                      {/* The verdict, in words as well as colour. Colour alone
                          is not an answer for everybody reading it. */}
                      <span style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
                                     color: met ? t.good : missed ? t.warn : t.text3 }}>
                        {met ? '✓ Target met' : missed ? '✗ Short' : 'No target'}
                      </span>
                    </div>

                    <div className="oc-wrap" style={{ gap: 18, alignItems: 'flex-start' }}>
                      <Cell
                        label="Route"
                        grow
                        value={c.routeName || 'No beat assigned'}
                        sub={c.routeName && c.routePlaces.length
                          ? c.routePlaces.join(', ')
                          : undefined}
                      />
                      <Cell
                        label="Shops"
                        value={c.shops}
                        sub={c.shops === 0
                          ? undefined
                          : c.byType.map(b => `${b.n} ${OUTLET_TYPE_LABEL[b.type]}`).join(' · ')}
                      />
                      <Cell
                        label="Daily target"
                        value={c.target === null ? 'Not set' : c.target}
                        sub={c.target === null ? undefined : 'packets'}
                      />
                      <Cell
                        label="Order placed"
                        value={c.packets}
                        sub={`packets · ${c.orders} ${c.orders === 1 ? 'order' : 'orders'}`}
                        tone={missed ? 'warn' : met ? 'met' : undefined}
                      />
                    </div>

                    {/* Travel and spend, on a row of their own under a rule.
                        The row above is what was sold; this is what it took,
                        and keeping them apart is what lets either be read at a
                        glance. */}
                    <div className="oc-wrap" style={{
                      gap: 18, alignItems: 'flex-start', marginTop: 12, paddingTop: 12,
                      borderTop: `0.5px solid ${t.border}`,
                    }}>
                      <Cell
                        label="Meter"
                        value={c.meterKm === null ? 'Nil' : `${c.meterKm} km`}
                        sub={c.meterKm === null
                          ? (c.present ? 'no reading' : 'day not started')
                          : 'on the odometer'}
                      />
                      <Cell
                        label="Between shops"
                        value={c.visitKm === null ? 'Nil' : `${c.visitKm} km`}
                        // Said on the card, because two distances side by side
                        // invite the question of why they differ — and the
                        // answer has to be where the question is asked.
                        sub={c.visitKm === null ? 'not enough positions' : 'straight line, a floor'}
                      />
                      <Cell
                        label="Expenses"
                        grow
                        value={c.expense === null ? 'No' : `Yes · ₹${c.expense.total.toLocaleString('en-IN')}`}
                        sub={c.expense === null ? 'nothing claimed for the day' : [
                          c.expense.allowance ? `Allowance ₹${c.expense.allowance.toLocaleString('en-IN')}` : null,
                          c.expense.fuel ? `Fuel ₹${c.expense.fuel.toLocaleString('en-IN')}` : null,
                          c.expense.other ? `Other ₹${c.expense.other.toLocaleString('en-IN')}` : null,
                        ].filter(Boolean).join(' · ')}
                      />
                    </div>

                    {c.fuelAboveMeter && (
                      // The one combination worth a second look, said where
                      // the person monitoring will read it.
                      <div style={{ fontSize: 12, color: t.warn, marginTop: 10, lineHeight: 1.5 }}>
                        Fuel claimed above the meter — the reason is on the expense sheet.
                      </div>
                    )}

                    {!c.present && (
                      // Worth saying rather than leaving as a row of zeroes: a
                      // day nobody punched in on is a different fact from a day
                      // that went badly.
                      <div style={{ fontSize: 12, color: t.warn, marginTop: 10, lineHeight: 1.5 }}>
                        Never started the day.
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        <div style={{ fontSize: 12, color: t.text3, lineHeight: 1.6, maxWidth: 600 }}>
          Shops counted here are visits that were not abandoned. Packets are the orders the
          rep placed that day, cancellations excluded — the same measure the target is set
          in, so the two compare directly. A day with no target shows one rather than
          implying it was missed.
        </div>
        </>)}

        {tab === 'report' && (<>
        {/* ── FILTERS, one row of them ──────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ marginBottom: 8 }}><Eyebrow>When</Eyebrow></div>
            <div className="oc-wrap" style={{ gap: 6, alignItems: 'center' }}>
              {(['week', 'month', 'custom'] as ReportRange[]).map(m => (
                <button key={m} className="oc-action" onClick={() => setRMode(m)} style={chip(rMode === m)}>
                  {m === 'week' ? 'A week' : m === 'month' ? 'A month' : 'A range'}
                </button>
              ))}
              <div style={{ flex: '1 1 300px', display: 'flex', gap: 10, minWidth: 0 }}>
                {rMode === 'week' && (
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <WeekPicker value={rWeekStart} onChange={setRWeekStart} days={6} ariaLabel="Week" />
                  </div>
                )}
                {rMode === 'month' && (
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <DateInput type="month" value={rMonth} onChange={setRMonth} ariaLabel="Month" />
                  </div>
                )}
                {rMode === 'custom' && (
                  <>
                    <div style={{ flex: 1, minWidth: 130 }}>
                      <DateInput type="date" value={rFrom} onChange={setRFrom} ariaLabel="From" />
                    </div>
                    <div style={{ flex: 1, minWidth: 130 }}>
                      <DateInput type="date" value={rTo} onChange={setRTo} ariaLabel="To" />
                    </div>
                  </>
                )}
              </div>
            </div>
            <div style={{ fontSize: 12, color: t.text3, marginTop: 6 }}>
              {shortDay(repFrom)} – {shortDay(repTo)}{rMode === 'week' ? ' · Monday to Saturday' : ''}
              {repTo > localDateStr() ? ' · counted up to today' : ''}
            </div>
          </div>

          <div className="oc-wrap" style={{ gap: 14 }}>
            <div style={{ flex: 1, minWidth: 170 }}>
              <div style={{ marginBottom: 8 }}><Eyebrow>Product</Eyebrow></div>
              <CustomSelect
                value={rProduct} onChange={setRProduct}
                options={[{ value: '', label: 'All products' },
                  ...products.map(x => ({ value: x.id!, label: x.name }))]}
                placeholder="All products"
              />
            </div>
            <div style={{ flex: 1, minWidth: 170 }}>
              <div style={{ marginBottom: 8 }}><Eyebrow>Beat</Eyebrow></div>
              <CustomSelect
                value={rBeat} onChange={setRBeat}
                options={[{ value: '', label: 'Any beat' },
                  ...routes.filter(r => r.active !== false)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(r => ({ value: r.id!, label: r.name, sub: routePlaces(r).join(', ') }))]}
                placeholder="Any beat"
              />
            </div>
          </div>
        </div>

        {/* ── DOWNLOAD ──────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {pdfError && <span style={{ fontSize: 12, color: t.warn }}>{pdfError}</span>}
          <GhostButton onClick={downloadPdf} disabled={pdfBusy || pending > 0 || report.length === 0}>
            {pdfBusy ? 'Making the PDF…' : pending > 0 ? 'Loading…' : 'Download PDF'}
          </GhostButton>
        </div>

        {/* ── THE GRAPH ─────────────────────────────────────────────────── */}
        <div style={{ border: `0.5px solid ${t.border}`, borderRadius: 6, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>
                {RANK_TITLE[rank]}
              </div>
              {leaders.length > 0 && (
                <div style={{ fontSize: 13, color: t.text, marginTop: 4 }}>
                  {leaders.length === 1 ? 'Leading: ' : 'Level at the top: '}
                  <span style={{ fontWeight: 500 }}>{leaders.map(l => l.name).join(' and ')}</span>
                  {' · '}{RANK_FORMAT[rank](rankValue(leaders[0]))}
                </div>
              )}
              <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>
                {rProduct ? products.find(x => x.id === rProduct)?.name ?? 'One product' : 'All products'}
                {rBeat ? ` · ${routes.find(x => x.id === rBeat)?.name ?? 'one beat'}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }} role="group" aria-label="Rank by">
              {(['packets', 'orders', 'value'] as Rank[]).map(k => (
                <button key={k} className="oc-action" onClick={() => setRank(k)}
                  aria-pressed={rank === k} style={chip(rank === k)}>
                  {RANK_CHIP[k]}
                </button>
              ))}
            </div>
          </div>
          <RankedBars
            rows={report.map(r => ({
              id: r.uid,
              label: r.name,
              value: rankValue(r),
              detail: [
                // Whatever the bar is not already saying.
                rank === 'orders'
                  ? `${r.packets.toLocaleString('en-IN')} packets`
                  : `${r.orders} order${r.orders === 1 ? '' : 's'}`,
                r.daysTargeted > 0 ? `${r.daysMet} of ${r.daysTargeted} days met` : 'no target set',
                `${r.shops} shop${r.shops === 1 ? '' : 's'}`,
              ].join(' · '),
            }))}
            format={RANK_FORMAT[rank]}
            showRank
            emptyText="Nothing ordered in this window yet."
          />
        </div>

        {/* ── THE TABLE: the same reps, in the graph's order ────────────── */}
        {report.length > 0 && (
          <div className="oc-scroll-x" style={{ border: `0.5px solid ${t.border}`, borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 740 }}>
              <thead>
                <tr>
                  {['Rep', 'Area', 'Visits', 'Shops', 'Orders', 'Packets', 'Value', 'Target', 'Days met', 'Meter', 'Expenses']
                    .map((h, i) => (
                      <th key={h} style={{
                        textAlign: i < 2 ? 'left' : 'right', padding: '10px 9px',
                        fontSize: 11, fontWeight: 400, letterSpacing: '0.06em', textTransform: 'uppercase',
                        color: t.text3, borderBottom: `0.5px solid ${t.border}`, whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {report.map(r => {
                  const num = { textAlign: 'right' as const, padding: '10px 9px', color: t.text,
                                fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const,
                                borderBottom: `0.5px solid ${t.border}` }
                  const allMet = r.daysTargeted > 0 && r.daysMet === r.daysTargeted
                  return (
                    <tr key={r.uid} data-testid={`report-row-${r.uid}`}>
                      <td style={{ ...num, textAlign: 'left', fontWeight: 500 }}>
                        {r.name}
                        <div style={{ fontSize: 12, fontWeight: 400, color: t.text3 }}>
                          {r.daysWorked} day{r.daysWorked === 1 ? '' : 's'} worked
                        </div>
                      </td>
                      <td style={{ ...num, textAlign: 'left', whiteSpace: 'normal', color: r.areas.length ? t.text : t.text3, minWidth: 110 }}>
                        {r.areas.length ? r.areas.join(', ') : '—'}
                      </td>
                      <td style={num}>{r.visits}</td>
                      <td style={num}>{r.shops}</td>
                      <td style={num}>{r.orders}</td>
                      <td style={num}>{r.packets.toLocaleString('en-IN')}</td>
                      <td style={num}>₹{r.value.toLocaleString('en-IN')}</td>
                      <td style={{ ...num, color: r.target === null ? t.text3 : t.text }}>
                        {r.target === null ? 'Not set' : r.target.toLocaleString('en-IN')}
                      </td>
                      <td style={{ ...num, color: r.daysTargeted === 0 ? t.text3 : allMet ? t.good : t.text,
                                   fontWeight: allMet ? 500 : 400 }}>
                        {r.daysTargeted === 0 ? '—' : `${r.daysMet} / ${r.daysTargeted}`}
                      </td>
                      <td style={{ ...num, color: r.meterKm ? t.text : t.text3 }}>
                        {r.meterKm ? `${r.meterKm} km` : 'Nil'}
                      </td>
                      <td style={{ ...num, color: r.expenses ? t.text : t.text3 }}>
                        {r.expenses ? `₹${Math.round(r.expenses).toLocaleString('en-IN')}` : 'None'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ fontSize: 12, color: t.text3, lineHeight: 1.6, maxWidth: 600 }}>
          The product filter narrows packets, value, targets and days met — the figures a
          product owns. Visits, shops, the meter and expenses are the rep's whole day either
          way. With a beat chosen, only the days that beat was assigned are counted.
          Cancelled orders and abandoned visits are left out.
        </div>
        </>)}
      </div>
      )}
    </div>
  )
}
