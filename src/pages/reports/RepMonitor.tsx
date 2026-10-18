import { useState, useEffect, useMemo } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import {
  AppUser, OutletVisit, DutySession, WorkPlan, SalesRoute, SalesTarget,
  UnifiedAllocation, OutletType, OUTLET_TYPE_LABEL,
  dailyTargetFor, packetsOrderedOn, dateOfMs, routePlaces,
} from '../../types'
import { useTheme } from '../../context/ThemeContext'
import CustomSelect from '../../components/CustomSelect'
import DateInput from '../../components/DateInput'
import { PageHeader, Eyebrow, EmptyState, Note } from '../../components/ui'
import { localDateStr, localMonthStr, isSunday } from '../../utils/date'

interface Props { onBack: () => void }

type RangeMode = 'day' | 'week' | 'month' | 'custom'
type Outcome = 'all' | 'met' | 'missed' | 'untargeted'

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
}

export default function RepMonitor({ onBack }: Props) {
  const { t } = useTheme()

  const [reps, setReps] = useState<AppUser[]>([])
  const [visits, setVisits] = useState<OutletVisit[]>([])
  const [sessions, setSessions] = useState<DutySession[]>([])
  const [plans, setPlans] = useState<WorkPlan[]>([])
  const [routes, setRoutes] = useState<SalesRoute[]>([])
  const [targets, setTargets] = useState<SalesTarget[]>([])
  const [allocations, setAllocations] = useState<UnifiedAllocation[]>([])
  const [readError, setReadError] = useState<string | null>(null)

  // ── filters ───────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<RangeMode>('day')
  const [day, setDay] = useState(localDateStr())
  const [weekStart, setWeekStart] = useState(mondayOf(localDateStr()))
  const [month, setMonth] = useState(localMonthStr())
  const [customFrom, setCustomFrom] = useState(addDays(localDateStr(), -6))
  const [customTo, setCustomTo] = useState(localDateStr())
  const [who, setWho] = useState('')
  const [beat, setBeat] = useState('')
  const [outcome, setOutcome] = useState<Outcome>('all')
  /** Sundays and days nobody worked are noise until somebody asks for them. */
  const [showQuiet, setShowQuiet] = useState(false)

  const [from, to] = useMemo((): [string, string] => {
    if (mode === 'day') return [day, day]
    if (mode === 'week') return [weekStart, addDays(weekStart, 6)]
    if (mode === 'month') return [`${month}-01`, lastDayOfMonth(month)]
    return customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom]
  }, [mode, day, weekStart, month, customFrom, customTo])

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'users'), s =>
      setReps(s.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser))
        .filter(u => u.status === 'approved'
          && (u.role === 'offline_sales' || u.role === 'online_sales'))
        .sort((a, b) => a.name.localeCompare(b.name))))
    const u2 = onSnapshot(collection(db, 'sales_routes'), s =>
      setRoutes(s.docs.map(d => ({ id: d.id, ...d.data() } as SalesRoute))))
    return () => { u1(); u2() }
  }, [])

  useEffect(() => {
    setReadError(null)
    const fail = (what: string) => (err: any) =>
      setReadError(err?.code === 'permission-denied'
        ? 'Firestore turned down a read. The deployed rules may be older than this build.'
        : `Could not load ${what}.`)

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

    const unsubs = [
      onSnapshot(
        query(collection(db, 'outlet_visits'), where('date', '>=', from), where('date', '<=', to)),
        s => setVisits(s.docs.map(d => ({ id: d.id, ...d.data() } as OutletVisit))),
        fail('the visits'),
      ),
      onSnapshot(
        query(collection(db, 'duty_sessions'), where('date', '>=', from), where('date', '<=', to)),
        s => setSessions(s.docs.map(d => ({ id: d.id, ...d.data() } as DutySession))),
        fail('the days'),
      ),
      onSnapshot(
        query(collection(db, 'work_plans'), where('date', '>=', from), where('date', '<=', to)),
        s => setPlans(s.docs.map(d => ({ id: d.id, ...d.data() } as WorkPlan))),
        fail('the beats assigned'),
      ),
      onSnapshot(
        query(collection(db, 'allocations_v2'),
          where('createdAt', '>=', fromMs), where('createdAt', '<=', toMs)),
        s => setAllocations(s.docs.map(d => ({ id: d.id, ...d.data() } as UnifiedAllocation))),
        fail('the orders'),
      ),
      onSnapshot(
        query(collection(db, 'sales_targets'), where('month', 'in', months)),
        s => setTargets(s.docs.map(d => ({ id: d.id, ...d.data() } as SalesTarget))),
        fail('the targets'),
      ),
    ]
    return () => unsubs.forEach(u => u())
  }, [from, to])

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
        const present = sessions.some(s => s.uid === r.uid && s.date === date)

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
        const nothingHappened = !expected && !present && theirs.length === 0
          && packets === 0 && !plan
        if (!showQuiet && (nothingHappened || (isSunday(date) && !expected))) continue

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
        })
      }
    }
    // Newest day first, people alphabetical inside it.
    return out.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))
  }, [from, to, reps, who, beat, outcome, showQuiet, visits, sessions, plans, routes,
      targets, allocations])

  const byDay = useMemo(() => {
    const m = new Map<string, Eod[]>()
    cards.forEach(c => { if (!m.has(c.date)) m.set(c.date, []); m.get(c.date)!.push(c) })
    return [...m.entries()]
  }, [cards])

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

  /** One line of the card. Labelled on the left, value on the right, always. */
  const Line = ({ label, value, tone }: {
    label: string; value: React.ReactNode; tone?: 'warn' | 'good'
  }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '3px 0' }}>
      <span style={{ fontSize: 12, color: t.text3, width: 104, flexShrink: 0 }}>{label}</span>
      <span style={{
        fontSize: 13, minWidth: 0,
        color: tone === 'warn' ? t.warn : tone === 'good' ? t.text : t.text2,
        fontWeight: tone ? 500 : 400,
      }}>
        {value}
      </span>
    </div>
  )

  return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 56 }}>
      <PageHeader
        eyebrow="Reports"
        title="Monitor reps"
        subtitle="The end of each day, one card per person — what they covered and whether it met the target."
        onBack={onBack}
      />

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 860 }}>
        {readError && <Note tone="warn">{readError}</Note>}

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
                <DateInput type="date" value={day} onChange={setDay} />
              </div>
            )}
            {mode === 'week' && (
              <div style={{ flex: 1, minWidth: 150 }}>
                <DateInput type="date" value={weekStart}
                  onChange={d => setWeekStart(mondayOf(d))} />
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
            <div className="oc-modules">
              {rows.map(c => {
                const met = c.target !== null && c.packets >= c.target
                const missed = c.target !== null && c.packets < c.target
                return (
                  <div key={`${c.uid}_${c.date}`} style={{
                    border: `0.5px solid ${missed ? t.border2 : t.border}`,
                    borderLeft: `2px solid ${met ? t.text2 : missed ? t.warn : t.border}`,
                    borderRadius: 6, padding: '14px 16px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <Eyebrow>EOD</Eyebrow>
                      </span>
                      {/* The indication, in words as well as colour. Colour
                          alone is not an answer for everybody reading it. */}
                      <span style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
                                     color: met ? t.text2 : missed ? t.warn : t.text3 }}>
                        {met ? '✓ Target met' : missed ? '✗ Short' : 'No target'}
                      </span>
                    </div>

                    <Line label="Name" value={c.name} tone="good" />
                    <Line label="Date" value={plainDate(c.date)} />
                    <Line
                      label="Route"
                      value={c.routeName
                        ? c.routePlaces.length
                          ? `${c.routeName} · ${c.routePlaces.join(', ')}`
                          : c.routeName
                        : 'No beat assigned'}
                    />
                    <Line
                      label="No of shops"
                      value={c.shops === 0 ? '0' : (
                        <>
                          {c.shops}
                          <span style={{ color: t.text3 }}>
                            {' · '}
                            {c.byType.map(b => `${b.n} ${OUTLET_TYPE_LABEL[b.type]}`).join(' · ')}
                          </span>
                        </>
                      )}
                    />
                    <Line
                      label="Daily target"
                      value={c.target === null ? 'Not set' : `${c.target} packets`}
                    />
                    <Line
                      label="Order placed"
                      value={c.packets === 0 && c.orders === 0 ? '0' : (
                        <>
                          {c.packets} packets
                          <span style={{ color: t.text3 }}>
                            {` · ${c.orders} ${c.orders === 1 ? 'order' : 'orders'}`}
                          </span>
                        </>
                      )}
                      tone={missed ? 'warn' : met ? 'good' : undefined}
                    />

                    {!c.present && (
                      // Worth saying rather than leaving as a row of zeroes: a
                      // day nobody punched in on is a different fact from a day
                      // that went badly.
                      <div style={{ fontSize: 12, color: t.warn, marginTop: 8, lineHeight: 1.5 }}>
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
      </div>
    </div>
  )
}
