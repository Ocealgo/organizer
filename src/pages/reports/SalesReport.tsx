import { useState, useEffect, useMemo, CSSProperties } from 'react'
import * as XLSX from 'xlsx'
import { collection, query, where } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import {
  AppUser, Holiday, LeaveRecord,
  VISIT_OUTCOME_LABEL, VisitOutcomeCategory,
} from '../../types'
import { useTheme } from '../../context/ThemeContext'
import CustomSelect from '../../components/CustomSelect'
import DateInput from '../../components/DateInput'
import { PageHeader, PrimaryButton, Eyebrow, EmptyState } from '../../components/ui'
import { localDateStr, localMonthStr } from '../../utils/date'

interface Props { onBack: () => void }

type RangeMode = 'day' | 'week' | 'month' | 'custom'

// ── date helpers ─────────────────────────────────────────────────────────────
function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return localDateStr(d)
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return localDateStr(d)
}

function lastDayOfMonth(monthStr: string): string {
  const [y, m] = monthStr.split('-').map(Number)
  return localDateStr(new Date(y, m, 0))
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from
  let guard = 0
  while (cur <= to && guard++ < 400) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}

function prettyRange(from: string, to: string): string {
  const f = new Date(from + 'T00:00:00')
  const t = new Date(to + 'T00:00:00')
  const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  return from === to ? fmt(f) : `${fmt(f)} – ${fmt(t)}`
}

// ── stats shape ──────────────────────────────────────────────────────────────
interface PersonStats {
  uid: string
  name: string
  daysLogged: number
  visits: number
  uniqueParties: number
  interested: number
  notInterested: number
  followUp: number
  newParties: number
  /** Sum of outlet visit durations, and how many visits were actually timed. */
  visitMinutes: number
  timedVisits: number
  orders: number
  orderValue: number
  payments: number
  paymentValue: number
  expenses: number
  fullDayLeave: number
  halfDayLeave: number
}

const EMPTY = (uid: string, name: string): PersonStats => ({
  uid, name,
  daysLogged: 0, visits: 0, uniqueParties: 0,
  interested: 0, notInterested: 0, followUp: 0,
  newParties: 0, visitMinutes: 0, timedVisits: 0,
  orders: 0, orderValue: 0,
  payments: 0, paymentValue: 0,
  expenses: 0, fullDayLeave: 0, halfDayLeave: 0,
})

export default function SalesReport({ onBack }: Props) {
  const { t } = useTheme()

  const [mode, setMode] = useState<RangeMode>('month')
  const [day, setDay] = useState(localDateStr())
  const [week, setWeek] = useState(mondayOf(localDateStr()))
  const [month, setMonth] = useState(localMonthStr())
  const [customFrom, setCustomFrom] = useState(addDays(localDateStr(), -30))
  const [customTo, setCustomTo] = useState(localDateStr())
  const [scope, setScope] = useState<string>('all')

  const { from, to } = useMemo(() => {
    if (mode === 'day') return { from: day, to: day }
    if (mode === 'week') return { from: week, to: addDays(week, 6) }
    if (mode === 'month') return { from: `${month}-01`, to: lastDayOfMonth(month) }
    return { from: customFrom, to: customTo }
  }, [mode, day, week, month, customFrom, customTo])

  // ── data ───────────────────────────────────────────────────────────────────
  const [salesUsers, setSalesUsers] = useState<AppUser[]>([])
  const [visitLogs, setVisitLogs] = useState<any[]>([])
  // The field app writes here; visit_logs is the older flow. Both are counted
  // so nothing silently disappears while the two coexist.
  const [outletVisits, setOutletVisits] = useState<any[]>([])
  const [newParties, setNewParties] = useState<any[]>([])
  const [revisitLogs, setRevisitLogs] = useState<any[]>([])
  const [allocations, setAllocations] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [expenses, setExpenses] = useState<any[]>([])
  const [leaves, setLeaves] = useState<LeaveRecord[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onSnapshot(collection(db, 'users'), snap => {
      setSalesUsers(
        snap.docs
          .map(d => ({ uid: d.id, ...d.data() }) as AppUser)
          .filter(u => u.status === 'approved' && (u.role === 'offline_sales' || u.role === 'online_sales'))
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
    })
  }, [])

  // Range-scoped queries — deliberately NOT whole-collection subscriptions.
  // Single-field range filters need no composite index.
  useEffect(() => {
    setLoading(true)
    const fromMs = new Date(from + 'T00:00:00').getTime()
    const toMs = new Date(to + 'T23:59:59.999').getTime()

    const byDate = (col: string, set: (v: any[]) => void) =>
      onSnapshot(
        query(collection(db, col), where('date', '>=', from), where('date', '<=', to)),
        snap => set(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      )

    const unsubs = [
      byDate('visit_logs', setVisitLogs),
      byDate('outlet_visits', setOutletVisits),
      byDate('revisit_logs', setRevisitLogs),
      onSnapshot(
        query(collection(db, 'parties'),
          where('createdAt', '>=', fromMs), where('createdAt', '<=', toMs)),
        snap => setNewParties(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      ),
      byDate('payment_transactions', setPayments),
      byDate('expense_entries', setExpenses),
      byDate('leave_records', v => setLeaves(v as LeaveRecord[])),
      byDate('holidays', v => setHolidays(v as Holiday[])),
      onSnapshot(
        query(collection(db, 'allocations_v2'), where('createdAt', '>=', fromMs), where('createdAt', '<=', toMs)),
        snap => { setAllocations(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) },
      ),
    ]
    return () => unsubs.forEach(u => u())
  }, [from, to])

  // ── aggregation ────────────────────────────────────────────────────────────
  const { rows, team, workingDays } = useMemo(() => {
    const wanted = scope === 'all' ? salesUsers : salesUsers.filter(u => u.uid === scope)
    const byUid = new Map<string, PersonStats>()
    wanted.forEach(u => byUid.set(u.uid, EMPTY(u.uid, u.name)))

    const partySets = new Map<string, Set<string>>()
    const daySets = new Map<string, Set<string>>()
    wanted.forEach(u => { partySets.set(u.uid, new Set()); daySets.set(u.uid, new Set()) })

    // Older flow — one document per person per day, visits in an array.
    visitLogs.forEach(log => {
      const s = byUid.get(log.salesPersonId)
      if (!s) return
      if (!log.isNoEntry && (log.visits || []).length > 0) daySets.get(log.salesPersonId)!.add(log.date)
      ;(log.visits || []).forEach((v: any) => {
        s.visits++
        partySets.get(log.salesPersonId)!.add(v.partyId)
        if (v.outcome === 'interested') s.interested++
        else if (v.outcome === 'not_interested') s.notInterested++
        else if (v.outcome === 'follow_up') s.followUp++
      })
    })

    // Field app — one document per outlet visit, with the structured outcome.
    // Mapping onto the older three-way split: a booked order is interest, the
    // four no-order categories are not, and an institutional outcome (trial
    // requested, committee review, tender) is a follow-up rather than a refusal.
    outletVisits.forEach(v => {
      const s = byUid.get(v.uid)
      if (!s) return
      // A visit abandoned with its duty session never collected an outcome.
      // Counting it would inflate the visit total and dilute conversion with a
      // denominator entry that could never have converted.
      if (v.status === 'abandoned') return
      s.visits++
      partySets.get(v.uid)!.add(v.partyId)
      daySets.get(v.uid)!.add(v.date)
      if (v.remarksCategory === 'order_booked') s.interested++
      else if (v.remarksCategory === 'institutional') s.followUp++
      else if (v.remarksCategory) s.notInterested++
      if (v.durationMinutes) { s.visitMinutes += v.durationMinutes; s.timedVisits++ }
    })

    // Counted from the parties themselves rather than a flag on a visit, so it
    // stays correct whichever flow added them.
    newParties.forEach(p => {
      const s = byUid.get(p.addedBy)
      if (s) s.newParties++
    })

    allocations.forEach(a => {
      const s = byUid.get(a.createdBy)
      if (!s || a.status === 'cancelled') return
      s.orders++
      s.orderValue += a.totalAmount || 0
    })

    payments.forEach(p => {
      const s = p.collectedBy ? byUid.get(p.collectedBy) : undefined
      if (!s || p.status === 'rejected') return
      s.payments++
      s.paymentValue += p.amount || 0
    })

    expenses.forEach(e => {
      const s = byUid.get(e.userId)
      if (!s) return
      s.expenses += e.amount || 0
    })

    leaves.forEach(l => {
      const s = byUid.get(l.uid)
      if (!s || l.status !== 'active') return
      if (l.leaveType === 'full_day') s.fullDayLeave++
      else s.halfDayLeave++
    })

    byUid.forEach((s, uid) => {
      s.uniqueParties = partySets.get(uid)?.size ?? 0
      // A day counts once even if the person used both flows on it.
      s.daysLogged = daySets.get(uid)?.size ?? 0
    })

    const holidaySet = new Set(holidays.map(h => h.date))
    const working = eachDay(from, to).filter(d => {
      if (holidaySet.has(d)) return false
      return new Date(d + 'T00:00:00').getDay() !== 0   // Sundays off
    }).length

    const list = Array.from(byUid.values()).sort((a, b) => b.visits - a.visits)
    const total = list.reduce((acc, s) => ({
      ...acc,
      daysLogged: acc.daysLogged + s.daysLogged,
      visits: acc.visits + s.visits,
      interested: acc.interested + s.interested,
      notInterested: acc.notInterested + s.notInterested,
      followUp: acc.followUp + s.followUp,
      newParties: acc.newParties + s.newParties,
      visitMinutes: acc.visitMinutes + s.visitMinutes,
      timedVisits: acc.timedVisits + s.timedVisits,
      orders: acc.orders + s.orders,
      orderValue: acc.orderValue + s.orderValue,
      payments: acc.payments + s.payments,
      paymentValue: acc.paymentValue + s.paymentValue,
      expenses: acc.expenses + s.expenses,
      fullDayLeave: acc.fullDayLeave + s.fullDayLeave,
      halfDayLeave: acc.halfDayLeave + s.halfDayLeave,
    }), EMPTY('team', 'Team'))
    // unique parties across the whole team, not a sum of per-person sets
    const allParties = new Set<string>()
    partySets.forEach(set => set.forEach(p => allParties.add(p)))
    total.uniqueParties = allParties.size

    return { rows: list, team: total, workingDays: working }
  }, [salesUsers, scope, visitLogs, allocations, payments, expenses, leaves, holidays, from, to])

  const conversion = team.visits > 0 ? ((team.interested / team.visits) * 100).toFixed(1) : '0.0'

  /**
   * One definition of the report's rows, used by the on-screen table and the
   * spreadsheet alike, so the two can never drift apart. Conversion is read
   * from each column's own totals rather than averaged, which is why it takes
   * the whole stats object rather than a number.
   */
  const METRICS: { label: string; get: (s: PersonStats) => number; money?: boolean }[] = [
    { label: 'Days logged', get: s => s.daysLogged },
    { label: 'Visits', get: s => s.visits },
    { label: 'Unique shops', get: s => s.uniqueParties },
    { label: 'Interested', get: s => s.interested },
    { label: 'Not interested', get: s => s.notInterested },
    { label: 'Follow up', get: s => s.followUp },
    { label: 'Conversion %', get: s => s.visits > 0 ? +((s.interested / s.visits) * 100).toFixed(1) : 0 },
    { label: 'New parties', get: s => s.newParties },
    { label: 'Avg minutes in outlet', get: s => s.timedVisits > 0 ? Math.round(s.visitMinutes / s.timedVisits) : 0 },
    { label: 'Orders', get: s => s.orders },
    { label: 'Order value', get: s => s.orderValue, money: true },
    { label: 'Payments', get: s => s.payments },
    { label: 'Payment value', get: s => s.paymentValue, money: true },
    { label: 'Expenses', get: s => s.expenses, money: true },
    { label: 'Full day leave', get: s => s.fullDayLeave },
    { label: 'Half day leave', get: s => s.halfDayLeave },
  ]

  /** People across, plus a total column once there is more than one of them. */
  const columns: PersonStats[] = rows.length > 1 ? [...rows, team] : rows

  // ── excel export ───────────────────────────────────────────────────────────
  const exportExcel = () => {
    const wb = XLSX.utils.book_new()

    // People across the top, metrics down the side, total on the right —
    // the layout a manager actually reads, rather than one row per person.
    const header = ['', ...columns.map(c => c.name)]
    const body = METRICS.map(m => [m.label, ...columns.map(c => m.get(c))])

    const aoa: (string | number)[][] = [
      ['Ocealgo — Sales report'],
      ['Period', prettyRange(from, to)],
      ['Scope', scope === 'all' ? 'Whole team' : rows[0]?.name ?? '—'],
      ['Working days', workingDays],
      ['Generated', new Date().toLocaleString('en-IN')],
      [],
      header,
      ...body,
    ]

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [{ wch: 20 }, ...columns.map(() => ({ wch: 15 }))]
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(1, columns.length) } }]

    // Thousands separators on the money rows so large figures stay readable.
    const firstBodyRow = 7
    METRICS.forEach((m, i) => {
      if (!m.money) return
      for (let c = 1; c <= columns.length; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r: firstBodyRow + i, c })]
        if (cell) cell.z = '#,##0'
      }
    })
    XLSX.utils.book_append_sheet(wb, ws, 'Summary')

    const detail: any[] = []
    visitLogs.forEach(log => {
      if (scope !== 'all' && log.salesPersonId !== scope) return
      ;(log.visits || []).forEach((v: any) => {
        detail.push({
          Date: log.date,
          'Sales Person': log.salesPersonName,
          Party: v.partyName,
          Outcome: v.outcome ?? (v.isRevisit ? 'revisit' : ''),
          Minutes: '',
          Reason: v.notInterestedReason === 'Other' ? (v.otherReason ?? '') : (v.notInterestedReason ?? ''),
          Remarks: v.notes ?? '',
        })
      })
    })
    outletVisits.forEach((v: any) => {
      if (scope !== 'all' && v.uid !== scope) return
      detail.push({
        Date: v.date,
        'Sales Person': v.name,
        Party: v.partyName,
        Outcome: v.status === 'abandoned' ? 'Never closed — day left open'
          : v.remarksCategory ? VISIT_OUTCOME_LABEL[v.remarksCategory as VisitOutcomeCategory] : 'open',
        Minutes: v.durationMinutes ?? '',
        Reason: v.remarksReason ?? '',
        Remarks: v.remarksText ?? '',
      })
    })
    detail.sort((a, b) => String(a.Date).localeCompare(String(b.Date)))
    const detailWs = XLSX.utils.json_to_sheet(
      detail.length ? detail : [{ Date: '', 'Sales Person': '', Party: 'No visits in range' }],
    )
    detailWs['!cols'] = [
      { wch: 12 }, { wch: 18 }, { wch: 28 }, { wch: 14 },
      { wch: 6 }, { wch: 24 }, { wch: 40 },
    ]
    XLSX.utils.book_append_sheet(wb, detailWs, 'Visit detail')

    const who = scope === 'all' ? 'team' : (rows[0]?.name ?? 'person').toLowerCase().replace(/\s+/g, '-')
    XLSX.writeFile(wb, `ocealgo-sales-report-${who}-${from}_to_${to}.xlsx`)
  }

  // ── ui bits ────────────────────────────────────────────────────────────────
  const chip = (active: boolean): CSSProperties => ({
    flex: 1,
    background: active ? t.tint : 'none',
    color: active ? t.text : t.text2,
    border: `0.5px solid ${active ? t.text2 : t.border2}`,
    borderRadius: 6, padding: '9px 6px', fontSize: 13,
    fontWeight: active ? 500 : 400, cursor: 'pointer',
  })

  const Stat = ({ label, value, color, sub }: { label: string; value: string | number; color?: string; sub?: string }) => (
    <div style={{ background: t.card, borderRadius: 12, padding: '12px 10px', textAlign: 'center', border: `1px solid ${t.border}` }}>
      <div style={{ fontSize: 20, fontWeight: 500, color: color ?? t.text }}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 400, color: t.text3, marginTop: 3 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, fontWeight: 400, color: t.text3, marginTop: 2 }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow="Reports"
        title="Sales report"
        subtitle={prettyRange(from, to)}
        onBack={onBack}
      />

      <div className="oc-print-plain" style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Range picker */}
        <div className="oc-no-print" style={{ background: t.card, borderRadius: 14, padding: 14, border: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['day', 'week', 'month', 'custom'] as RangeMode[]).map(m => (
              <button key={m} onClick={() => setMode(m)} style={chip(mode === m)}>
                {m === 'day' ? 'Day' : m === 'week' ? 'Week' : m === 'month' ? 'Month' : 'Custom'}
              </button>
            ))}
          </div>

          {mode === 'day' && <DateInput type="date" value={day} onChange={setDay} />}
          {mode === 'week' && (
            <div>
              <div style={{ fontSize: 11, color: t.text3, marginBottom: 4 }}>Any day in the week</div>
              <DateInput type="date" value={week} onChange={v => setWeek(mondayOf(v))} />
            </div>
          )}
          {mode === 'month' && <DateInput type="month" value={month} onChange={setMonth} />}
          {mode === 'custom' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: t.text3, marginBottom: 4 }}>From</div>
                <DateInput type="date" value={customFrom} onChange={setCustomFrom} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: t.text3, marginBottom: 4 }}>To</div>
                <DateInput type="date" value={customTo} onChange={setCustomTo} />
              </div>
            </div>
          )}

          <div>
            <div style={{ fontSize: 11, color: t.text3, marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>Who</div>
            <CustomSelect
              value={scope}
              onChange={setScope}
              placeholder="Whole team"
              options={[
                { value:'all', label:'Whole team' },
                ...salesUsers.map(u => ({ value: u.uid, label:` ${u.name}` })),
              ]}
            />
          </div>

          <PrimaryButton onClick={exportExcel} disabled={loading} style={{ width: '100%' }}>
            Download Excel
          </PrimaryButton>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>Loading…</div>
        ) : (
          <>
            {/* Team summary */}
            <div style={{ fontSize: 11, color: t.text3, fontWeight: 400, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
              {scope === 'all' ? 'Team totals' : `${rows[0]?.name ?? ''} totals`}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 8 }}>
              <Stat label="Visits" value={team.visits} color="#0891b2" />
              <Stat label="Unique shops" value={team.uniqueParties} color="#6366f1" />
              <Stat label="Interested" value={team.interested} color="#16a34a" sub={`${conversion}%`} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 8 }}>
              <Stat label="Orders" value={team.orders} color="#d97706" sub={`₹${team.orderValue.toLocaleString('en-IN')}`} />
              <Stat label="Collected" value={`₹${(team.paymentValue / 1000).toFixed(0)}k`} color="#7c3aed" sub={`${team.payments} payments`} />
              <Stat label="Expenses" value={`₹${team.expenses.toLocaleString('en-IN')}`} color="#dc2626" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 8 }}>
              <Stat label="Working days" value={workingDays} />
              <Stat label="Days logged" value={team.daysLogged} color="#16a34a" />
              <Stat label="Leave" value={team.fullDayLeave} sub={team.halfDayLeave > 0 ? `+${team.halfDayLeave} half` : undefined} color="#f59e0b" />
            </div>

            {/* The cross-tab: metrics down, people across, total on the right */}
            <div>
              <div style={{ marginBottom: 12 }}>
                <Eyebrow>{columns.length > 1 ? 'By person' : 'Detail'}</Eyebrow>
              </div>

              {columns.length === 0 ? (
                <EmptyState
                  title="No sales people found"
                  body="Approve someone into an offline sales role and their numbers will appear here."
                />
              ) : (
                <div style={{ overflowX: 'auto', borderBottom: `0.5px solid ${t.border}` }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 120 + columns.length * 96 }}>
                    <thead>
                      <tr>
                        <th style={{
                          position: 'sticky', left: 0, background: t.bg, zIndex: 1,
                          textAlign: 'left', padding: '10px 12px 10px 0',
                          fontSize: 12, fontWeight: 400, color: t.text3,
                          borderBottom: `0.5px solid ${t.border}`, whiteSpace: 'nowrap',
                        }} />
                        {columns.map((c, i) => {
                          const isTotal = columns.length > 1 && i === columns.length - 1
                          return (
                            <th key={c.uid} style={{
                              textAlign: 'right', padding: '10px 12px',
                              fontSize: 13, fontWeight: 500,
                              color: isTotal ? t.text : t.text2,
                              borderBottom: `0.5px solid ${isTotal ? t.text2 : t.border}`,
                              borderLeft: isTotal ? `0.5px solid ${t.border}` : undefined,
                              whiteSpace: 'nowrap',
                            }}>
                              {c.name}
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {METRICS.map(m => (
                        <tr key={m.label}>
                          <td style={{
                            position: 'sticky', left: 0, background: t.bg, zIndex: 1,
                            padding: '11px 12px 11px 0', fontSize: 13, color: t.text3,
                            borderTop: `0.5px solid ${t.border}`, whiteSpace: 'nowrap',
                          }}>
                            {m.label}
                          </td>
                          {columns.map((c, i) => {
                            const isTotal = columns.length > 1 && i === columns.length - 1
                            const v = m.get(c)
                            return (
                              <td key={c.uid} style={{
                                textAlign: 'right', padding: '11px 12px',
                                fontSize: 14, fontWeight: isTotal ? 500 : 400,
                                color: v === 0 ? t.text3 : t.text,
                                borderTop: `0.5px solid ${t.border}`,
                                borderLeft: isTotal ? `0.5px solid ${t.border}` : undefined,
                                whiteSpace: 'nowrap',
                              }}>
                                {m.money ? `₹${v.toLocaleString('en-IN')}` : v.toLocaleString('en-IN')}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ fontSize: 12, color: t.text3, marginTop: 12, lineHeight: 1.6 }}>
                {workingDays} working days in this period. Conversion is interested
                visits as a share of all visits, worked out per column rather than averaged.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}