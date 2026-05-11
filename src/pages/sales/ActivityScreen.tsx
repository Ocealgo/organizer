import React, { useState, useEffect, useMemo } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import {
  DailyVisitLog, RevisitLog, UnifiedAllocation, PaymentTransaction, ExpenseEntry,
  StockUpdateAction, NewOrderAction, PaymentCollectionAction,
} from '../../types'
import { localDateStr, localMonthStr } from '../../utils/date'

interface Props {
  onBack: () => void
  onViewAllocation?: (allocId: string) => void
  onViewPayment?: (partyId: string, paymentId: string) => void
}
type FilterTab = 'all' | 'visits' | 'activity' | 'expense'

interface DayData {
  visitLog: DailyVisitLog | null
  revisitLogs: RevisitLog[]
  allocations: UnifiedAllocation[]
  payments: PaymentTransaction[]
  expenses: ExpenseEntry[]
}

const tsToDate = (ts: number) => new Date(ts).toLocaleDateString('en-CA')

const dayFmt = (date: string) =>
  new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })

const shortDayFmt = (date: string) =>
  new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

const weekStartOf = (dateStr: string) => {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()
  const mon = new Date(d)
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return mon.toLocaleDateString('en-CA')
}

const addDaysTo = (s: string, n: number) => {
  const d = new Date(s + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA')
}

const allocStyle = (s: string) => ({
  pending:   { label: 'Pending',    color: '#d97706', bg: 'rgba(217,119,6,0.12)' },
  sent:      { label: 'Sent ✓',    color: '#2563eb', bg: 'rgba(37,99,235,0.10)' },
  paid:      { label: 'Paid ✓',    color: '#16a34a', bg: 'rgba(22,163,74,0.10)' },
  overdue:   { label: 'Overdue',   color: '#dc2626', bg: 'rgba(220,38,38,0.10)' },
  cancelled: { label: 'Cancelled', color: '#6b7280', bg: 'rgba(107,114,128,0.10)' },
} as Record<string, { label: string; color: string; bg: string }>)[s] ?? { label: s, color: '#6b7280', bg: 'rgba(107,114,128,0.10)' }

const payStyle = (s: string) => ({
  pending_approval: { label: 'Pending approval', color: '#d97706' },
  approved:         { label: 'Approved ✓',       color: '#16a34a' },
  rejected:         { label: 'Rejected',          color: '#dc2626' },
} as Record<string, { label: string; color: string }>)[s] ?? { label: s, color: '#6b7280' }

const catLabel: Record<string, string> = {
  bus_fare: '🚌 Bus fare', fuel: '⛽ Fuel', food: '🍽️ Food',
  lodging: '🏨 Lodging', printing: '🖨️ Printing', other: '📋 Other',
}

export default function ActivityScreen({ onBack, onViewAllocation, onViewPayment }: Props) {
  const { appUser } = useAuth()
  const { t, theme } = useTheme()

  const [visitLogs, setVisitLogs] = useState<DailyVisitLog[]>([])
  const [revisitLogs, setRevisitLogs] = useState<RevisitLog[]>([])
  const [allocations, setAllocations] = useState<UnifiedAllocation[]>([])
  const [payments, setPayments] = useState<PaymentTransaction[]>([])
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([])
  const [selectedMonth, setSelectedMonth] = useState(localMonthStr())
  const [timeFilter, setTimeFilter] = useState<'day' | 'week' | 'month' | 'custom'>('day')
  const [selectedDate, setSelectedDate] = useState(localDateStr())
  const [customStart, setCustomStart] = useState(localDateStr())
  const [customEnd, setCustomEnd] = useState(localDateStr())
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set([localDateStr()]))
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')

  const changeMonth = (delta: number) => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const monthLabel = new Date(selectedMonth + '-02').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  const [rangeStart, rangeEnd] = useMemo(() => {
    if (timeFilter === 'day') return [selectedDate, selectedDate]
    if (timeFilter === 'week') {
      const ws = weekStartOf(selectedDate)
      return [ws, addDaysTo(ws, 6)]
    }
    if (timeFilter === 'month') return [selectedMonth + '-01', selectedMonth + '-31']
    return [customStart || localDateStr(), customEnd || localDateStr()]
  }, [timeFilter, selectedDate, selectedMonth, customStart, customEnd])

  useEffect(() => {
    if (!appUser) return
    return onSnapshot(query(collection(db, 'visit_logs'), where('salesPersonId', '==', appUser.uid)), snap =>
      setVisitLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as DailyVisitLog))))
  }, [appUser])

  useEffect(() => {
    if (!appUser) return
    return onSnapshot(query(collection(db, 'revisit_logs'), where('salesPersonId', '==', appUser.uid)), snap =>
      setRevisitLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as RevisitLog))))
  }, [appUser])

  useEffect(() =>
    onSnapshot(collection(db, 'allocations_v2'), snap =>
      setAllocations(snap.docs.map(d => ({ id: d.id, ...d.data() } as UnifiedAllocation))))
  , [])

  useEffect(() =>
    onSnapshot(collection(db, 'payment_transactions'), snap =>
      setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() } as PaymentTransaction))))
  , [])

  useEffect(() => {
    if (!appUser) return
    return onSnapshot(query(collection(db, 'expense_entries'), where('userId', '==', appUser.uid)), snap =>
      setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() } as ExpenseEntry))))
  }, [appUser])

  const dayMap = useMemo(() => {
    if (!appUser) return {} as Record<string, DayData>
    const map: Record<string, DayData> = {}
    const ensure = (date: string) => {
      if (!map[date]) map[date] = { visitLog: null, revisitLogs: [], allocations: [], payments: [], expenses: [] }
    }
    const inRange = (date: string) => !!date && date >= rangeStart && date <= rangeEnd
    visitLogs.filter(l => inRange(l.date) && !l.isNoEntry).forEach(l => {
      ensure(l.date); map[l.date].visitLog = l
    })
    revisitLogs.filter(l => inRange(l.date)).forEach(l => {
      ensure(l.date); map[l.date].revisitLogs.push(l)
    })
    allocations.filter(a => a.createdBy === appUser.uid && inRange(tsToDate(a.createdAt))).forEach(a => {
      const d = tsToDate(a.createdAt); ensure(d); map[d].allocations.push(a)
    })
    payments.filter(p => p.collectedBy === appUser.uid && inRange(p.date || '')).forEach(p => {
      ensure(p.date); map[p.date].payments.push(p)
    })
    expenses.filter(e => inRange(e.date)).forEach(e => {
      ensure(e.date); map[e.date].expenses.push(e)
    })
    return map
  }, [visitLogs, revisitLogs, allocations, payments, expenses, rangeStart, rangeEnd, appUser])

  const sortedDays = useMemo(() => Object.keys(dayMap).sort((a, b) => b.localeCompare(a)), [dayMap])

  const toggleDay = (date: string) => setExpandedDays(prev => {
    const n = new Set(prev); n.has(date) ? n.delete(date) : n.add(date); return n
  })
  const toggleSec = (key: string) => setCollapsedSections(prev => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n
  })
  const secOpen = (key: string) => !collapsedSections.has(key)

  const secHeader = (label: string, secKey: string, count: number) => (
    <button onClick={() => toggleSec(secKey)}
      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', padding: '10px 0 6px', cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)' }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: theme === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)', background: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 99, padding: '1px 7px' }}>{count}</span>
      </div>
      <span style={{ fontSize: 14, color: t.text3 }}>{secOpen(secKey) ? '▾' : '▸'}</span>
    </button>
  )

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>

      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#0d3d2e,#1a5c42)', padding: '20px 20px 16px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#6ee7b7', padding: '6px 14px', borderRadius: 20, fontSize: 13, marginBottom: 14 }}>← Back</button>
        <div style={{ color: '#6ee7b7', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Personal</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', marginBottom: 12 }}>My Activity</div>

        {/* Time filter tabs */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
          {(['day', 'week', 'month', 'custom'] as const).map(tf => (
            <button key={tf} onClick={() => setTimeFilter(tf)}
              style={{ flex: 1, background: timeFilter === tf ? 'rgba(110,231,183,0.2)' : 'rgba(255,255,255,0.06)', border: `1px solid ${timeFilter === tf ? '#6ee7b7' : 'rgba(255,255,255,0.1)'}`, color: timeFilter === tf ? '#6ee7b7' : 'rgba(255,255,255,0.6)', borderRadius: 10, padding: '6px 4px', fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }}>
              {tf === 'custom' ? 'Period' : tf.charAt(0).toUpperCase() + tf.slice(1)}
            </button>
          ))}
        </div>

        {/* Date navigation based on filter */}
        {timeFilter === 'custom' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: '8px 12px', marginBottom: 12 }}>
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              style={{ flex: 1, background: 'none', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, outline: 'none' }} />
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>→</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              style={{ flex: 1, background: 'none', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, outline: 'none' }} />
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: '8px 12px', marginBottom: 12 }}>
            <button onClick={() => {
              if (timeFilter === 'day') setSelectedDate(addDaysTo(selectedDate, -1))
              else if (timeFilter === 'week') setSelectedDate(addDaysTo(selectedDate, -7))
              else changeMonth(-1)
            }} style={{ background: 'none', border: 'none', color: '#6ee7b7', fontSize: 20, padding: '0 8px', cursor: 'pointer', lineHeight: 1 }}>‹</button>
            <div style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#fff' }}>
              {timeFilter === 'day' && dayFmt(selectedDate)}
              {timeFilter === 'week' && `${shortDayFmt(rangeStart)} – ${shortDayFmt(rangeEnd)}`}
              {timeFilter === 'month' && monthLabel}
            </div>
            <button onClick={() => {
              if (timeFilter === 'day') setSelectedDate(addDaysTo(selectedDate, 1))
              else if (timeFilter === 'week') setSelectedDate(addDaysTo(selectedDate, 7))
              else changeMonth(1)
            }} style={{ background: 'none', border: 'none', color: '#6ee7b7', fontSize: 20, padding: '0 8px', cursor: 'pointer', lineHeight: 1 }}>›</button>
          </div>
        )}

        {/* Content filter tabs */}
        <div style={{ display: 'flex', gap: 6 }}>
          {([
            { id: 'all',      label: 'All' },
            { id: 'visits',   label: '🗺️ Visits' },
            { id: 'activity', label: '📦 Activity' },
            { id: 'expense',  label: '💸 Expense' },
          ] as { id: FilterTab; label: string }[]).map(f => (
            <button key={f.id} onClick={() => setActiveFilter(f.id)}
              style={{ flex: 1, background: activeFilter === f.id ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)', border: `1px solid ${activeFilter === f.id ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.1)'}`, color: '#fff', borderRadius: 10, padding: '7px 4px', fontSize: 11, fontWeight: 700 }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Day list */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sortedDays.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.text2 }}>No activity found</div>
          </div>
        )}

        {sortedDays.map(date => {
          const day = dayMap[date]
          const isToday = date === localDateStr()
          const isExpanded = expandedDays.has(date)

          const newPartyEntries = day.visitLog?.visits?.filter(v => v.isNew) ?? []
          const visitCount = day.revisitLogs.filter(rl => !rl.actions.every(action => {
            const a = action as any
            if (a.removed) return true
            return action.type === 'relationship_visit' || action.type === 'no_longer_active'
          })).length
          const actCount = newPartyEntries.length + day.allocations.length + day.payments.length
          const expTotal = day.expenses.reduce((s, e) => s + e.amount, 0)

          const showVisits   = (activeFilter === 'all' || activeFilter === 'visits') && visitCount > 0
          const showActivity = (activeFilter === 'all' || activeFilter === 'activity') && actCount > 0
          const showExpense  = (activeFilter === 'all' || activeFilter === 'expense') && day.expenses.length > 0

          if (!showVisits && !showActivity && !showExpense) return null

          const vKey = `${date}-v`
          const aKey = `${date}-a`
          const eKey = `${date}-e`

          return (
            <div key={date} style={{ background: t.card, borderRadius: 16, border: `1px solid ${isToday ? 'rgba(16,185,129,0.35)' : t.border}`, overflow: 'hidden' }}>

              {/* Day header */}
              <button onClick={() => toggleDay(date)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isToday && <span style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 99, letterSpacing: 1 }}>TODAY</span>}
                  <span style={{ fontSize: 15, fontWeight: 800, color: t.text }}>{dayFmt(date)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {visitCount > 0 && <span style={{ fontSize: 11, color: '#0891b2' }}>🗺️ {visitCount}</span>}
                    {actCount > 0 && <span style={{ fontSize: 11, color: '#d97706' }}>📦 {actCount}</span>}
                    {day.expenses.length > 0 && <span style={{ fontSize: 11, color: '#16a34a' }}>💸 ₹{expTotal.toLocaleString('en-IN')}</span>}
                  </div>
                  <span style={{ fontSize: 16, color: t.text3 }}>{isExpanded ? '▾' : '▸'}</span>
                </div>
              </button>

              {isExpanded && (
                <div style={{ borderTop: `1px solid ${t.border}`, padding: '0 16px 12px' }}>

                  {/* ── VISITS ── */}
                  {showVisits && (
                    <>
                      {secHeader('Visits', vKey, visitCount)}
                      {secOpen(vKey) && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>

                          {/* Revisit entries */}
                          {day.revisitLogs.map(rl => {
                            // Skip card if all actions are removed and produce no visible output
                            const allInvisible = rl.actions.every(action => {
                              const a = action as any
                              if (a.removed) return true
                              return action.type === 'relationship_visit' || action.type === 'no_longer_active'
                            })
                            if (allInvisible) return null
                            return (
                            <div key={rl.id} style={{ background: t.bg3, borderRadius: 12, border: `1px solid ${t.border}` }}>
                              <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 10, fontWeight: 800, color: '#0891b2', background: 'rgba(8,145,178,0.1)', padding: '2px 8px', borderRadius: 99 }}>REVISIT</span>
                                <span style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{rl.partyName}</span>
                              </div>

                              <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {rl.actions.map((action, ai) => {
                                  const a = action as StockUpdateAction

                                  // Ghost row for removed actions
                                  if ((a as any).removed) {
                                    const ghostStyle = { background: 'rgba(107,114,128,0.06)', borderRadius: 8, padding: '8px 12px', border: '1px dashed rgba(107,114,128,0.25)' }
                                    if (action.type === 'new_order') {
                                      const na = action as any
                                      return <div key={ai} style={ghostStyle}><div style={{ fontSize: 12, color: t.text3 }}>🛒 Order cancelled{na.removedByName ? ` by ${na.removedByName}` : ''}</div><div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>Was: {na.quantity} pkts · ₹{(na.totalAmount||0).toLocaleString('en-IN')}</div></div>
                                    }
                                    if (action.type === 'payment_collection') {
                                      const pa = action as any
                                      return <div key={ai} style={ghostStyle}><div style={{ fontSize: 12, color: t.text3 }}>💰 Payment cancelled</div><div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>Was: ₹{(pa.amount||0).toLocaleString('en-IN')}</div></div>
                                    }
                                    if (action.type === 'relationship_visit' || action.type === 'no_longer_active') return null
                                    return (
                                      <div key={ai} style={ghostStyle}>
                                        <div style={{ fontSize: 12, color: t.text3 }}>📦 Stock update · <span style={{ fontStyle: 'italic' }}>removed {a.removedByName ? `by ${a.removedByName}` : ''}</span></div>
                                        <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>Was: {a.balanceQty} pkts · ₹{(a.balanceValue || 0).toLocaleString('en-IN')}</div>
                                      </div>
                                    )
                                  }

                                  if (action.type === 'stock_update') {
                                    const sa = action as StockUpdateAction
                                    return (
                                      <div key={ai} style={{ background: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', borderRadius: 8, padding: '10px 12px', border: `1px solid ${t.border}` }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                                          <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>📦 Stock Update</span>
                                          {sa.editedAt && <span style={{ fontSize: 10, color: '#0891b2', fontWeight: 700 }}>· corrected</span>}
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                                          {[['Opening', sa.openingQty], ['Purchased', sa.purchasedQty], ['Sold', sa.soldQty], ['Balance', `${sa.balanceQty} pkts`]].map(([lbl, val]) => (
                                            <div key={lbl as string} style={{ fontSize: 12 }}>
                                              <span style={{ color: t.text3 }}>{lbl} </span>
                                              <span style={{ fontWeight: 700, color: t.text }}>{val}</span>
                                            </div>
                                          ))}
                                        </div>
                                        {(sa.balanceValue ?? 0) > 0 && <div style={{ fontSize: 12, color: t.text2, marginTop: 6 }}>₹{sa.balanceValue.toLocaleString('en-IN')} value</div>}
                                      </div>
                                    )
                                  }

                                  if (action.type === 'new_order') {
                                    const na = action as NewOrderAction
                                    const alloc = allocations.find(a => a.id === na.allocationId)
                                    const displayPkts = alloc?.packets ?? na.quantity
                                    const displayTotal = alloc ? alloc.totalAmount : (na.totalAmount || 0)
                                    const displayPayment = alloc?.paymentType ?? na.paymentType
                                    const ss = alloc ? allocStyle(alloc.status) : null
                                    const canTap = !!onViewAllocation && !!na.allocationId
                                    return (
                                      <div key={ai}
                                        onClick={() => canTap && onViewAllocation!(na.allocationId!)}
                                        style={{ background: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', borderRadius: 8, padding: '10px 12px', border: `1px solid ${t.border}`, cursor: canTap ? 'pointer' : 'default' }}>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                                          <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 4 }}>🛒 New Order · {na.productName}</div>
                                            <div style={{ fontSize: 12, color: t.text2 }}>
                                              {displayPkts} pkts · ₹{displayTotal.toLocaleString('en-IN')} · <span style={{ color: displayPayment === 'credit' ? '#d97706' : '#16a34a' }}>{displayPayment}</span>
                                            </div>
                                            {ss && <span style={{ marginTop: 6, display: 'inline-block', fontSize: 11, fontWeight: 700, color: ss.color, background: ss.bg, borderRadius: 99, padding: '2px 8px' }}>{ss.label}</span>}
                                          </div>
                                          {canTap && <span style={{ fontSize: 16, color: t.text3, flexShrink: 0 }}>›</span>}
                                        </div>
                                      </div>
                                    )
                                  }

                                  if (action.type === 'payment_collection') {
                                    const pa = action as PaymentCollectionAction
                                    const livePay = pa.transactionId ? payments.find(p => p.id === pa.transactionId) : null
                                    const displayAmount = livePay?.amount ?? pa.amount ?? 0
                                    const displayStatus = livePay?.status ?? pa.status
                                    const canTap = !!onViewPayment && !!pa.transactionId
                                    return (
                                      <div key={ai}
                                        onClick={() => canTap && onViewPayment!(rl.partyId, pa.transactionId!)}
                                        style={{ background: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', borderRadius: 8, padding: '10px 12px', border: `1px solid ${t.border}`, cursor: canTap ? 'pointer' : 'default' }}>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                                          <div>
                                            <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>💰 Payment Collected</div>
                                            <div style={{ fontSize: 12, color: t.text2, marginTop: 2 }}>₹{displayAmount.toLocaleString('en-IN')}{livePay?.notes ? ` · ${livePay.notes}` : pa.notes ? ` · ${pa.notes}` : ''}</div>
                                            <div style={{ fontSize: 11, marginTop: 2, fontWeight: 700, color: displayStatus === 'approved' ? '#16a34a' : displayStatus === 'rejected' ? '#dc2626' : '#d97706' }}>
                                              {displayStatus === 'approved' ? '✅ Approved' : displayStatus === 'rejected' ? '❌ Cancelled' : '⏳ Pending approval'}
                                            </div>
                                          </div>
                                          {canTap && <span style={{ fontSize: 16, color: t.text3, flexShrink: 0 }}>›</span>}
                                        </div>
                                      </div>
                                    )
                                  }

                                  return null
                                })}
                              </div>

                              {rl.notes && (
                                <div style={{ padding: '0 14px 12px', fontSize: 12, color: t.text3, fontStyle: 'italic' }}>"{rl.notes}"</div>
                              )}
                            </div>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}

                  {/* ── ACTIVITY ── */}
                  {showActivity && (
                    <>
                      {secHeader('Activity', aKey, actCount)}
                      {secOpen(aKey) && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>

                          {newPartyEntries.map((v, vi) => (
                            <div key={`np-${vi}`} style={{ background: t.bg3, borderRadius: 12, padding: '12px 14px', border: '1px solid rgba(99,102,241,0.3)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 10, fontWeight: 800, color: '#6366f1', background: 'rgba(99,102,241,0.12)', padding: '2px 8px', borderRadius: 99, letterSpacing: 1 }}>NEW PARTY</span>
                                <span style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{v.partyName}</span>
                              </div>
                              <div style={{ fontSize: 12, color: t.text3, marginTop: 4 }}>Added as a new party during visit</div>
                            </div>
                          ))}

                          {day.allocations.map(a => {
                            const s = allocStyle(a.status)
                            return (
                              <div key={a.id}
                                onClick={() => onViewAllocation?.(a.id!)}
                                style={{ background: t.bg3, borderRadius: 12, padding: '12px 14px', border: `1px solid ${t.border}`, cursor: onViewAllocation ? 'pointer' : 'default' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>📦 Allocation · {a.partyName}</div>
                                    <div style={{ fontSize: 12, color: t.text2, marginTop: 3 }}>{a.productName} · {a.packets} pkts · ₹{a.totalAmount.toLocaleString('en-IN')}</div>
                                    <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>{a.paymentType === 'credit' ? '💳 Credit' : '💵 Cash'}</div>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: s.color, background: s.bg, borderRadius: 99, padding: '3px 10px' }}>{s.label}</span>
                                    {onViewAllocation && <span style={{ fontSize: 16, color: t.text3 }}>›</span>}
                                  </div>
                                </div>
                              </div>
                            )
                          })}

                          {day.payments.map(p => {
                            const s = payStyle(p.status)
                            return (
                              <div key={p.id}
                                onClick={() => onViewPayment?.(p.partyId, p.id!)}
                                style={{ background: t.bg3, borderRadius: 12, padding: '12px 14px', border: `1px solid ${t.border}`, cursor: onViewPayment ? 'pointer' : 'default' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>💰 Payment · {p.partyName}</div>
                                    <div style={{ fontSize: 12, color: t.text2, marginTop: 3 }}>₹{p.amount.toLocaleString('en-IN')} · {p.paymentMethod.replace('_', ' ')}</div>
                                    {p.notes && <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>{p.notes}</div>}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{s.label}</span>
                                    {onViewPayment && <span style={{ fontSize: 16, color: t.text3 }}>›</span>}
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}

                  {/* ── EXPENSE ── */}
                  {showExpense && (
                    <>
                      {secHeader(`Expense · ₹${expTotal.toLocaleString('en-IN')}`, eKey, day.expenses.length)}
                      {secOpen(eKey) && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                          {day.expenses.map(e => (
                            <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: t.bg3, borderRadius: 10, padding: '10px 12px', border: `1px solid ${t.border}` }}>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>
                                  {e.type === 'allowance' ? `✅ ${e.allowanceType} Allowance` : catLabel[e.category ?? ''] ?? e.category}
                                </div>
                                {e.notes && <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>{e.notes}</div>}
                              </div>
                              <div style={{ fontSize: 14, fontWeight: 800, color: t.text }}>₹{e.amount.toLocaleString('en-IN')}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
