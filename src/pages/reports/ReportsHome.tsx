import { useState, useEffect, useMemo } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import { AppUser, OutletVisit, UnifiedAllocation, PaymentTransaction } from '../../types'
import { useTheme } from '../../context/ThemeContext'
import DateInput from '../../components/DateInput'
import LazyChart from '../../components/LazyChart'
import RankedBars, { RankedRow } from '../../components/RankedBars'
import type { TrendPoint } from '../../components/TrendChart'
import { PageHeader, Eyebrow, RowGroup, ListRow, Note } from '../../components/ui'
import { localDateStr } from '../../utils/date'

interface Props {
  onBack: () => void
  onOpenField: () => void
  onOpenSales: () => void
  onOpenOpportunities: () => void
}

/** Month arithmetic that does not care what today is. */
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1)
const lastDay = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)

type Preset = 'this_month' | 'last_30' | 'custom'

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
export default function ReportsHome({ onBack, onOpenField, onOpenSales, onOpenOpportunities }: Props) {
  const { t } = useTheme()

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

  /** Daily series for the chart, current period against the previous one. */
  const series = useMemo<TrendPoint[]>(() => {
    const out: TrendPoint[] = []
    const a = new Date(current.from + 'T00:00:00')
    const pa = new Date(previous.from + 'T00:00:00')
    for (let i = 0; i < spanDays; i++) {
      const d = new Date(a); d.setDate(d.getDate() + i)
      const p = new Date(pa); p.setDate(p.getDate() + i)
      const ds = localDateStr(d), ps = localDateStr(p)
      out.push({
        label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        current: visits.filter(v => v.date === ds && v.status !== 'abandoned').length,
        previous: visits.filter(v => v.date === ps && v.status !== 'abandoned').length,
      })
    }
    return out
  }, [visits, current.from, previous.from, spanDays])

  /**
   * Who did what this period. Bars, not a pie — a pie shows share, and share
   * moves when somebody else moves, so a rep who was flat all month reads as
   * declining because a colleague improved.
   */
  const [rankBy, setRankBy] = useState<'visits' | 'orders' | 'collected'>('visits')

  const ranked = useMemo<RankedRow[]>(() => {
    const name = new Map(users.map(u => [u.uid, u.name]))
    const rows = new Map<string, number>()
    const add = (uid: string | undefined, n: number) => {
      if (!uid || !name.has(uid)) return
      rows.set(uid, (rows.get(uid) ?? 0) + n)
    }
    if (rankBy === 'visits') {
      visits.filter(v => inRange(v.date, current) && v.status !== 'abandoned')
        .forEach(v => add(v.uid, 1))
    } else if (rankBy === 'orders') {
      allocations.filter(a => inRange(allocDate(a), current) && a.status !== 'cancelled')
        .forEach(a => add(a.createdBy, a.totalAmount || 0))
    } else {
      payments.filter(p => inRange(p.date, current) && p.status !== 'rejected')
        .forEach(p => add(p.collectedBy, p.amount || 0))
    }
    return [...rows.entries()].map(([uid, value]) => ({
      id: uid, label: name.get(uid) ?? 'Someone', value,
    }))
  }, [rankBy, users, visits, allocations, payments, current])

  const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

  return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 56 }}>
      <PageHeader eyebrow="Reports" title="Reports" onBack={onBack}
        subtitle="How this period compares with the one before it, and the way in to the detail." />

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 30 }}>

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

        {readError && <Note tone="warn">{readError}</Note>}

        {/* The headline numbers. Stat tiles with a delta, not a chart — four
            figures do not need four charts. */}
        <div>
          <div style={{ marginBottom: 12 }}><Eyebrow>Against last period</Eyebrow></div>
          <div className="oc-stats">
            <Delta label="Visits" now={cur.visits} before={prev.visits} loading={loading} />
            <Delta label="Outlets covered" now={cur.outlets} before={prev.outlets} loading={loading} />
            <Delta label="Ordered" now={cur.orderValue} before={prev.orderValue}
              fmt={inr} loading={loading} />
            <Delta label="Collected" now={cur.collected} before={prev.collected}
              fmt={inr} loading={loading} />
          </div>
        </div>

        {/* Trend */}
        <div>
          <div style={{ marginBottom: 12 }}><Eyebrow>Visits, day by day</Eyebrow></div>
          {loading ? (
            <div style={{ fontSize: 13, color: t.text3 }}>Loading…</div>
          ) : (
            <LazyChart data={series} unit="visits"
              currentLabel="This period" previousLabel="The period before" />
          )}
        </div>

        {/* Who did what */}
        <div>
          <div style={{ marginBottom: 10 }}><Eyebrow>By person</Eyebrow></div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {([['visits', 'Shops visited'], ['orders', 'Ordered'], ['collected', 'Collected']] as const)
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
            : <RankedBars rows={ranked} format={rankBy === 'visits' ? undefined : inr} />}
        </div>

        {/* The two screens that already answer everything else */}
        <div>
          <div style={{ marginBottom: 12 }}><Eyebrow>The detail</Eyebrow></div>
          <RowGroup>
            <ListRow title="Worth going back to"
              desc="Shops that stopped ordering, ran empty, or nobody has visited"
              onClick={onOpenOpportunities} />
            <ListRow title="Field activity"
              desc="Day by day, per rep — punch in and out, time in each shop, meter readings, every remark"
              onClick={onOpenField} />
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
function Delta({ label, now, before, fmt, loading }: {
  label: string; now: number; before: number
  fmt?: (n: number) => string; loading: boolean
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
                    color: loading || diff === 0 ? t.text3 : diff > 0 ? t.accent : t.warn }}>
        {loading ? '—'
          : before === 0 ? `nothing last period`
          : diff === 0 ? 'level with last period'
          : `${diff > 0 ? 'up' : 'down'} ${f(Math.abs(diff))}${pct !== null ? ` · ${Math.abs(pct)}%` : ''}`}
      </div>
    </div>
  )
}
