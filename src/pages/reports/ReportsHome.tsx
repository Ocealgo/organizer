import { useState, useEffect, useMemo } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import {
  AppUser, OutletVisit, UnifiedAllocation, PaymentTransaction,
  SalesTarget, SalesRoute, Party, Holiday, WorkPlan,
} from '../../types'
import { useTheme } from '../../context/ThemeContext'
import DateInput from '../../components/DateInput'
import CustomSelect from '../../components/CustomSelect'
import LazyChart from '../../components/LazyChart'
import RankedBars, { RankedRow } from '../../components/RankedBars'
import type { TrendPoint } from '../../components/TrendChart'
import { PageHeader, Eyebrow, RowGroup, ListRow, Note, TabBar } from '../../components/ui'
import { localDateStr } from '../../utils/date'
import {
  paceOf, strikeOf, coverageOf, pct, MIN_VISITS_FOR_RATE,
  lastMonths, monthlyTotals, growthOf, enoughHistory,
} from './salesInsights'

interface Props {
  onBack: () => void
  onOpenSales: () => void
  onOpenOpportunities: () => void
  onOpenMonitor: () => void
  /** Admins only; absent for everyone else, and the row with it. */
  onOpenManagers?: () => void
}

/** Month arithmetic that does not care what today is. */
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1)
const lastDay = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)

type Preset = 'this_month' | 'last_30' | 'custom'
type Tab = 'month' | 'compare'

/** Months shown in the growth table, the current one included. */
const GROWTH_MONTHS = 6

interface Totals {
  visits: number
  outlets: number
  orderValue: number
  collected: number
}
const EMPTY: Totals = { visits: 0, outlets: 0, orderValue: 0, collected: 0 }

/**
 * The way in to reporting, and the only place that answers "are we growing".
 *
 * Two report screens already existed and neither was discoverable: Field
 * activity holds a day-by-day account of every rep — punch in and out, time per
 * shop, meter, remarks — and Sales report aggregates a range per person and
 * exports it. Between them they answered almost every question anybody had, and
 * nobody could find either. This is a front door for both, not a third of them.
 *
 * What is genuinely new is comparison. Nothing anywhere put a period next to
 * the one before it.
 *
 * The measures are chosen for being expensive to fake. A visit is geofenced and
 * timed; an order and a payment are documents with money attached. Calls and
 * minutes-per-shop are deliberately not here — both move the moment somebody is
 * measured on them, and time-per-shop measures how long the form was open
 * rather than how long anybody stood in a doorway.
 */
export default function ReportsHome({
  onBack, onOpenSales, onOpenOpportunities, onOpenMonitor, onOpenManagers,
}: Props) {
  const { t } = useTheme()

  const [tab, setTab] = useState<Tab>('month')
  const [preset, setPreset] = useState<Preset>('this_month')
  const [from, setFrom] = useState(localDateStr(monthStart(new Date())))
  const [to, setTo] = useState(localDateStr())

  /**
   * The window on screen, and the one immediately before it of equal length.
   *
   * Equal length matters: comparing a 12-day month-to-date against a full 31-day
   * month would report a collapse every time somebody looked on the 12th.
   */
  const { current, previous, spanDays } = useMemo(() => {
    let curFrom = from, curTo = to
    if (preset === 'this_month') {
      curFrom = localDateStr(monthStart(new Date()))
      curTo = localDateStr()
    } else if (preset === 'last_30') {
      const d = new Date(); d.setDate(d.getDate() - 29)
      curFrom = localDateStr(d)
      curTo = localDateStr()
    }
    const a = new Date(curFrom + 'T00:00:00')
    const b = new Date(curTo + 'T00:00:00')
    const days = Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1)

    // A calendar month compares against the previous calendar month, cut to the
    // same day of it — that is what "last month" means to the person asking.
    if (preset === 'this_month') {
      const prevStart = addMonths(monthStart(new Date()), -1)
      const sameDay = new Date(prevStart)
      sameDay.setDate(Math.min(new Date().getDate(), lastDay(prevStart).getDate()))
      return {
        current: { from: curFrom, to: curTo },
        previous: { from: localDateStr(prevStart), to: localDateStr(sameDay) },
        spanDays: days,
      }
    }
    const prevTo = new Date(a); prevTo.setDate(prevTo.getDate() - 1)
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (days - 1))
    return {
      current: { from: curFrom, to: curTo },
      previous: { from: localDateStr(prevFrom), to: localDateStr(prevTo) },
      spanDays: days,
    }
  }, [preset, from, to])

  const [users, setUsers] = useState<AppUser[]>([])
  const [visits, setVisits] = useState<OutletVisit[]>([])
  const [allocations, setAllocations] = useState<UnifiedAllocation[]>([])
  const [payments, setPayments] = useState<PaymentTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState<string | null>(null)

  // ── for pace and coverage ─────────────────────────────────────────────────
  // Pace is always the current month — a target is set by the month — so these
  // reads do not follow the window above. Coverage does, from the reads below.
  const thisMonth = localDateStr().slice(0, 7)
  const [targets, setTargets] = useState<SalesTarget[]>([])
  const [monthAllocs, setMonthAllocs] = useState<UnifiedAllocation[]>([])
  const [monthVisits, setMonthVisits] = useState<OutletVisit[]>([])
  const [monthPlans, setMonthPlans] = useState<WorkPlan[]>([])
  const [routes, setRoutes] = useState<SalesRoute[]>([])
  const [parties, setParties] = useState<Party[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])

  useEffect(() => {
    const start = new Date(lastMonths(thisMonth + '-01', GROWTH_MONTHS)[0] + '-01T00:00:00').getTime()
    const unsubs = [
      onSnapshot(query(collection(db, 'sales_targets'), where('month', '==', thisMonth)),
        s => setTargets(s.docs.map(d => ({ id: d.id, ...d.data() } as SalesTarget))),
        err => console.error('[ReportsHome] targets listener failed', err)),
      onSnapshot(query(collection(db, 'allocations_v2'), where('createdAt', '>=', start)),
        s => setMonthAllocs(s.docs.map(d => ({ id: d.id, ...d.data() } as UnifiedAllocation))),
        err => console.error('[ReportsHome] month orders listener failed', err)),
      // The beats assigned this month, so coverage can be read for one person.
      onSnapshot(query(collection(db, 'work_plans'), where('date', '>=', thisMonth + '-01')),
        s => setMonthPlans(s.docs.map(d => ({ id: d.id, ...d.data() } as WorkPlan))),
        err => console.error('[ReportsHome] month plans listener failed', err)),
      // This month's visits, for coverage — the window on the Compare tab may be elsewhere.
      onSnapshot(query(collection(db, 'outlet_visits'), where('date', '>=', thisMonth + '-01')),
        s => setMonthVisits(s.docs.map(d => ({ id: d.id, ...d.data() } as OutletVisit))),
        err => console.error('[ReportsHome] month visits listener failed', err)),
      onSnapshot(collection(db, 'sales_routes'),
        s => setRoutes(s.docs.map(d => ({ id: d.id, ...d.data() } as SalesRoute)))),
      onSnapshot(collection(db, 'parties'),
        s => setParties(s.docs.map(d => ({ id: d.id, ...d.data() } as Party)))),
      onSnapshot(collection(db, 'holidays'),
        s => setHolidays(s.docs.map(d => ({ id: d.id, ...d.data() } as Holiday)))),
    ]
    return () => unsubs.forEach(u => u())
  }, [thisMonth])

  useEffect(() => onSnapshot(collection(db, 'users'), snap =>
    setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser))
      .filter(u => u.status === 'approved'))), [])

  // One window covering both periods, so the comparison never needs a second
  // round trip and the two halves can never come from different reads.
  useEffect(() => {
    setLoading(true); setReadError(null)
    const lo = previous.from, hi = current.to
    const byDate = (col: string, set: (v: any[]) => void) =>
      onSnapshot(
        query(collection(db, col), where('date', '>=', lo), where('date', '<=', hi)),
        snap => { set(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
        err => {
          console.error(`[ReportsHome] ${col} listener failed`, err)
          setReadError(err?.code === 'permission-denied'
            ? 'Firestore turned down the read. The deployed rules may be older than this build.'
            : 'Could not load the figures.')
          setLoading(false)
        },
      )
    const u1 = byDate('outlet_visits', v => setVisits(v as OutletVisit[]))
    const u2 = byDate('payment_transactions', v => setPayments(v as PaymentTransaction[]))
    // Allocations carry no `date`; they are grouped by the day they were raised.
    const u3 = onSnapshot(
      query(collection(db, 'allocations_v2'),
        where('createdAt', '>=', new Date(lo + 'T00:00:00').getTime()),
        where('createdAt', '<=', new Date(hi + 'T23:59:59.999').getTime())),
      snap => setAllocations(snap.docs.map(d => ({ id: d.id, ...d.data() } as UnifiedAllocation))),
      err => console.error('[ReportsHome] allocations listener failed', err),
    )
    return () => { u1(); u2(); u3() }
  }, [previous.from, current.to])

  const inRange = (d: string, r: { from: string; to: string }) => d >= r.from && d <= r.to
  const allocDate = (a: UnifiedAllocation) => localDateStr(new Date(a.createdAt))

  const totalsFor = (r: { from: string; to: string }): Totals => {
    // An abandoned visit never collected an outcome and was never a visit in
    // any sense a report should count — same exclusion Sales report makes.
    const vs = visits.filter(v => inRange(v.date, r) && v.status !== 'abandoned')
    const al = allocations.filter(a => inRange(allocDate(a), r) && a.status !== 'cancelled')
    const pm = payments.filter(p => inRange(p.date, r) && p.status !== 'rejected')
    return {
      visits: vs.length,
      outlets: new Set(vs.map(v => v.partyId)).size,
      orderValue: al.reduce((n, a) => n + (a.totalAmount || 0), 0),
      collected: pm.reduce((n, p) => n + (p.amount || 0), 0),
    }
  }

  const cur = loading ? EMPTY : totalsFor(current)
  const prev = loading ? EMPTY : totalsFor(previous)

  // ── 1. pace ───────────────────────────────────────────────────────────────
  const today = localDateStr()
  const pace = useMemo(
    () => paceOf(targets, monthAllocs, thisMonth, today, new Set(holidays.map(h => h.date))),
    [targets, monthAllocs, thisMonth, today, holidays])
  const paceSeries = useMemo<TrendPoint[]>(() => pace.series.map(p => ({
    label: p.label, current: p.actual, previous: p.target, projected: p.projected,
  })), [pace])

  // ── 2. strike rate, this window and the one before ────────────────────────
  const strikeNow = strikeOf(visits.filter(v => inRange(v.date, current)))
  const strikeBefore = strikeOf(visits.filter(v => inRange(v.date, previous)))

  // ── 3. coverage, over this window ─────────────────────────────────────────
  // Coverage's own filters — inside its box, so they change only the table.
  const [covWho, setCovWho] = useState('')
  const [covArea, setCovArea] = useState('')
  const [covLow, setCovLow] = useState(false)
  const [covSort, setCovSort] = useState<'name' | 'lowest'>('lowest')

  /** People with a beat this month, for the person filter. */
  const covPeople = useMemo(() => {
    const seen = new Map<string, string>()
    monthPlans.forEach(pl => { if (pl.routeId) seen.set(pl.uid, pl.name) })
    return [...seen.entries()].map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [monthPlans])

  /** Places that have a shop on some beat, for the area filter. */
  const covAreas = useMemo(() => {
    const onBeat = new Set(routes.filter(r => r.active !== false).flatMap(r => r.outletIds ?? []))
    return [...new Set(parties.filter(pt => onBeat.has(pt.id!) && pt.place).map(pt => pt.place))]
      .sort((a, b) => a.localeCompare(b))
  }, [routes, parties])

  const coverage = useMemo(() => {
    const beatIds = covWho
      ? new Set(monthPlans.filter(pl => pl.uid === covWho && pl.routeId).map(pl => pl.routeId!))
      : undefined
    return coverageOf(routes, parties, monthVisits, monthAllocs,
      { from: thisMonth + '-01', to: today },
      { uid: covWho || undefined, beatIds, area: covArea || undefined })
  }, [routes, parties, monthVisits, monthAllocs, monthPlans, thisMonth, today, covWho, covArea])

  /** The rows on show: below 85% only if asked, worst first unless asked by name. */
  const covRows = useMemo(() => {
    const rows = coverage.beats.filter(c => !covLow || (pct(c.visited, c.shops) ?? 0) < 85)
    return covSort === 'lowest'
      ? [...rows].sort((a, b) => (pct(a.visited, a.shops) ?? 0) - (pct(b.visited, b.shops) ?? 0)
          || a.name.localeCompare(b.name))
      : rows
  }, [coverage, covLow, covSort])

  // ── growth, over the last six months ──────────────────────────────────────
  const monthTotals = useMemo(
    () => monthlyTotals(monthAllocs, lastMonths(today, GROWTH_MONTHS), today),
    [monthAllocs, today])
  const growth = useMemo(() => growthOf(monthTotals), [monthTotals])

  // Too little in the earlier period for a comparison to mean anything.
  const comparable = loading || enoughHistory(visits, allocations, current, previous)

  /**
   * Who did what this period. Bars, not a pie — a pie shows share, and share
   * moves when somebody else moves, so a rep who was flat all month reads as
   * declining because a colleague improved.
   */
  const [rankBy, setRankBy] = useState<'visits' | 'strike' | 'orders' | 'collected'>('visits')

  const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

  const pill = (on: boolean) => ({
    background: 'none', border: `0.5px solid ${on ? t.text2 : t.border}`,
    borderRadius: 99, padding: '6px 13px', fontSize: 12,
    color: on ? t.text : t.text3, cursor: 'pointer', whiteSpace: 'nowrap' as const,
  })

  /** A coverage row. The total is pinned to the bottom of the scrolling box. */
  const covRow = (c: ReturnType<typeof coverageOf>['all'], total: boolean) => {
    const cov = pct(c.visited, c.shops)
    const eff = pct(c.ordered, c.shops)
    const cell = {
      textAlign: 'right' as const, padding: '9px 10px', color: t.text,
      fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const,
      borderBottom: total ? 'none' : `0.5px solid ${t.border}`, fontWeight: total ? 500 : 400,
      ...(total ? { position: 'sticky' as const, bottom: 0, background: t.bg2,
                    borderTop: `0.5px solid ${t.border2}` } : {}),
    }
    return (
      <tr key={c.id} data-testid={`coverage-row-${c.id}`}>
        <td style={{ ...cell, textAlign: 'left', whiteSpace: 'normal' }}>
          {c.name}
          {c.places && <div style={{ fontSize: 12, color: t.text3, fontWeight: 400 }}>{c.places}</div>}
        </td>
        <td style={cell}>{c.shops}</td>
        <td style={cell}>{c.visited}</td>
        <td style={{ ...cell, color: cov !== null && cov < 85 ? t.warn : t.text }}>
          {cov === null ? '—' : `${cov}%`}
        </td>
        <td style={cell}>{c.ordered}</td>
        <td style={cell}>{eff === null ? '—' : `${eff}%`}</td>
      </tr>
    )
  }

  const ranked = useMemo<RankedRow[]>(() => {
    const name = new Map(users.map(u => [u.uid, u.name]))

    // A rate needs enough visits under it to mean anything; 1 of 1 is not 100%.
    if (rankBy === 'strike') {
      const byRep = (r: { from: string; to: string }) => {
        const m = new Map<string, OutletVisit[]>()
        visits.filter(v => inRange(v.date, r))
          .forEach(v => { if (v.uid) m.set(v.uid, [...(m.get(v.uid) ?? []), v]) })
        return m
      }
      const before = byRep(previous)
      return [...byRep(current).entries()]
        .filter(([uid]) => name.has(uid))
        .map(([uid, vs]) => ({ uid, s: strikeOf(vs), was: strikeOf(before.get(uid) ?? []) }))
        .filter(({ s }) => s.visits >= MIN_VISITS_FOR_RATE)
        .map(({ uid, s, was }) => {
          const moved = comparable && was.visits >= MIN_VISITS_FOR_RATE && was.rate !== null && s.rate !== null
            ? s.rate - was.rate : null
          return {
            id: uid, label: name.get(uid) ?? 'Someone', value: s.rate ?? 0,
            detail: `${s.productive} of ${s.visits} visits ended in an order`
              + (moved === null ? '' : ` · ${moved === 0 ? 'level with' : `${moved > 0 ? 'up' : 'down'} ${Math.abs(moved)} pts on`} last period`),
          }
        })
    }

    /** Each rep's total for the measure picked, over one window. */
    const totals = (r: { from: string; to: string }) => {
      const rows = new Map<string, number>()
      const add = (uid: string | undefined, n: number) => {
        if (!uid || !name.has(uid)) return
        rows.set(uid, (rows.get(uid) ?? 0) + n)
      }
      if (rankBy === 'visits') {
        visits.filter(v => inRange(v.date, r) && v.status !== 'abandoned').forEach(v => add(v.uid, 1))
      } else if (rankBy === 'orders') {
        allocations.filter(a => inRange(allocDate(a), r) && a.status !== 'cancelled')
          .forEach(a => add(a.createdBy, a.totalAmount || 0))
      } else {
        payments.filter(p => inRange(p.date, r) && p.status !== 'rejected')
          .forEach(p => add(p.collectedBy, p.amount || 0))
      }
      return rows
    }
    const before = totals(previous)
    const show = (n: number) => rankBy === 'visits' ? n.toLocaleString('en-IN') : inr(n)
    return [...totals(current).entries()].map(([uid, value]) => {
      const was = before.get(uid) ?? 0
      // Each rep's own growth, in the readout — who is pulling the team up.
      const change = !comparable ? null : was > 0 ? Math.round(((value - was) / was) * 100) : null
      return {
        id: uid, label: name.get(uid) ?? 'Someone', value,
        detail: !comparable ? 'not enough history to compare'
          : was === 0 ? 'nothing last period'
          : `${show(was)} last period · ${change === 0 ? 'level' : `${change! > 0 ? 'up' : 'down'} ${Math.abs(change!)}%`}`,
      }
    })
  }, [rankBy, users, visits, allocations, payments, current, previous, comparable])


  return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 56 }}>
      <PageHeader eyebrow="Reports" title="Reports" onBack={onBack}
        subtitle={tab === 'month'
          ? 'Whether this month will be made, and whether the beats are being worked.'
          : 'How a period compares with the one before it, and how fast sales are growing.'} />
      <TabBar<Tab>
        tabs={[{ id: 'month', label: 'This month' }, { id: 'compare', label: 'Compare' }]}
        value={tab} onChange={setTab}
      />

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 30 }}>

        {/* ── THIS MONTH: is it going to be made, and are the beats being worked ─ */}
        {tab === 'month' && (<>
        <Panel>
          {/* ── 1. THE MONTH AGAINST ITS TARGET ─────────────────────────────── */}
          <div>
            <div style={{ marginBottom: 4 }}><Eyebrow>This month against the target</Eyebrow></div>
            <div style={{ fontSize: 12, color: t.text3, marginBottom: 14, lineHeight: 1.6 }}>
              {new Date(thisMonth + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              {' '}· always the current month, because targets are set by the month · packets
            </div>
            {pace.reps.length === 0 ? (
              <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.6 }}>
                No targets set for this month yet. Set them in The week → Targets, and this
                shows whether the team is on track.
              </div>
            ) : (
              <>
                <div className="oc-stats">
                  <PaceTile value={pace.team.done.toLocaleString('en-IN')} label="Ordered so far"
                    sub={`of ${pace.team.target.toLocaleString('en-IN')} for the month`} />
                  <PaceTile value={pace.team.dueByToday.toLocaleString('en-IN')} label="Due by today"
                    sub={pct(pace.team.done, pace.team.dueByToday) === null ? '—'
                      : `${pct(pace.team.done, pace.team.dueByToday)}% of it done`}
                    tone={pace.team.done >= pace.team.dueByToday ? 'good' : 'warn'} />
                  <PaceTile value={pace.team.projected.toLocaleString('en-IN')} label="At this pace"
                    sub={`${pct(pace.team.projected, pace.team.target) ?? 0}% of the target by month end`}
                    tone={pace.team.projected >= pace.team.target ? 'good' : 'warn'} />
                  <PaceTile
                    value={pace.team.neededPerDay === null ? '—' : pace.team.neededPerDay.toLocaleString('en-IN')}
                    label="Needed a day"
                    sub={pace.team.daysLeft === 0 ? 'last working day'
                      : `for the ${pace.team.daysLeft} working ${pace.team.daysLeft === 1 ? 'day' : 'days'} left`} />
                </div>

                <div style={{ marginTop: 18 }}>
                  <LazyChart data={paceSeries} unit="packets"
                    currentLabel="Ordered" previousLabel="Target" previousDashed
                    projectedLabel="At this pace" />
                </div>

                {/* Each rep, the same five figures — the chart says how the team
                    is doing, this says who is carrying it. */}
                <div className="oc-scroll-x" style={{ marginTop: 18, border: `0.5px solid ${t.border}`, borderRadius: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
                    <thead>
                      <tr>
                        {['Rep', 'Target', 'Ordered', 'Due by today', 'Pace', 'At this pace', 'Needed a day'].map((h, i) => (
                          <th key={h} style={{
                            textAlign: i === 0 ? 'left' : 'right', padding: '9px 10px', fontSize: 11,
                            fontWeight: 400, letterSpacing: '0.06em', textTransform: 'uppercase',
                            color: t.text3, borderBottom: `0.5px solid ${t.border}`, whiteSpace: 'nowrap',
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pace.reps.map(r => {
                        const on = pct(r.done, r.dueByToday)
                        const cell = { textAlign: 'right' as const, padding: '9px 10px', color: t.text,
                                       fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const,
                                       borderBottom: `0.5px solid ${t.border}` }
                        const ahead = r.done >= r.dueByToday
                        return (
                          <tr key={r.uid} data-testid={`pace-row-${r.uid}`}>
                            <td style={{ ...cell, textAlign: 'left', fontWeight: 500 }}>{r.name}</td>
                            <td style={cell}>{r.target.toLocaleString('en-IN')}</td>
                            <td style={cell}>{r.done.toLocaleString('en-IN')}</td>
                            <td style={cell}>{r.dueByToday.toLocaleString('en-IN')}</td>
                            {/* Ahead or behind in words as well as colour. */}
                            <td style={{ ...cell, color: ahead ? t.good : t.warn, fontWeight: 500 }}>
                              {on === null ? '—' : `${on}% · ${ahead ? 'ahead' : 'behind'}`}
                            </td>
                            <td style={cell}>{r.projected.toLocaleString('en-IN')}</td>
                            <td style={cell}>{r.neededPerDay === null ? '—' : r.neededPerDay.toLocaleString('en-IN')}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 12, color: t.text3, marginTop: 8, lineHeight: 1.6 }}>
                  At this pace carries the month so far on at the same rate per working day.
                  Needed a day is what clears the target from tomorrow. A target set for the
                  month but not divided into days is spread evenly over its working days.
                </div>
              </>
            )}
          </div>
        </Panel>

        <Panel>
          {/* ── 3. ARE THE BEATS BEING WORKED ───────────────────────────────── */}
          <div>
            <div style={{ marginBottom: 4 }}><Eyebrow>Beat coverage</Eyebrow></div>
            <div style={{ fontSize: 12, color: t.text3, marginBottom: 14, lineHeight: 1.6 }}>
              This month so far. Visited: shops on the beat seen at least once. Ordered: of
              those, how many bought — what the visits turned into.
            </div>

            {/* Its own filters, in one row above the table they narrow. */}
            <div className="oc-wrap" style={{ gap: 12, marginBottom: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 170px', minWidth: 0 }}>
                <div style={{ marginBottom: 6 }}><Eyebrow>Person</Eyebrow></div>
                <CustomSelect value={covWho} onChange={setCovWho}
                  options={[{ value: '', label: 'Everybody' }, ...covPeople]}
                  placeholder="Everybody" />
              </div>
              <div style={{ flex: '1 1 170px', minWidth: 0 }}>
                <div style={{ marginBottom: 6 }}><Eyebrow>Area</Eyebrow></div>
                <CustomSelect value={covArea} onChange={setCovArea}
                  options={[{ value: '', label: 'Every area' }, ...covAreas.map(a => ({ value: a, label: a }))]}
                  placeholder="Every area" />
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {([['lowest', 'Lowest first'], ['name', 'By name']] as const).map(([k, label]) => (
                  <button key={k} className="oc-action" onClick={() => setCovSort(k)}
                    aria-pressed={covSort === k} style={pill(covSort === k)}>{label}</button>
                ))}
                <button className="oc-action" onClick={() => setCovLow(v => !v)}
                  aria-pressed={covLow} style={pill(covLow)}>Below 85% only</button>
              </div>
            </div>

            {coverage.beats.length === 0 ? (
              <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.6 }}>
                {covWho || covArea ? 'No beats match these filters this month.' : 'No beats yet. Set them up in Beats.'}
              </div>
            ) : (
              // A fixed height that scrolls, with the headings pinned at the
              // top and the total pinned at the bottom, so neither scrolls away
              // from the rows they explain.
              <div data-testid="coverage-scroll" style={{
                maxHeight: 380, overflow: 'auto',
                border: `0.5px solid ${t.border}`, borderRadius: 6,
              }}>
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, minWidth: 520 }}>
                  <thead>
                    <tr>
                      {['Beat', 'Shops', 'Visited', 'Coverage', 'Ordered', 'Effective'].map((h, i) => (
                        <th key={h} style={{
                          position: 'sticky', top: 0, zIndex: 1, background: t.bg2,
                          textAlign: i === 0 ? 'left' : 'right', padding: '9px 10px', fontSize: 11,
                          fontWeight: 400, letterSpacing: '0.06em', textTransform: 'uppercase',
                          color: t.text3, borderBottom: `0.5px solid ${t.border}`, whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {covRows.length === 0 && (
                      <tr><td colSpan={6} style={{ padding: '14px 10px', fontSize: 13, color: t.text3 }}>
                        Every beat here is at 85% or more.
                      </td></tr>
                    )}
                    {covRows.map(c => covRow(c, false))}
                  </tbody>
                  <tfoot>{covRow(coverage.all, true)}</tfoot>
                </table>
              </div>
            )}
            <div style={{ fontSize: 12, color: t.text3, marginTop: 8, lineHeight: 1.6 }}>
              {covRows.length} of {coverage.beats.length} {coverage.beats.length === 1 ? 'beat' : 'beats'} shown.
              Coverage under 85% is marked — the usual rule of thumb for a beat that is being
              worked.{covWho && ' With a person picked, only their own visits and orders count, on the beats they were given this month.'}
              {coverage.offBeat > 0 && ` ${coverage.offBeat} ${coverage.offBeat === 1 ? 'shop is' : 'shops are'} on no beat at all, so nobody is routed to ${coverage.offBeat === 1 ? 'it' : 'them'}.`}
            </div>
          </div>
        </Panel>
        </>)}

        {/* ── COMPARE: against the period before, and the growth over months ── */}
        {tab === 'compare' && (<>
        {readError && <Note tone="warn">{readError}</Note>}

        <Panel title="Period against period"
          note="The dates you pick here change everything in this box.">
          {/* Filters, in one row above the figures */}
          <div>
            <div style={{ marginBottom: 8 }}><Eyebrow>When</Eyebrow></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {([['this_month', 'This month'], ['last_30', 'Last 30 days'], ['custom', 'Custom']] as const)
                .map(([id, label]) => (
                  <button key={id} className="oc-action" onClick={() => setPreset(id)}
                    style={{
                      background: 'none',
                      border: `0.5px solid ${preset === id ? t.text2 : t.border}`,
                      borderRadius: 99, padding: '6px 13px', fontSize: 12,
                      color: preset === id ? t.text : t.text3, cursor: 'pointer',
                    }}>
                    {label}
                  </button>
                ))}
            </div>
            {preset === 'custom' && (
              <div className="oc-wrap" style={{ gap: 10, marginTop: 12 }}>
                <div style={{ flex: '1 1 150px' }}>
                  <DateInput type="date" value={from} onChange={setFrom} max={to} />
                </div>
                <div style={{ flex: '1 1 150px' }}>
                  <DateInput type="date" value={to} onChange={setTo} min={from} />
                </div>
              </div>
            )}
            <div style={{ fontSize: 12, color: t.text3, marginTop: 10, lineHeight: 1.6 }}>
              {current.from} to {current.to}, against {previous.from} to {previous.to} —
              the same {spanDays} {spanDays === 1 ? 'day' : 'days'} immediately before, so a
              month still being lived is not compared against a whole one.
            </div>
          </div>

          {/* The headline numbers. Stat tiles with a delta, not a chart — four
              figures do not need four charts. */}
          <div>
            <div style={{ marginBottom: 12 }}><Eyebrow>Against last period</Eyebrow></div>
            <div className="oc-stats">
              <Delta label="Visits" now={cur.visits} before={prev.visits} loading={loading} thin={!comparable} />
              <Delta label="Strike rate" now={strikeNow.rate ?? 0} before={strikeBefore.rate ?? 0}
                fmt={n => `${n}%`} points loading={loading} thin={!comparable}
                note={`${strikeNow.productive} of ${strikeNow.visits} visits ended in an order`} />
              <Delta label="Ordered" now={cur.orderValue} before={prev.orderValue}
                fmt={inr} loading={loading} thin={!comparable} />
              <Delta label="Collected" now={cur.collected} before={prev.collected}
                fmt={inr} loading={loading} thin={!comparable} />
            </div>
          </div>

          {/* Who did what */}
          <div>
            <div style={{ marginBottom: 10 }}><Eyebrow>By person</Eyebrow></div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {([['visits', 'Shops visited'], ['strike', 'Strike rate'], ['orders', 'Ordered'], ['collected', 'Collected']] as const)
                .map(([id, label]) => (
                  <button key={id} className="oc-action" onClick={() => setRankBy(id)}
                    style={{
                      background: 'none',
                      border: `0.5px solid ${rankBy === id ? t.text2 : t.border}`,
                      borderRadius: 99, padding: '6px 13px', fontSize: 12,
                      color: rankBy === id ? t.text : t.text3, cursor: 'pointer',
                    }}>
                    {label}
                  </button>
                ))}
            </div>
            {loading
              ? <div style={{ fontSize: 13, color: t.text3 }}>Loading…</div>
              : <RankedBars rows={ranked} showRank={rankBy === 'strike'}
                  format={rankBy === 'visits' ? undefined : rankBy === 'strike' ? (n => `${n}%`) : inr}
                  emptyText={rankBy === 'strike'
                    ? `Nobody has ${MIN_VISITS_FOR_RATE} or more visits in this window yet.` : undefined} />}
            {rankBy === 'strike' && (
              <div style={{ fontSize: 12, color: t.text3, marginTop: 10, lineHeight: 1.6 }}>
                Visits that ended in an order. In general trade 60–75% is a good rep. Anyone with
                fewer than {MIN_VISITS_FOR_RATE} visits is left out — 1 of 1 is not a rate.
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Growth, month by month"
          note="Always the last six months, whatever dates are picked above.">
          {/* ── GROWTH, MONTH BY MONTH ──────────────────────────────────────── */}
          <div>
            <div style={{ fontSize: 12, color: t.text3, marginBottom: 12, lineHeight: 1.6 }}>
              Order value per calendar month, cancellations excluded. The month under way is shown
              but not counted in the growth — it is always behind a whole month until its last day —
              and neither is a first month that only began partway through.
            </div>
            <div className="oc-stats" style={{ marginBottom: 14 }}>
              <PaceTile
                value={growth.average === null ? '—' : `${growth.average > 0 ? '+' : ''}${growth.average}%`}
                label="Average monthly growth"
                sub={growth.average === null
                  ? `needs 3 complete months of orders — ${growth.span} so far`
                  : `compound, over the last ${growth.span} complete months`}
                tone={growth.average === null ? undefined : growth.average >= 0 ? 'good' : 'warn'} />
              {(() => {
                const i = monthTotals.length - 2       // the last complete month
                const c = i >= 0 ? growth.change[i] : null
                return (
                  <PaceTile value={c === null ? '—' : `${c > 0 ? '+' : ''}${c}%`}
                    label={i >= 0 ? `${monthTotals[i].label} against the month before` : 'Last month'}
                    sub={i >= 0 ? inr(monthTotals[i].value) : '—'}
                    tone={c === null ? undefined : c >= 0 ? 'good' : 'warn'} />
                )
              })()}
            </div>
            <div className="oc-scroll-x" style={{ border: `0.5px solid ${t.border}`, borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 440 }}>
                <thead>
                  <tr>
                    {['Month', 'Order value', 'Packets', 'Orders', 'Change'].map((h, i) => (
                      <th key={h} style={{
                        textAlign: i === 0 ? 'left' : 'right', padding: '9px 10px', fontSize: 11,
                        fontWeight: 400, letterSpacing: '0.06em', textTransform: 'uppercase',
                        color: t.text3, borderBottom: `0.5px solid ${t.border}`, whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthTotals.map((m, i) => {
                    const c = growth.change[i]
                    const cell = { textAlign: 'right' as const, padding: '9px 10px', color: t.text,
                                   fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const,
                                   borderBottom: `0.5px solid ${t.border}` }
                    return (
                      <tr key={m.month} data-testid={`growth-row-${m.month}`}>
                        <td style={{ ...cell, textAlign: 'left', fontWeight: 500 }}>
                          {m.label}
                          {!m.complete && <span style={{ fontWeight: 400, color: t.text3 }}> · so far</span>}
                          {m.partial && <span style={{ fontWeight: 400, color: t.text3 }}> · partial</span>}
                        </td>
                        <td style={cell}>{inr(m.value)}</td>
                        <td style={cell}>{m.packets.toLocaleString('en-IN')}</td>
                        <td style={cell}>{m.orders}</td>
                        {/* Up or down in words as well as colour. */}
                        <td style={{ ...cell, color: c === null ? t.text3 : c >= 0 ? t.good : t.warn }}>
                          {!m.complete ? 'under way' : m.partial ? 'not counted' : c === null ? '—' : `${c >= 0 ? 'up' : 'down'} ${Math.abs(c)}%`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
        </>)}

        {/* The two screens that already answer everything else */}
        <div>
          <div style={{ marginBottom: 12 }}><Eyebrow>The detail</Eyebrow></div>
          <RowGroup>
            <ListRow title="Worth going back to"
              desc="Shops that stopped ordering, ran empty, or nobody has visited"
              onClick={onOpenOpportunities} />
            {/* Field activity lives inside this, as its first tab — one door, not two. */}
            <ListRow title="Monitor reps"
              desc="Field activity, the end of each day, and a report ranking the reps"
              onClick={onOpenMonitor} />
            {/* Its own screen, not a tab of Monitor reps: other people, an admin's
                question about them, and data only an admin may read. */}
            {onOpenManagers && (
              <ListRow title="Monitor managers"
                desc="Meetings, days out with a rep, and office days — admins only"
                onClick={onOpenManagers} />
            )}
            <ListRow title="Sales report"
              desc="Totals per person over any range, with conversion and an Excel export"
              onClick={onOpenSales} />
          </RowGroup>
        </div>

        <div style={{ fontSize: 12, color: t.text3, lineHeight: 1.6, maxWidth: 560 }}>
          Counted here: shop visits that were punched out of, orders raised, and payments
          collected. Calls and time-per-shop are deliberately left out — a call has nothing
          behind it but the rep’s word, and the visit timer measures how long the form was
          open rather than how long anybody stood in a doorway. Both would move the moment
          somebody was measured on them.
        </div>
      </div>
    </div>
  )
}

/**
 * A number with what it was last time underneath it.
 *
 * The delta wears a direction word as well as a colour, because a green arrow
 * alone means nothing to a reader who cannot see it as green — and because
 * "up" and "down" survive a printout.
 */
/**
 * One bordered box per question on the page.
 *
 * Where a filter sits inside a box it is that box's alone, and the note says
 * so; a box with no filter in it says what it follows instead. Without the
 * borders the Compare tab read as one list, and nobody could tell which of it
 * the dates had just changed.
 */
function Panel({ title, note, children }: {
  title?: string; note?: string; children: React.ReactNode
}) {
  const { t } = useTheme()
  return (
    <section style={{
      border: `0.5px solid ${t.border2}`, borderRadius: 8, padding: '18px 18px 20px',
      display: 'flex', flexDirection: 'column', gap: 22,
    }}>
      {(title || note) && (
        <div style={{ marginBottom: -8 }}>
          {title && <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{title}</div>}
          {note && (
            <div style={{ fontSize: 12, color: t.text2, marginTop: title ? 3 : 0, lineHeight: 1.5 }}>
              {note}
            </div>
          )}
        </div>
      )}
      {children}
    </section>
  )
}

/** A figure for the month's pace — no comparison, so no Delta, but the same tile. */
function PaceTile({ value, label, sub, tone }: {
  value: string; label: string; sub: string; tone?: 'good' | 'warn'
}) {
  const { t } = useTheme()
  return (
    <div style={{ background: t.tint, borderRadius: 6, padding: '16px 16px 14px' }}>
      <div style={{ fontSize: 24, fontWeight: 500, color: t.text, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 13, color: t.text, marginTop: 6 }}>{label}</div>
      <div style={{ fontSize: 12, marginTop: 3,
                    color: tone === 'good' ? t.good : tone === 'warn' ? t.warn : t.text3 }}>
        {sub}
      </div>
    </div>
  )
}

function Delta({ label, now, before, fmt, loading, points, note, thin }: {
  label: string; now: number; before: number
  fmt?: (n: number) => string; loading: boolean
  /** The figure is itself a percentage: say the change in points, not a percent of a percent. */
  points?: boolean
  /** A line under the change, for what the figure is made of. */
  note?: string
  /** The period before has too little in it to compare against. */
  thin?: boolean
}) {
  const { t } = useTheme()
  const f = fmt ?? ((n: number) => n.toLocaleString('en-IN'))
  const diff = now - before
  const pct = before > 0 ? Math.round((diff / before) * 100) : null

  return (
    <div style={{ background: t.tint, borderRadius: 6, padding: '16px 16px 14px' }}>
      <div style={{ fontSize: 24, fontWeight: 500, color: t.text, lineHeight: 1.1 }}>
        {loading ? '—' : f(now)}
      </div>
      <div style={{ fontSize: 13, color: t.text, marginTop: 6 }}>{label}</div>
      <div style={{ fontSize: 12, marginTop: 3,
                    color: loading || thin || diff === 0 ? t.text3 : diff > 0 ? t.accent : t.warn }}>
        {loading ? '—'
          : thin ? 'not enough history to compare'
          : before === 0 ? `nothing last period`
          : diff === 0 ? 'level with last period'
          : points ? `${diff > 0 ? 'up' : 'down'} ${Math.abs(diff)} pts`
          : `${diff > 0 ? 'up' : 'down'} ${f(Math.abs(diff))}${pct !== null ? ` · ${Math.abs(pct)}%` : ''}`}
      </div>
      {note && !loading && (
        <div style={{ fontSize: 12, color: t.text3, marginTop: 3, lineHeight: 1.4 }}>{note}</div>
      )}
    </div>
  )
}
