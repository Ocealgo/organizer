import { useState, useEffect, useMemo, CSSProperties } from 'react'
import * as XLSX from 'xlsx'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { AppUser, Holiday, LeaveRecord } from '../../types'
import { useTheme } from '../../context/ThemeContext'
import CustomSelect from '../../components/CustomSelect'
import DateInput from '../../components/DateInput'
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
  revisits: number
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
  newParties: 0, revisits: 0,
  orders: 0, orderValue: 0,
  payments: 0, paymentValue: 0,
  expenses: 0, fullDayLeave: 0, halfDayLeave: 0,
})

export default function SalesReport({ onBack }: Props) {
  const { t, theme } = useTheme()
  const isDark = theme === 'dark'

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
      byDate('revisit_logs', setRevisitLogs),
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
    wanted.forEach(u => partySets.set(u.uid, new Set()))

    visitLogs.forEach(log => {
      const s = byUid.get(log.salesPersonId)
      if (!s) return
      if (!log.isNoEntry && (log.visits || []).length > 0) s.daysLogged++
      ;(log.visits || []).forEach((v: any) => {
        s.visits++
        partySets.get(log.salesPersonId)!.add(v.partyId)
        if (v.outcome === 'interested') s.interested++
        else if (v.outcome === 'not_interested') s.notInterested++
        else if (v.outcome === 'follow_up') s.followUp++
        if (v.isNew) s.newParties++
        if (v.isRevisit) s.revisits++
      })
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

    byUid.forEach((s, uid) => { s.uniqueParties = partySets.get(uid)?.size ?? 0 })

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
      revisits: acc.revisits + s.revisits,
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

  // ── excel export ───────────────────────────────────────────────────────────
  const exportExcel = () => {
    const wb = XLSX.utils.book_new()

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { Metric: 'Period', Value: prettyRange(from, to) },
      { Metric: 'Scope', Value: scope === 'all' ? 'Whole team' : rows[0]?.name ?? '—' },
      { Metric: 'Working days', Value: workingDays },
      { Metric: 'Days logged', Value: team.daysLogged },
      { Metric: 'Total visits', Value: team.visits },
      { Metric: 'Unique shops', Value: team.uniqueParties },
      { Metric: 'Interested', Value: team.interested },
      { Metric: 'Not interested', Value: team.notInterested },
      { Metric: 'Follow up', Value: team.followUp },
      { Metric: 'Conversion %', Value: conversion },
      { Metric: 'New parties', Value: team.newParties },
      { Metric: 'Orders created', Value: team.orders },
      { Metric: 'Order value', Value: team.orderValue },
      { Metric: 'Payments collected', Value: team.payments },
      { Metric: 'Payment value', Value: team.paymentValue },
      { Metric: 'Expenses', Value: team.expenses },
      { Metric: 'Full day leave', Value: team.fullDayLeave },
      { Metric: 'Half day leave', Value: team.halfDayLeave },
    ]), 'Summary')

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(s => ({
      'Sales Person': s.name,
      'Days Logged': s.daysLogged,
      'Visits': s.visits,
      'Unique Shops': s.uniqueParties,
      'Interested': s.interested,
      'Not Interested': s.notInterested,
      'Follow Up': s.followUp,
      'New Parties': s.newParties,
      'Revisits': s.revisits,
      'Orders': s.orders,
      'Order Value': s.orderValue,
      'Payments': s.payments,
      'Payment Value': s.paymentValue,
      'Expenses': s.expenses,
      'Full Day Leave': s.fullDayLeave,
      'Half Day Leave': s.halfDayLeave,
    }))), 'Per Person')

    const detail: any[] = []
    visitLogs.forEach(log => {
      if (scope !== 'all' && log.salesPersonId !== scope) return
      ;(log.visits || []).forEach((v: any) => {
        detail.push({
          Date: log.date,
          'Sales Person': log.salesPersonName,
          Party: v.partyName,
          Outcome: v.outcome ?? (v.isRevisit ? 'revisit' : ''),
          New: v.isNew ? 'Yes' : '',
          Reason: v.notInterestedReason === 'Other' ? (v.otherReason ?? '') : (v.notInterestedReason ?? ''),
          Notes: v.notes ?? '',
        })
      })
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      detail.length ? detail : [{ Date: '', 'Sales Person': '', Party: 'No visits in range' }],
    ), 'Visit Detail')

    const who = scope === 'all' ? 'team' : (rows[0]?.name ?? 'person').toLowerCase().replace(/\s+/g, '-')
    XLSX.writeFile(wb, `sales-report-${who}-${from}_to_${to}.xlsx`)
  }

  // ── ui bits ────────────────────────────────────────────────────────────────
  const chip = (active: boolean): CSSProperties => ({
    flex: 1,
    background: active ? 'rgba(8,145,178,0.15)' : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    color: active ? '#0891b2' : t.text3,
    border: `1.5px solid ${active ? '#0891b2' : t.border}`,
    borderRadius: 10, padding: '9px 6px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  })

  const Stat = ({ label, value, color, sub }: { label: string; value: string | number; color?: string; sub?: string }) => (
    <div style={{ background: t.card, borderRadius: 12, padding: '12px 10px', textAlign: 'center', border: `1px solid ${t.border}` }}>
      <div style={{ fontSize: 20, fontWeight: 900, color: color ?? t.text }}>{value}</div>
      <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: t.text3, marginTop: 1 }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#0e4f7a,#0891b2)', padding: '20px 20px 16px' }}>
        <button onClick={onBack}
          style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#bae6fd', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 14, cursor: 'pointer' }}>
          ← Back
        </button>
        <div style={{ color: '#bae6fd', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 2 }}>Reports 📊</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>Sales Report</div>
        <div style={{ fontSize: 13, color: '#e0f2fe', marginTop: 2 }}>{prettyRange(from, to)}</div>
      </div>

      <div style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Range picker */}
        <div style={{ background: t.card, borderRadius: 14, padding: 14, border: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                { value: 'all', label: '👥 Whole team' },
                ...salesUsers.map(u => ({ value: u.uid, label: `🏪 ${u.name}` })),
              ]}
            />
          </div>

          <button onClick={exportExcel} disabled={loading}
            style={{ background: 'linear-gradient(135deg,#0e4f7a,#0891b2)', color: '#fff', border: 'none', borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
            ⬇️ Download Excel
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>Loading…</div>
        ) : (
          <>
            {/* Team summary */}
            <div style={{ fontSize: 11, color: t.text3, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' }}>
              {scope === 'all' ? 'Team totals' : `${rows[0]?.name ?? ''} totals`}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <Stat label="Visits" value={team.visits} color="#0891b2" />
              <Stat label="Unique shops" value={team.uniqueParties} color="#6366f1" />
              <Stat label="Interested" value={team.interested} color="#16a34a" sub={`${conversion}%`} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <Stat label="Orders" value={team.orders} color="#d97706" sub={`₹${team.orderValue.toLocaleString('en-IN')}`} />
              <Stat label="Collected" value={`₹${(team.paymentValue / 1000).toFixed(0)}k`} color="#7c3aed" sub={`${team.payments} payments`} />
              <Stat label="Expenses" value={`₹${team.expenses.toLocaleString('en-IN')}`} color="#dc2626" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <Stat label="Working days" value={workingDays} />
              <Stat label="Days logged" value={team.daysLogged} color="#16a34a" />
              <Stat label="Leave" value={team.fullDayLeave} sub={team.halfDayLeave > 0 ? `+${team.halfDayLeave} half` : undefined} color="#f59e0b" />
            </div>

            {/* Per person */}
            {scope === 'all' && (
              <>
                <div style={{ fontSize: 11, color: t.text3, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 }}>
                  Per person ({rows.length})
                </div>
                {rows.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 32, color: t.text3 }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
                    <div style={{ fontWeight: 700 }}>No sales users found</div>
                  </div>
                ) : rows.map(s => (
                  <div key={s.uid} style={{ background: t.card, borderRadius: 14, padding: 14, border: `1px solid ${t.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#0891b2,#0e7490)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 14, color: '#fff', flexShrink: 0 }}>
                        {s.name[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 800, fontSize: 15, color: t.text }}>{s.name}</div>
                        <div style={{ fontSize: 11, color: t.text3 }}>
                          {s.daysLogged} of {workingDays} days logged
                          {s.fullDayLeave > 0 && ` · ${s.fullDayLeave} leave`}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 16, fontWeight: 900, color: '#0891b2' }}>{s.visits}</div>
                        <div style={{ fontSize: 10, color: t.text3 }}>visits</div>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
                      {([
                        ['Shops', s.uniqueParties, t.text],
                        ['Interested', s.interested, '#16a34a'],
                        ['Orders', s.orders, '#d97706'],
                        ['New', s.newParties, '#6366f1'],
                      ] as [string, number, string][]).map(([label, val, color]) => (
                        <div key={label} style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: 8, padding: '7px 4px', textAlign: 'center' }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color }}>{val}</div>
                          <div style={{ fontSize: 10, color: t.text3 }}>{label}</div>
                        </div>
                      ))}
                    </div>
                    {(s.orderValue > 0 || s.paymentValue > 0 || s.expenses > 0) && (
                      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', fontSize: 11 }}>
                        {s.orderValue > 0 && <span style={{ color: '#d97706' }}>📦 ₹{s.orderValue.toLocaleString('en-IN')}</span>}
                        {s.paymentValue > 0 && <span style={{ color: '#7c3aed' }}>💰 ₹{s.paymentValue.toLocaleString('en-IN')}</span>}
                        {s.expenses > 0 && <span style={{ color: '#dc2626' }}>💸 ₹{s.expenses.toLocaleString('en-IN')}</span>}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
