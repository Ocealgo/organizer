import React, { useState, useEffect } from 'react'
import { collection, onSnapshot, query, where, updateDoc, doc, addDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { submitCheckIn } from '../../hooks/useFirebase'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import PartyManager from '../distributors/PartyManager'
import StockManager from '../stock/StockManager'
import ExpenseLogger from '../stock/ExpenseLogger'
import CreditBook from '../credit/CreditBook'
import AllocationManager from '../distributors/AllocationManager'
import VisitLogger from './VisitLogger'
import VisitHistoryScreen from './VisitHistoryScreen'
import LeaveHistory from './LeaveHistory'
import { CheckIn, Party, DailyVisitLog, LeaveRecord, LeaveReason, LEAVE_REASONS } from '../../types'
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
  const [checkIns, setCheckIns] = useState<CheckIn[]>([])
  const [parties, setParties] = useState<Party[]>([])
  const [todayVisitLog, setTodayVisitLog] = useState<DailyVisitLog | null>(null)
  const [todayLeave, setTodayLeave] = useState<LeaveRecord | null>(null)
  const [allLeaveRecords, setAllLeaveRecords] = useState<LeaveRecord[]>([])
  const [leaveDate, setLeaveDate] = useState(localDateStr())
  const [markingLeave, setMarkingLeave] = useState(false)
  const [pendingLeaveType, setPendingLeaveType] = useState<'full_day' | 'half_day' | null>(null)
  const [leaveReason, setLeaveReason] = useState<LeaveReason | ''>('')
  const [visitLogLoaded, setVisitLogLoaded] = useState(false)
  const { modal: leaveModal, showConfirm: showLeaveConfirm, showAlert: showLeaveAlert } = useConfirm()

  useEffect(() => {
    return onSnapshot(collection(db, 'parties'), snap => {
      setParties(snap.docs.map(d => ({ id: d.id, ...d.data() } as Party)))
    })
  }, [])

  useEffect(() => {
    if (!appUser) return
    const q = query(collection(db, 'visit_logs'), where('salesPersonId', '==', appUser.uid))
    return onSnapshot(q, snap => {
      const today = todayStr()
      const rec = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as DailyVisitLog))
        .find(l => l.date === today)
      setTodayVisitLog(rec ?? null)
      setVisitLogLoaded(true)
    })
  }, [appUser])

  useEffect(() => {
    if (!appUser) return
    const q = query(collection(db, 'checkins'), where('name', '==', name))
    return onSnapshot(q, snap => {
      const month = currentMonth()
      setCheckIns(snap.docs.map(d => ({ id: d.id, ...d.data() } as CheckIn))
        .filter(c => c.date.startsWith(month))
        .sort((a, b) => b.createdAt - a.createdAt))
    })
  }, [name, appUser])

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
      totalInterested: 0,
      totalNotInterested: 0,
      isNoEntry: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  }, [appUser, visitLogLoaded, todayVisitLog, todayLeave])

  const handleMarkLeave = async (type: 'full_day' | 'half_day', reason: LeaveReason) => {
    if (!appUser || markingLeave) return
    const confirmed = await showLeaveConfirm(
      `Request ${type === 'full_day' ? 'Full Day' : 'Half Day'} Leave?`,
      `Reason: ${reason} · ${leaveDate} · Admin will approve before it takes effect.`
    )
    if (!confirmed) return
    setMarkingLeave(true)
    setPendingLeaveType(null)
    setLeaveReason('')
    try {
      const leaveRef = await addDoc(collection(db, 'leave_records'), {
        uid: appUser.uid, name: appUser.name, role: appUser.role,
        date: leaveDate, leaveType: type, reason,
        markedAt: Date.now(), markedBy: appUser.uid, markedByName: appUser.name,
        status: 'pending_approval',
        auditLog: [{ action: 'leave_requested', by: appUser.uid, byName: appUser.name, at: Date.now() }],
      })
      await addDoc(collection(db, 'alerts'), {
        type: 'leave_requested',
        message: `${appUser.name} requested ${type === 'full_day' ? 'Full Day' : 'Half Day'} leave · ${leaveDate} · ${reason}`,
        relatedId: leaveRef.id, read: false, createdAt: Date.now(),
        toRole: 'admin_group',
      })
    } catch (e) {
      console.error('Leave request failed:', e)
      await showLeaveAlert('Failed to send request', 'Check your connection and try again.')
    } finally { setMarkingLeave(false) }
  }

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
  if (screen === 'visits')      return <VisitLogger onBack={() => setScreen('home')} />
  if (screen === 'parties')     return <PartyManager onBack={() => setScreen('home')} />
  if (screen === 'stock')       return <StockManager onBack={() => setScreen('home')} />
  if (screen === 'expenses')    return <ExpenseLogger onBack={() => setScreen('home')} />
  if (screen === 'credits')     return <CreditBook onBack={() => setScreen('home')} />
  if (screen === 'allocations') return <AllocationManager onBack={() => setScreen('home')} parties={parties} isAdmin={false} />
  if (screen === 'history')     return <VisitHistoryScreen onBack={() => setScreen('home')} />
  if (screen === 'leaves')      return <LeaveHistory leaveRecords={allLeaveRecords} onBack={() => setScreen('home')} />

  // Online Sales — disabled
  if (isOnline) return (
    <div style={{ minHeight: '100vh', background: t.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <div style={{ background: 'rgba(217,119,6,0.2)', color: '#d97706', fontSize: 12, fontWeight: 800, padding: '4px 12px', borderRadius: 99, marginBottom: 16 }}>COMING SOON</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: t.text, marginBottom: 12, textAlign: 'center' }}>Online Sales Dashboard</div>
      <div style={{ color: t.text2, fontSize: 14, lineHeight: 1.8, textAlign: 'center', maxWidth: 280 }}>
        E-commerce orders, digital campaigns and online sales will be available soon.
      </div>
    </div>
  )

  // Count today's visits
  const todayCheckIn = checkIns.find(c => c.date === todayStr())
  const initials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase()
  const isOnFullLeave = !!(todayLeave && todayLeave.leaveType === 'full_day' && todayLeave.status === 'active')

  const menuItems = [
    {
      label: "Today's Visits",
      sub: isOnFullLeave ? 'Disabled — you are on full day leave' : 'Log shop visits & outcomes',
      action: isOnFullLeave ? undefined : () => setScreen('visits'),
      primary: true,
      disabled: isOnFullLeave,
    },
    { label: 'Network', sub: 'Distributors & retailers', action: () => setScreen('parties'), primary: false, disabled: false },
    { label: 'Allocations', sub: 'View & create stock requests', action: () => setScreen('allocations'), primary: false, disabled: false },
    { label: 'Visit History', sub: 'Past logs by day & month', action: () => setScreen('history'), primary: false, disabled: false },
    { label: 'My Leaves', sub: allLeaveRecords.filter(l => l.status === 'pending_approval').length > 0 ? `${allLeaveRecords.filter(l => l.status === 'pending_approval').length} pending approval` : 'View & manage leave requests', action: () => setScreen('leaves'), primary: false, disabled: false },
    { label: 'Stock', sub: 'Available inventory', action: () => setScreen('stock'), primary: false, disabled: false },
    { label: 'Credit Book', sub: 'Outstanding & settlements', action: () => setScreen('credits'), primary: false, disabled: false },
    { label: 'Expenses', sub: 'Travel, food, misc', action: () => setScreen('expenses'), primary: false, disabled: false },
  ]

  return (
    <div style={{ minHeight: '100vh', background: t.bg }}>
      {/* Header */}
      <div style={{ background: '#000000', padding: '28px 24px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 54, height: 54, background: 'rgba(255,255,255,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 22, color: '#fff', border: '2px solid rgba(255,255,255,0.15)' }}>{initials}</div>
          <div>
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 }}>Offline Sales</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: '#ffffff' }}>{name}</div>
          </div>
        </div>

        {/* Today summary */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          {[
            { label: 'Visits Today', val: isOnFullLeave ? 'Leave' : (todayVisitLog ? todayVisitLog.totalVisited : '—'), color: '#ffffff' },
            { label: 'Interested', val: isOnFullLeave ? '—' : (todayVisitLog ? todayVisitLog.totalInterested : '—'), color: '#22c55e' },
            { label: 'This Month', val: `${checkIns.length} logs`, color: 'rgba(255,255,255,0.7)' },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, background: 'rgba(255,255,255,0.07)', borderRadius: 12, padding: '12px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Leave status banner — top, only when a leave record exists */}
      {todayLeave && (
        <div style={{ padding: '12px 20px 0' }}>
          {todayLeave.status === 'pending_approval' && (
            <div style={{ background: 'rgba(107,114,128,0.1)', border: '1.5px solid rgba(107,114,128,0.2)', borderRadius: 16, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: t.text }}>Leave Request Pending</div>
                <div style={{ fontSize: 13, color: t.text2, marginTop: 3 }}>
                  {todayLeave.leaveType === 'half_day' ? 'Half Day' : 'Full Day'} · {todayLeave.reason} · Awaiting admin approval
                </div>
              </div>
            </div>
          )}
          {(todayLeave.status === 'active' || todayLeave.status === 'unmark_requested') && (
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1.5px solid rgba(245,158,11,0.2)', borderRadius: 16, padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: todayLeave.status === 'unmark_requested' ? 8 : 0 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 16, color: t.text }}>
                    {todayLeave.leaveType === 'half_day' ? 'Half Day Leave' : 'Full Day Leave'}
                    {todayLeave.reason && <span style={{ fontWeight: 600, fontSize: 13, marginLeft: 6, opacity: 0.85 }}>· {todayLeave.reason}</span>}
                  </div>
                  <div style={{ fontSize: 13, color: t.text2, marginTop: 3 }}>
                    Approved · {new Date(todayLeave.markedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                {todayLeave.status === 'active' && (
                  <button onClick={handleUnmarkLeave}
                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', borderRadius: 10, padding: '7px 12px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                    Request Unmark
                  </button>
                )}
              </div>
              {todayLeave.status === 'unmark_requested' && (
                <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '6px 10px', fontSize: 13, color: '#f59e0b', fontWeight: 700 }}>
                  Unmark request sent — waiting for admin approval
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Menu */}
      <div style={{ padding: '16px 20px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {menuItems.map((item, i) => (
          <button key={i} onClick={item.disabled ? undefined : item.action}
            disabled={item.disabled}
            style={{
              background: item.primary
                ? (item.disabled ? t.bg3 : t.primary)
                : t.card,
              color: item.primary
                ? (item.disabled ? t.text3 : t.primaryText)
                : t.text,
              border: item.primary
                ? (item.disabled ? `1.5px dashed ${t.border2}` : 'none')
                : `1px solid ${t.border}`,
              borderRadius: 16,
              padding: '18px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              textAlign: 'left',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              opacity: item.disabled ? 0.5 : 1,
            }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{item.label}</div>
              <div style={{ fontSize: 13, color: item.primary ? (item.disabled ? t.text3 : 'rgba(0,0,0,0.5)') : t.text2, marginTop: 3 }}>{item.sub}</div>
            </div>
            {!item.disabled && <span style={{ fontSize: 22, opacity: 0.35 }}>›</span>}
          </button>
        ))}
      </div>

      {/* Leave request — bottom, low prominence */}
      {!todayLeave && (
        <div style={{ padding: '20px 20px 40px' }}>
          <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 16 }}>
            <div style={{ fontSize: 13, color: t.text3, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, textAlign: 'center' }}>Not working today?</div>

            {!pendingLeaveType ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setPendingLeaveType('full_day')} disabled={markingLeave}
                  style={{ flex: 1, background: t.bg3, border: `1px solid ${t.border2}`, color: t.text2, borderRadius: 12, padding: '11px', fontSize: 14, fontWeight: 700 }}>
                  Full Day Leave
                </button>
                <button onClick={() => setPendingLeaveType('half_day')} disabled={markingLeave}
                  style={{ flex: 1, background: t.bg3, border: `1px solid ${t.border2}`, color: t.text2, borderRadius: 12, padding: '11px', fontSize: 14, fontWeight: 700 }}>
                  Half Day Leave
                </button>
              </div>
            ) : (
              <div style={{ background: t.card, borderRadius: 14, padding: 14, border: `1px solid ${t.border2}` }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginBottom: 10 }}>
                  {pendingLeaveType === 'full_day' ? 'Full Day' : 'Half Day'} Leave Request · <span style={{ color: t.text3, fontWeight: 400 }}>Select a reason</span>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: t.text3, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Leave Date</div>
                  <input type="date" value={leaveDate} onChange={e => setLeaveDate(e.target.value)}
                    style={{ width: '100%', background: t.bg3, border: `1px solid ${t.border2}`, borderRadius: 10, padding: '9px 12px', color: t.text, fontSize: 14, outline: 'none', boxSizing: 'border-box', colorScheme: theme === 'dark' ? 'dark' : 'light' }} />
                  {allLeaveRecords.some(l => l.date === leaveDate && l.status !== 'removed' && l.status !== 'rejected') && (
                    <div style={{ fontSize: 12, color: '#ef4444', marginTop: 5, fontWeight: 600 }}>
                      Leave already submitted for this date
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {LEAVE_REASONS.map(r => (
                    <button key={r} onClick={() => setLeaveReason(r)}
                      style={{ background: leaveReason === r ? t.bg3 : 'transparent', border: `1px solid ${leaveReason === r ? t.primary : t.border2}`, color: leaveReason === r ? t.text : t.text2, borderRadius: 20, padding: '7px 15px', fontSize: 13, fontWeight: leaveReason === r ? 700 : 400, outline: leaveReason === r ? `2px solid ${t.primary}` : 'none', outlineOffset: -1 }}>
                      {r}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { setPendingLeaveType(null); setLeaveReason('') }}
                    style={{ flex: 1, background: t.bg3, border: `1px solid ${t.border2}`, color: t.text2, borderRadius: 10, padding: '11px', fontSize: 14, fontWeight: 700 }}>
                    Cancel
                  </button>
                  <button onClick={() => leaveReason && handleMarkLeave(pendingLeaveType, leaveReason as LeaveReason)}
                    disabled={!leaveReason || markingLeave || allLeaveRecords.some(l => l.date === leaveDate && l.status !== 'removed' && l.status !== 'rejected')}
                    style={{ flex: 2, background: leaveReason ? t.primary : t.bg3, border: `1px solid ${leaveReason ? t.primary : t.border2}`, color: leaveReason ? t.primaryText : t.text3, borderRadius: 10, padding: '11px', fontSize: 14, fontWeight: 700, opacity: (!leaveReason || markingLeave || allLeaveRecords.some(l => l.date === leaveDate && l.status !== 'removed' && l.status !== 'rejected')) ? 0.5 : 1 }}>
                    {markingLeave ? 'Sending...' : 'Send Request'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {leaveModal}
    </div>
  )
}
