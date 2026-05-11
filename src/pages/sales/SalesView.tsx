import React, { useState, useEffect } from 'react'
import { collection, onSnapshot, query, where, updateDoc, doc, addDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../firebase'

import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import PartyManager from '../distributors/PartyManager'
import StockManager from '../stock/StockManager'
import ExpenseLogger from '../stock/ExpenseLogger'
import CreditBook from '../credit/CreditBook'
import AllocationManager from '../distributors/AllocationManager'
import VisitLogger from './VisitLogger'
import ActivityScreen from './ActivityScreen'
import LeaveHistory from './LeaveHistory'
import { Party, DailyVisitLog, LeaveRecord, Holiday } from '../../types'
import { useConfirm } from '../../hooks/useConfirm'
import { localDateStr, localMonthStr } from '../../utils/date'

interface Props { name: string }

const todayStr = () => localDateStr()
const currentMonth = () => localMonthStr()
const isLocked = (createdAt: number) => Date.now() - createdAt > 24 * 60 * 60 * 1000

type SubScreen = 'home' | 'visits' | 'parties' | 'stock' | 'expenses' | 'credits' | 'allocations' | 'history' | 'leaves'

export default function SalesView({ name }: Props) {
  const { appUser } = useAuth()
  const { t, theme } = useTheme()
  const isOnline = appUser?.role === 'online_sales'
  const [screen, setScreen] = useState<SubScreen>('home')
  const [visitInitialDate, setVisitInitialDate] = useState<string | undefined>()
  const [parties, setParties] = useState<Party[]>([])
  const [todayVisitLog, setTodayVisitLog] = useState<DailyVisitLog | null>(null)
  const [todayLeave, setTodayLeave] = useState<LeaveRecord | null>(null)
  const [allLeaveRecords, setAllLeaveRecords] = useState<LeaveRecord[]>([])
  const [visitLogLoaded, setVisitLogLoaded] = useState(false)
  const [monthlyVisitLogCount, setMonthlyVisitLogCount] = useState(0)
  const [monthlyRevisitLogCount, setMonthlyRevisitLogCount] = useState(0)
  const [revisitLogsToday, setRevisitLogsToday] = useState(0)
  const [ordersToday, setOrdersToday] = useState(0)
  const [highlightAllocationId, setHighlightAllocationId] = useState<string | undefined>()
  const [allocSalesRepOnly, setAllocSalesRepOnly] = useState(false)
  const [allocReturnScreen, setAllocReturnScreen] = useState<SubScreen>('home')
  const [deepLinkPaymentPartyId, setDeepLinkPaymentPartyId] = useState<string | undefined>()
  const [deepLinkPaymentId, setDeepLinkPaymentId] = useState<string | undefined>()
  const [creditReturnScreen, setCreditReturnScreen] = useState<SubScreen>('home')
  const [expenseDefaultToDay, setExpenseDefaultToDay] = useState(false)
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const { modal: leaveModal, showConfirm: showLeaveConfirm } = useConfirm()

  useEffect(() => {
    return onSnapshot(collection(db, 'parties'), snap => {
      setParties(snap.docs.map(d => ({ id: d.id, ...d.data() } as Party)))
    })
  }, [])

  useEffect(() => {
    if (!appUser) return

    const ownQuery = query(collection(db, 'visit_logs'), where('salesPersonId', '==', appUser.uid))

    const unsubOwn = onSnapshot(ownQuery, snap => {
      const logs = snap.docs.map(d => ({ id: d.id, ...d.data() } as DailyVisitLog))
      const today = todayStr()
      const month = currentMonth()
      const record = logs.find(l => l.date === today) || null
      setTodayVisitLog(record)
      setMonthlyVisitLogCount(logs.filter(l => l.date.startsWith(month) && !l.isNoEntry).length)
      setVisitLogLoaded(true)
    })

    return () => {
      unsubOwn();
    }
  }, [appUser])

  useEffect(() => {
    if (!appUser) return
    const q = query(collection(db, 'revisit_logs'), where('salesPersonId', '==', appUser.uid))
    return onSnapshot(q, snap => {
      const month = currentMonth()
      const today = todayStr()
      const docs = snap.docs.map(d => d.data())
      setMonthlyRevisitLogCount(docs.filter(d => (d.date as string).startsWith(month)).length)
      setRevisitLogsToday(docs.filter(d => d.date === today).length)
      setOrdersToday(docs.filter(d => d.date === today && (d.actions as any[])?.some((a: any) => a.type === 'new_order')).length)
    })
  }, [appUser])

  useEffect(() => {
    return onSnapshot(collection(db, 'holidays'), snap => {
      setHolidays(snap.docs.map(d => ({ id: d.id, ...d.data() } as Holiday)))
    })
  }, [])

  useEffect(() => {
    if (!appUser) return
    const q = query(collection(db, 'leave_records'), where('uid', '==', appUser.uid))
    return onSnapshot(q, snap => {
      const records = snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRecord))
      setAllLeaveRecords(records)
      const today = todayStr()
      const rec = records.find(l => l.date === today && l.status !== 'removed' && l.status !== 'rejected')
      setTodayLeave(rec ?? null)
    })
  }, [appUser])

  // Auto-log "no entry" after noon if no visit log for today (skip if on full day leave)
  const noEntryCreated = React.useRef(false)
  useEffect(() => {
    if (!appUser || !visitLogLoaded || todayVisitLog !== null) return
    if (noEntryCreated.current) return
    if (todayLeave?.leaveType === 'full_day' && (todayLeave.status === 'active' || todayLeave.status === 'pending_approval')) return
    if (holidays.some(h => h.date === todayStr())) return
    const now = new Date()
    if (now.getHours() < 12) return
    noEntryCreated.current = true
    addDoc(collection(db, 'visit_logs'), {
      salesPersonId: appUser.uid,
      salesPersonName: appUser.name,
      date: todayStr(),
      visits: [],
      endOfDayNote: '',
      totalVisited: 0,
      isNoEntry: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  }, [appUser, visitLogLoaded, todayVisitLog, todayLeave])

  const handleUnmarkLeave = async () => {
    if (!todayLeave?.id) return
    const confirmed = await showLeaveConfirm(
      'Request Unmark Leave?',
      'Admin will need to approve this. Your leave stays active until then.'
    )
    if (!confirmed) return
    await updateDoc(doc(db, 'leave_records', todayLeave.id), {
      status: 'unmark_requested',
      unmarkRequestedAt: Date.now(),
      auditLog: [...((todayLeave as any).auditLog || []), {
        action: 'unmark_requested', by: appUser!.uid, byName: appUser!.name, at: Date.now()
      }],
    })
  }

  // Route to sub-screens — hooks are above so this is safe
  if (screen === 'visits')      return <VisitLogger onBack={() => { setVisitInitialDate(undefined); setScreen('home') }} initialDate={visitInitialDate} onViewAllocation={(id) => { setHighlightAllocationId(id); setScreen('allocations') }} onViewPayment={(partyId, paymentId) => { setDeepLinkPaymentPartyId(partyId); setDeepLinkPaymentId(paymentId); setCreditReturnScreen('visits'); setScreen('credits') }} />
  if (screen === 'parties')     return <PartyManager onBack={() => setScreen('home')} />
  if (screen === 'stock')       return <StockManager onBack={() => setScreen('home')} />
  if (screen === 'expenses')    return <ExpenseLogger onBack={() => setScreen('home')} onLogVisit={date => { setVisitInitialDate(date); setScreen('visits') }} defaultToDay={expenseDefaultToDay} />
  if (screen === 'credits')     return <CreditBook onBack={() => { const ret = creditReturnScreen; setDeepLinkPaymentPartyId(undefined); setDeepLinkPaymentId(undefined); setCreditReturnScreen('home'); setScreen(ret) }} initialPartyId={deepLinkPaymentPartyId} focusPaymentId={deepLinkPaymentId} salesRepOnly={!!deepLinkPaymentId} />
  if (screen === 'allocations') return <AllocationManager onBack={() => { const ret = allocReturnScreen; setHighlightAllocationId(undefined); setAllocSalesRepOnly(false); setAllocReturnScreen('home'); setScreen(ret) }} parties={parties} isAdmin={false} highlightId={highlightAllocationId} salesRepOnly={allocSalesRepOnly} />
  if (screen === 'history')     return <ActivityScreen onBack={() => setScreen('home')} onViewAllocation={(allocId) => { setHighlightAllocationId(allocId); setAllocSalesRepOnly(true); setAllocReturnScreen('history'); setScreen('allocations') }} onViewPayment={(partyId, paymentId) => { setDeepLinkPaymentPartyId(partyId); setDeepLinkPaymentId(paymentId); setCreditReturnScreen('history'); setScreen('credits') }} />
  if (screen === 'leaves')      return <LeaveHistory leaveRecords={allLeaveRecords} onBack={() => setScreen('home')} />

  // Online Sales — disabled
  if (isOnline) return (
    <div style={{ minHeight: '100vh', background: t.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <div style={{ fontSize: 64, marginBottom: 24 }}>🌐</div>
      <div style={{ background: 'rgba(217,119,6,0.2)', color: '#d97706', fontSize: 12, fontWeight: 800, padding: '4px 12px', borderRadius: 99, marginBottom: 16 }}>COMING SOON</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: t.text, marginBottom: 12, textAlign: 'center' }}>Online Sales Dashboard</div>
      <div style={{ color: t.text2, fontSize: 14, lineHeight: 1.8, textAlign: 'center', maxWidth: 280 }}>
        E-commerce orders, digital campaigns and online sales will be available soon.
      </div>
    </div>
  )

  const initials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase()
  const isTodayHoliday = holidays.some(h => h.date === todayStr())
  const isOnFullLeave = isTodayHoliday || !!(todayLeave && todayLeave.leaveType === 'full_day' && todayLeave.status === 'active')
  const pendingLeavesCount = allLeaveRecords.filter(l => l.status === 'pending_approval').length

  const renderCard = (item: { emoji: string; label: string; sub: string; action: () => void; badge?: string }) => (
    <button key={item.label} onClick={item.action}
      style={{ background: theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.7)', color: theme === 'dark' ? '#fff' : '#0d3d2e', border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)'}`, borderRadius: 18, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', cursor: 'pointer', marginBottom: 10, width: '100%' }}>
      <span style={{ fontSize: 26 }}>{item.emoji}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{item.label}</div>
        <div style={{ fontSize: 13, color: theme === 'dark' ? '#a7f3d0' : '#475569', marginTop: 3 }}>{item.sub}</div>
      </div>
      {item.badge
        ? <span style={{ fontSize: 10, fontWeight: 700, color: theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)', background: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 99, padding: '3px 8px', flexShrink: 0 }}>{item.badge}</span>
        : <span style={{ fontSize: 22, opacity: 0.4 }}>›</span>
      }
    </button>
  )

  return (
    <div style={{ minHeight: '100vh', background: theme === 'dark' ? 'linear-gradient(145deg,#0d3d2e 0%,#1a5c42 55%,#2d7a56 100%)' : 'linear-gradient(145deg,#ecfdf5 0%,#d1fae5 100%)' }}>
      {/* Header */}
      <div style={{ padding: '28px 24px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 54, height: 54, background: 'rgba(255,255,255,0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 22, color: '#fff', border: '2px solid rgba(255,255,255,0.3)' }}>{initials}</div>
          <div>
            <div style={{ color: theme === 'dark' ? '#6ee7b7' : '#1a5c42', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 }}>🏪 Offline Sales</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: theme === 'dark' ? '#fff' : '#0d3d2e' }}>{name}</div>
          </div>
        </div>

        {/* Today summary */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          {[
            { label: 'Visits Today', val: isOnFullLeave ? '🏖️' : (todayVisitLog ? todayVisitLog.totalVisited : '—'), color: theme === 'dark' ? '#fff' : '#0d3d2e' },
            { label: 'Orders Today', val: isOnFullLeave ? '—' : ordersToday, color: theme === 'dark' ? '#86efac' : '#16a34a' },
            { label: 'Logs Today', val: isOnFullLeave ? '—' : revisitLogsToday, color: theme === 'dark' ? '#bae6fd' : '#0891b2' },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, background: theme === 'dark' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.5)', borderRadius: 12, padding: '12px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 11, color: theme === 'dark' ? 'rgba(255,255,255,0.6)' : '#475569', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Leave status banner — top, only when a leave record exists */}
      {todayLeave && (
        <div style={{ padding: '0 20px 12px' }}>
          {todayLeave.status === 'pending_approval' && (
            <div style={{ background: 'rgba(100,116,139,0.1)', border: '1.5px solid rgba(100,116,139,0.25)', borderRadius: 16, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>⏳</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: theme === 'dark' ? '#fff' : t.text }}>Leave Request Pending</div>
                <div style={{ fontSize: 13, color: theme === 'dark' ? 'rgba(255,255,255,0.75)' : '#4b5563', marginTop: 3 }}>
                  {todayLeave.leaveType === 'half_day' ? 'Half Day' : 'Full Day'} · {todayLeave.reason} · Awaiting admin approval
                </div>
              </div>
            </div>
          )}
          {(todayLeave.status === 'active' || todayLeave.status === 'unmark_requested') && (
            <div style={{ background: todayLeave.leaveType === 'half_day' ? 'rgba(59,130,246,0.12)' : 'rgba(245,158,11,0.15)', border: `1.5px solid ${todayLeave.leaveType === 'half_day' ? 'rgba(59,130,246,0.35)' : 'rgba(245,158,11,0.35)'}`, borderRadius: 16, padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: todayLeave.status === 'unmark_requested' ? 8 : 0 }}>
                <span style={{ fontSize: 26 }}>🏖️</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 16, color: theme === 'dark' ? '#fff' : '#92400e' }}>
                    {todayLeave.leaveType === 'half_day' ? 'Half Day Leave' : 'Full Day Leave'}
                    {todayLeave.reason && <span style={{ fontWeight: 600, fontSize: 13, marginLeft: 6, opacity: 0.85 }}>· {todayLeave.reason}</span>}
                  </div>
                  <div style={{ fontSize: 13, color: theme === 'dark' ? 'rgba(255,255,255,0.75)' : '#b45309', marginTop: 3 }}>
                    Approved · {new Date(todayLeave.markedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                {todayLeave.status === 'active' && (
                  <button onClick={handleUnmarkLeave}
                    style={{ background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.25)', color: '#dc2626', borderRadius: 10, padding: '7px 12px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                    Request Unmark
                  </button>
                )}
              </div>
              {todayLeave.status === 'unmark_requested' && (
                <div style={{ background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 8, padding: '6px 10px', fontSize: 13, color: theme === 'dark' ? '#fff' : '#d97706', fontWeight: 700 }}>
                  Unmark request sent — waiting for admin approval
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Menu — sectioned */}
      <div style={{ padding: '0 20px 40px' }}>

        {/* ── TODAY ── */}
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)', marginBottom: 10, marginTop: 4 }}>Today</div>

        <button onClick={isOnFullLeave ? undefined : () => setScreen('visits')} disabled={isOnFullLeave}
          style={{ background: isOnFullLeave ? (theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') : '#fff', color: isOnFullLeave ? (theme === 'dark' ? 'rgba(255,255,255,0.3)' : '#9ca3af') : '#0d3d2e', border: isOnFullLeave ? `1.5px dashed ${theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}` : 'none', borderRadius: 18, padding: '20px', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', boxShadow: isOnFullLeave ? 'none' : '0 8px 32px rgba(0,0,0,0.2)', cursor: isOnFullLeave ? 'not-allowed' : 'pointer', opacity: isOnFullLeave ? 0.6 : 1, marginBottom: 10, width: '100%' }}>
          <span style={{ fontSize: 32 }}>🗺️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Log a Visit</div>
            <div style={{ fontSize: 13, color: isOnFullLeave ? (theme === 'dark' ? 'rgba(255,255,255,0.3)' : '#ef4444') : '#6b7280', marginTop: 3 }}>
              {isTodayHoliday ? 'Disabled — public holiday' : isOnFullLeave ? 'Disabled — you are on full day leave' : 'Log shop visits & outcomes'}
            </div>
          </div>
          {!isOnFullLeave && <span style={{ fontSize: 24, opacity: 0.4 }}>›</span>}
        </button>

        {renderCard({ emoji: '💸', label: 'Add Expense', sub: 'Log travel, food & misc', action: () => { setExpenseDefaultToDay(true); setScreen('expenses') } })}

        {/* ── SALES ── */}
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)', marginBottom: 10, marginTop: 8 }}>Trade</div>

        {renderCard({ emoji: '🤝', label: 'Network', sub: 'Distributors & retailers', action: () => setScreen('parties') })}
        {renderCard({ emoji: '📦', label: 'Allocations', sub: 'View & create stock requests', action: () => setScreen('allocations') })}
        {renderCard({ emoji: '📊', label: 'Stock', sub: 'Available inventory', action: () => setScreen('stock'), badge: '👁 View only' })}
        {renderCard({ emoji: '💜', label: 'Credit Book', sub: 'Outstanding & settlements', action: () => setScreen('credits'), badge: '👁 View only' })}

        {/* ── PERSONAL ── */}
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)', marginBottom: 10, marginTop: 8 }}>Personal</div>

        {renderCard({ emoji: '📅', label: 'My Activity', sub: 'Visit logs & action history', action: () => setScreen('history') })}
        {renderCard({ emoji: '🏖️', label: 'My Leaves', sub: pendingLeavesCount > 0 ? `${pendingLeavesCount} pending approval` : 'Apply & manage leaves', action: () => setScreen('leaves') })}
        {renderCard({ emoji: '🧾', label: 'Expense Reports', sub: 'Weekly submissions & history', action: () => { setExpenseDefaultToDay(false); setScreen('expenses') } })}

      </div>
      {leaveModal}
    </div>
  )
}
