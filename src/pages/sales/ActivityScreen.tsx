import React, { useState, useEffect, useMemo } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import {
  DailyVisitLog, RevisitLog, UnifiedAllocation, PaymentTransaction, ExpenseEntry,
  StockUpdateAction, NewOrderAction, PaymentCollectionAction,
} from '../../types'
import { localDateStr, localMonthStr } from '../../utils/date'
import DateInput from '../../components/DateInput'
import {
  PageHeader, TabBar, Section, EmptyState, ChipGroup, GhostButton,
} from '../../components/ui'

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

const ALLOC_LABEL: Record<string, string> = {
  pending: 'Pending', sent: 'Sent', paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled',
}

/** Only these two states are something the rep can still act on. */
const NEEDS_ACTION = ['pending', 'overdue']

const PAY_LABEL: Record<string, string> = {
  pending_approval: 'Awaiting confirmation', approved: 'Confirmed', rejected: 'Cancelled',
}

const CAT_LABEL: Record<string, string> = {
  bus_fare: 'Bus fare', fuel: 'Fuel', food: 'Food',
  lodging: 'Lodging', printing: 'Printing', other: 'Other',
}

export default function ActivityScreen({ onBack, onViewAllocation, onViewPayment }: Props) {
  const { appUser } = useAuth()
  const { t } = useTheme()

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

  const money = (n: number) => `₹${n.toLocaleString('en-IN')}`

  const secHeader = (label: string, secKey: string, count: number) => (
    <button className="oc-action" onClick={() => toggleSec(secKey)}
      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
               background: 'none', border: 'none', padding: '14px 0 10px', cursor: 'pointer' }}>
      <span style={{ fontSize: 11, letterSpacing: '0.09em', textTransform: 'uppercase', color: t.text3 }}>
        {label} · {count}
      </span>
      <span style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>{secOpen(secKey) ? 'Hide' : 'Show'}</span>
    </button>
  )

  /** One entry inside a day — title, detail lines, an optional right-hand status. */
  const Entry = ({ title, lines, status, warn, onClick, faded }: {
    title: string
    lines?: (string | null | undefined)[]
    status?: string
    warn?: boolean
    onClick?: () => void
    faded?: boolean
  }) => {
    const body = (
      <>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 400, color: t.text }}>{title}</span>
          {(lines ?? []).filter(Boolean).map((l, i) => (
            <span key={i} style={{ display: 'block', fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
              {l}
            </span>
          ))}
        </span>
        {status && (
          <span style={{ fontSize: 13, fontWeight: 400, whiteSpace: 'nowrap', color: warn ? t.warn : t.text3 }}>
            {status}
          </span>
        )}
      </>
    )
    const style: React.CSSProperties = {
      display: 'flex', alignItems: 'baseline', gap: 16, width: '100%', textAlign: 'left',
      background: 'none', border: 'none', padding: '12px 0', opacity: faded ? 0.55 : 1,
    }
    return onClick
      ? <button className="oc-row" onClick={onClick} style={{ ...style, cursor: 'pointer' }}>{body}</button>
      : <div style={style}>{body}</div>
  }

  const rangeLabel =
    timeFilter === 'day' ? dayFmt(selectedDate)
    : timeFilter === 'week' ? `${shortDayFmt(rangeStart)} to ${shortDayFmt(rangeEnd)}`
    : timeFilter === 'month' ? monthLabel
    : `${shortDayFmt(rangeStart)} to ${shortDayFmt(rangeEnd)}`

  const step = (dir: 1 | -1) => {
    if (timeFilter === 'day') setSelectedDate(addDaysTo(selectedDate, dir))
    else if (timeFilter === 'week') setSelectedDate(addDaysTo(selectedDate, 7 * dir))
    else changeMonth(dir)
  }

  return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow="Personal"
        title="My activity"
        subtitle={rangeLabel}
        onBack={onBack}
        divider={false}
      />
      <TabBar
        value={activeFilter}
        onChange={setActiveFilter}
        tabs={[
          { id: 'all', label: 'Everything' },
          { id: 'visits', label: 'Visits' },
          { id: 'activity', label: 'Orders' },
          { id: 'expense', label: 'Expenses' },
        ]}
      />

      {/* A column of records, not a table — capped so the lines stay a
          readable length on a wide screen. */}
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 820 }}>

        <Section label="Period">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ChipGroup
              value={timeFilter}
              onChange={setTimeFilter}
              options={[
                { id: 'day' as const, label: 'A day' },
                { id: 'week' as const, label: 'A week' },
                { id: 'month' as const, label: 'A month' },
                { id: 'custom' as const, label: 'Custom range' },
              ]}
            />
            {timeFilter === 'custom' ? (
              <div className="oc-wrap" style={{ alignItems: 'center', gap: 10, maxWidth: 460 }}>
                <DateInput type="date" value={customStart} onChange={setCustomStart} />
                <span style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>to</span>
                <DateInput type="date" value={customEnd} onChange={setCustomEnd} />
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <GhostButton onClick={() => step(-1)}>Earlier</GhostButton>
                <span style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>{rangeLabel}</span>
                <GhostButton onClick={() => step(1)}>Later</GhostButton>
              </div>
            )}
          </div>
        </Section>

        {sortedDays.length === 0 ? (
          <EmptyState
            title="Nothing in this period"
            body="Pick another day or a wider range. Visits, orders, payments and expenses all show up here."
          />
        ) : (
          <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
            {sortedDays.map(date => {
              const day = dayMap[date]
              const isToday = date === localDateStr()
              const isExpanded = expandedDays.has(date)

              const newPartyEntries = day.visitLog?.visits?.filter(v => v.isNew) ?? []
              const visitCount = day.revisitLogs.filter(rl => !rl.actions.every(act => {
                const a = act as any
                if (a.removed) return true
                return act.type === 'relationship_visit' || act.type === 'no_longer_active'
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

              const summary = [
                visitCount > 0 ? `${visitCount} visit${visitCount > 1 ? 's' : ''}` : null,
                actCount > 0 ? `${actCount} order${actCount > 1 ? 's' : ''} and payment${actCount > 1 ? 's' : ''}` : null,
                day.expenses.length > 0 ? `${money(expTotal)} in expenses` : null,
              ].filter(Boolean).join(' · ')

              return (
                <div key={date} style={{ borderTop: `0.5px solid ${t.border}`, padding: '16px 0' }}>
                  <button className="oc-action" onClick={() => toggleDay(date)}
                    style={{ width: '100%', display: 'flex', alignItems: 'baseline', gap: 16,
                             textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 15, fontWeight: 500, color: t.text }}>
                        {dayFmt(date)}
                        {isToday && (
                          <span style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginLeft: 8 }}>Today</span>
                        )}
                      </span>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                        {summary}
                      </span>
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 400, color: t.text3, whiteSpace: 'nowrap' }}>
                      {isExpanded ? 'Hide' : 'Show'}
                    </span>
                  </button>

                  {isExpanded && (
                    <div style={{ paddingLeft: 2 }}>

                      {/* ── VISITS ── */}
                      {showVisits && (
                        <>
                          {secHeader('Visits', vKey, visitCount)}
                          {secOpen(vKey) && day.revisitLogs.map(rl => {
                            const allInvisible = rl.actions.every(act => {
                              const a = act as any
                              if (a.removed) return true
                              return act.type === 'relationship_visit' || act.type === 'no_longer_active'
                            })
                            if (allInvisible) return null
                            return (
                              <div key={rl.id} style={{ marginBottom: 14 }}>
                                <div style={{ fontSize: 14, fontWeight: 500, color: t.text }}>
                                  {rl.partyName}
                                  <span style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginLeft: 8 }}>
                                    Revisit
                                  </span>
                                </div>

                                {rl.actions.map((act, ai) => {
                                  const a = act as StockUpdateAction

                                  // Removed actions stay visible as a record of what was undone.
                                  if ((a as any).removed) {
                                    if (act.type === 'relationship_visit' || act.type === 'no_longer_active') return null
                                    if (act.type === 'new_order') {
                                      const na = act as any
                                      return <Entry key={ai} faded
                                        title={`Order cancelled${na.removedByName ? ` by ${na.removedByName}` : ''}`}
                                        lines={[`Was ${na.quantity} packets, ${money(na.totalAmount || 0)}`]} />
                                    }
                                    if (act.type === 'payment_collection') {
                                      const pa = act as any
                                      return <Entry key={ai} faded
                                        title="Payment cancelled"
                                        lines={[`Was ${money(pa.amount || 0)}`]} />
                                    }
                                    return <Entry key={ai} faded
                                      title={`Stock update removed${a.removedByName ? ` by ${a.removedByName}` : ''}`}
                                      lines={[`Was ${a.balanceQty} packets, ${money(a.balanceValue || 0)}`]} />
                                  }

                                  if (act.type === 'stock_update') {
                                    const sa = act as StockUpdateAction
                                    return <Entry key={ai}
                                      title={sa.editedAt ? 'Stock update, corrected' : 'Stock update'}
                                      lines={[
                                        `Opened ${sa.openingQty} · bought ${sa.purchasedQty} · sold ${sa.soldQty} · left ${sa.balanceQty}`,
                                        (sa.balanceValue ?? 0) > 0 ? `${money(sa.balanceValue)} on the shelf` : null,
                                      ]} />
                                  }

                                  if (act.type === 'new_order') {
                                    const na = act as NewOrderAction
                                    const alloc = allocations.find(x => x.id === na.allocationId)
                                    const displayPkts = alloc?.packets ?? na.quantity
                                    const displayTotal = alloc ? alloc.totalAmount : (na.totalAmount || 0)
                                    const displayPayment = alloc?.paymentType ?? na.paymentType
                                    const canTap = !!onViewAllocation && !!na.allocationId
                                    return <Entry key={ai}
                                      title={`New order · ${na.productName}`}
                                      lines={[`${displayPkts} packets · ${money(displayTotal)} · ${displayPayment}`]}
                                      status={alloc ? ALLOC_LABEL[alloc.status] ?? alloc.status : undefined}
                                      warn={alloc ? NEEDS_ACTION.includes(alloc.status) : false}
                                      onClick={canTap ? () => onViewAllocation!(na.allocationId!) : undefined} />
                                  }

                                  if (act.type === 'payment_collection') {
                                    const pa = act as PaymentCollectionAction
                                    const livePay = pa.transactionId ? payments.find(p => p.id === pa.transactionId) : null
                                    const displayAmount = livePay?.amount ?? pa.amount ?? 0
                                    const displayStatus = livePay?.status ?? pa.status
                                    const canTap = !!onViewPayment && !!pa.transactionId
                                    const note = livePay?.notes ?? pa.notes
                                    return <Entry key={ai}
                                      title="Payment collected"
                                      lines={[money(displayAmount), note]}
                                      status={PAY_LABEL[displayStatus] ?? displayStatus}
                                      warn={displayStatus === 'pending_approval'}
                                      onClick={canTap ? () => onViewPayment!(rl.partyId, pa.transactionId!) : undefined} />
                                  }

                                  return null
                                })}

                                {rl.notes && (
                                  <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 6, lineHeight: 1.5 }}>
                                    {rl.notes}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </>
                      )}

                      {/* ── ORDERS AND PAYMENTS ── */}
                      {showActivity && (
                        <>
                          {secHeader('Orders and payments', aKey, actCount)}
                          {secOpen(aKey) && (
                            <>
                              {newPartyEntries.map((v, vi) => (
                                <Entry key={`np-${vi}`}
                                  title={v.partyName}
                                  lines={['Added as a new party during this visit']} />
                              ))}

                              {day.allocations.map(a => (
                                <Entry key={a.id}
                                  title={`Allocation · ${a.partyName}`}
                                  lines={[
                                    `${a.productName} · ${a.packets} packets · ${money(a.totalAmount)}`,
                                    a.paymentType === 'credit' ? 'On credit' : 'Cash',
                                  ]}
                                  status={ALLOC_LABEL[a.status] ?? a.status}
                                  warn={NEEDS_ACTION.includes(a.status)}
                                  onClick={onViewAllocation ? () => onViewAllocation(a.id!) : undefined} />
                              ))}

                              {day.payments.map(p => (
                                <Entry key={p.id}
                                  title={`Payment · ${p.partyName}`}
                                  lines={[`${money(p.amount)} · ${p.paymentMethod.replace('_', ' ')}`, p.notes]}
                                  status={PAY_LABEL[p.status] ?? p.status}
                                  warn={p.status === 'pending_approval'}
                                  onClick={onViewPayment ? () => onViewPayment(p.partyId, p.id!) : undefined} />
                              ))}
                            </>
                          )}
                        </>
                      )}

                      {/* ── EXPENSES ── */}
                      {showExpense && (
                        <>
                          {secHeader(`Expenses · ${money(expTotal)}`, eKey, day.expenses.length)}
                          {secOpen(eKey) && day.expenses.map(e => (
                            <Entry key={e.id}
                              title={e.type === 'allowance'
                                ? `${e.allowanceType} allowance`
                                : CAT_LABEL[e.category ?? ''] ?? e.category ?? 'Expense'}
                              lines={[e.notes]}
                              status={money(e.amount)} />
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
