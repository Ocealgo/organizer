import React, { useState, useEffect } from 'react'
import { collection, query, where, updateDoc, doc, addDoc } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
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
import { Eyebrow, StatGrid, StatCard, RowGroup, ListRow, EmptyState, GhostButton } from '../../components/ui'
import { useDutySession, closeAbandonedSessions } from '../../hooks/useDutySession'
import { REMINDER_HOUR, AUTO_CLOSE_HOUR } from '../../device/notify'
import DutyScreen from './DutyScreen'
import OutletVisitScreen from './OutletVisitScreen'

interface Props { name: string }

const todayStr = () => localDateStr()
const currentMonth = () => localMonthStr()

type SubScreen = 'home' | 'duty' | 'outlet' | 'visits' | 'parties' | 'stock' | 'expenses' | 'credits' | 'allocations' | 'history' | 'leaves'

export default function SalesView({ name }: Props) {
  const { appUser } = useAuth()
  const { t } = useTheme()
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
  // Spec §2.3 — the outlet list stays locked until the day is punched in.
  const { session: dutySession, isOnDuty, isDayClosed } = useDutySession(appUser?.uid)

  useEffect(() => {
    return onSnapshot(collection(db, 'parties'), snap => {
      setParties(snap.docs.map(d => ({ id: d.id, ...d.data() } as Party)))
    })
  }, [])

  // There is no server to run this at 23:00, so the officer's own device — the
  // only party the rules let close their session — sweeps up on app open. A day
  // forgotten last night is tidied this morning.
  useEffect(() => {
    if (!appUser) return
    void closeAbandonedSessions(appUser.uid, appUser.name)
  }, [appUser?.uid])

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

  // The in-app half of the end-of-day nudge. The scheduled notification reaches
  // a pocketed phone; this reaches someone who has the app open and has simply
  // not thought about it. Stops ticking the moment it is true.
  const [pastReminderHour, setPastReminderHour] = useState(() => new Date().getHours() >= REMINDER_HOUR)
  useEffect(() => {
    if (pastReminderHour) return
    const id = setInterval(() => {
      if (new Date().getHours() >= REMINDER_HOUR) setPastReminderHour(true)
    }, 60_000)
    return () => clearInterval(id)
  }, [pastReminderHour])

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
      'Request to unmark this leave?',
      'An admin has to approve it. Your leave stays active until then.'
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
  if (screen === 'duty' && appUser) return <DutyScreen appUser={appUser} session={dutySession} onBack={() => setScreen('home')} />
  if (screen === 'outlet' && appUser && dutySession) return <OutletVisitScreen appUser={appUser} session={dutySession} onBack={() => setScreen('home')} />
  if (screen === 'visits')      return <VisitLogger onBack={() => { setVisitInitialDate(undefined); setScreen('home') }} initialDate={visitInitialDate} onViewAllocation={(id) => { setHighlightAllocationId(id); setScreen('allocations') }} onViewPayment={(partyId, paymentId) => { setDeepLinkPaymentPartyId(partyId); setDeepLinkPaymentId(paymentId); setCreditReturnScreen('visits'); setScreen('credits') }} />
  if (screen === 'parties')     return <PartyManager onBack={() => setScreen('home')} />
  if (screen === 'stock')       return <StockManager onBack={() => setScreen('home')} />
  if (screen === 'expenses')    return <ExpenseLogger onBack={() => setScreen('home')} onLogVisit={date => { setVisitInitialDate(date); setScreen('visits') }} defaultToDay={expenseDefaultToDay} />
  if (screen === 'credits')     return <CreditBook onBack={() => { const ret = creditReturnScreen; setDeepLinkPaymentPartyId(undefined); setDeepLinkPaymentId(undefined); setCreditReturnScreen('home'); setScreen(ret) }} initialPartyId={deepLinkPaymentPartyId} focusPaymentId={deepLinkPaymentId} salesRepOnly={!!deepLinkPaymentId} />
  if (screen === 'allocations') return <AllocationManager onBack={() => { const ret = allocReturnScreen; setHighlightAllocationId(undefined); setAllocSalesRepOnly(false); setAllocReturnScreen('home'); setScreen(ret) }} parties={parties} isAdmin={false} highlightId={highlightAllocationId} salesRepOnly={allocSalesRepOnly} />
  if (screen === 'history')     return <ActivityScreen onBack={() => setScreen('home')} onViewAllocation={(allocId) => { setHighlightAllocationId(allocId); setAllocSalesRepOnly(true); setAllocReturnScreen('history'); setScreen('allocations') }} onViewPayment={(partyId, paymentId) => { setDeepLinkPaymentPartyId(partyId); setDeepLinkPaymentId(paymentId); setCreditReturnScreen('history'); setScreen('credits') }} />
  if (screen === 'leaves')      return <LeaveHistory leaveRecords={allLeaveRecords} onBack={() => setScreen('home')} />

  // Online Sales — not built yet
  if (isOnline) return (
    <div style={{ minHeight: '100vh', background: t.bg, padding: '30px 20px' }}>
      <EmptyState
        title="Online sales"
        body="E-commerce orders and digital campaigns will live here. Nothing to do in this space yet."
      />
    </div>
  )

  const isTodayHoliday = holidays.some(h => h.date === todayStr())
  const isOnFullLeave = isTodayHoliday || !!(todayLeave && todayLeave.leaveType === 'full_day' && todayLeave.status === 'active')
  const pendingLeavesCount = allLeaveRecords.filter(l => l.status === 'pending_approval').length
  const visitsToday = todayVisitLog?.totalVisited ?? 0

  // One sentence saying what today looks like from the rep's side.
  const attention = isTodayHoliday
    ? 'Today is a public holiday. Nothing is expected from you.'
    : isOnFullLeave
      ? 'You are on full day leave today. Visit logging is paused.'
      : isDayClosed && dutySession?.autoClosed
        ? `Your day was closed for you because it was left open — ${visitsToday} ${visitsToday === 1 ? 'visit' : 'visits'} logged, and no distance could be claimed.`
      : isDayClosed
        ? `Your day is finished — ${visitsToday} ${visitsToday === 1 ? 'visit' : 'visits'} logged and ${dutySession?.claimedDistanceKm ?? 0} km travelled.`
        : !isOnDuty
          ? 'You have not started your day yet. Punch in to unlock your outlet list.'
          : visitsToday === 0
            ? 'Nothing logged yet today. Start with your first shop visit.'
            : `${visitsToday} ${visitsToday === 1 ? 'visit' : 'visits'} logged today${ordersToday > 0 ? `, and ${ordersToday} ${ordersToday === 1 ? 'order' : 'orders'} placed` : ''}.`

  return (
    <div style={{ minHeight: '100vh', background: t.bg }}>
      {/* Attention line */}
      <div style={{ padding: '30px 20px 24px', maxWidth: 720 }}>
        <div style={{ marginBottom: 10 }}>
          <Eyebrow>{name} · Offline sales</Eyebrow>
        </div>
        <p style={{ fontSize: 21, lineHeight: 1.5, fontWeight: 400, color: t.text, margin: 0 }}>
          {attention}
        </p>
      </div>

      <div style={{ padding: '0 20px 56px', display: 'flex', flexDirection: 'column', gap: 30 }}>

        {/* Still on duty late in the day. A day left open claims no distance,
            so this is worth interrupting for. */}
        {isOnDuty && pastReminderHour && (
          <div style={{ background: t.tint, borderRadius: 6, padding: '14px 16px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start',
                          justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: t.warn }}>
                  Your day is still open
                </div>
                <div style={{ fontSize: 13, color: t.text3, marginTop: 3, lineHeight: 1.5 }}>
                  Record your closing reading before you finish. A day left open is closed
                  for you at {AUTO_CLOSE_HOUR - 12}pm and claims no distance.
                </div>
              </div>
              <GhostButton onClick={() => setScreen('duty')} style={{ flexShrink: 0 }}>
                End the day
              </GhostButton>
            </div>
          </div>
        )}

        {/* Leave status */}
        {todayLeave && (todayLeave.status === 'pending_approval' || todayLeave.status === 'active' || todayLeave.status === 'unmark_requested') && (
          <div style={{ background: t.tint, borderRadius: 6, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: t.text }}>
                  {todayLeave.leaveType === 'half_day' ? 'Half day leave' : 'Full day leave'}
                  {todayLeave.reason ? ` · ${todayLeave.reason}` : ''}
                </div>
                <div style={{ fontSize: 13, color: t.text3, marginTop: 3 }}>
                  {todayLeave.status === 'pending_approval'
                    ? 'Waiting for an admin to approve it.'
                    : todayLeave.status === 'unmark_requested'
                      ? 'You asked to unmark this. Waiting for approval.'
                      : `Approved at ${new Date(todayLeave.markedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.`}
                </div>
              </div>
              {todayLeave.status === 'active' && (
                <GhostButton onClick={handleUnmarkLeave} style={{ flexShrink: 0 }}>
                  Unmark
                </GhostButton>
              )}
            </div>
          </div>
        )}

        {/* Today */}
        <StatGrid>
          <StatCard value={isOnFullLeave ? '—' : visitsToday} label="Visits today"
            context={`${monthlyVisitLogCount} days logged this month`} />
          <StatCard value={isOnFullLeave ? '—' : ordersToday} label="Orders today"
            context="Placed from a revisit" />
          <StatCard value={isOnFullLeave ? '—' : revisitLogsToday} label="Logs today"
            context={`${monthlyRevisitLogCount} this month`} />
        </StatGrid>

        {/* Today's work */}
        <div>
          <div style={{ marginBottom: 12 }}><Eyebrow>Today</Eyebrow></div>
          <RowGroup>
            {/* Duty is the gate. Everything in the field hangs off this session. */}
            <ListRow
              title={isDayClosed ? 'Day finished' : isOnDuty ? 'End the day' : 'Start the day'}
              desc={isDayClosed
                ? dutySession?.autoClosed
                  ? 'Closed automatically — no closing reading was given'
                  : `${dutySession?.claimedDistanceKm ?? 0} km recorded`
                : isOnDuty
                  ? `Started at ${new Date(dutySession!.startAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · closing reading and photo`
                  : 'Meter reading, photo and location'}
              value={isOnDuty ? `${dutySession?.startOdometerKm} km` : undefined}
              warn={!isOnDuty && !isDayClosed && !isOnFullLeave}
              disabled={isOnFullLeave}
              onClick={() => setScreen('duty')}
            />
            <ListRow
              title="Log a visit"
              desc={isTodayHoliday
                ? 'Paused — today is a public holiday'
                : isOnFullLeave
                  ? 'Paused — you are on full day leave'
                  : isDayClosed
                    ? 'Locked — you have punched out for the day'
                    : !isOnDuty
                      ? 'Locked until you start the day'
                      : 'Record shop visits and what came of them'}
              value={isOnFullLeave || !isOnDuty ? undefined : `${visitsToday} today`}
              disabled={isOnFullLeave || !isOnDuty}
              onClick={() => setScreen('outlet')}
            />
            <ListRow
              title="Add an expense"
              desc="Log travel, food and daily allowance"
              onClick={() => { setExpenseDefaultToDay(true); setScreen('expenses') }}
            />
          </RowGroup>
        </div>

        {/* Trade */}
        <div>
          <div style={{ marginBottom: 12 }}><Eyebrow>Trade</Eyebrow></div>
          <RowGroup columns={2}>
            <ListRow title="Network" desc="Distributors and retailers you cover"
              value={`${parties.length} accounts`} onClick={() => setScreen('parties')} />
            <ListRow title="Allocations" desc="Stock requests you have raised"
              onClick={() => setScreen('allocations')} />
            <ListRow title="Stock" desc="What the company has available"
              value="View only" onClick={() => setScreen('stock')} />
            <ListRow title="Credit book" desc="Outstanding amounts and settlements"
              value="View only" onClick={() => setScreen('credits')} />
          </RowGroup>
        </div>

        {/* Personal */}
        <div>
          <div style={{ marginBottom: 12 }}><Eyebrow>Yours</Eyebrow></div>
          <RowGroup columns={2}>
            <ListRow title="My activity" desc="Everything you have logged, day by day"
              value={`${monthlyVisitLogCount} days this month`} onClick={() => setScreen('history')} />
            <ListRow title="My leaves" desc="Apply for time off and track approvals"
              value={pendingLeavesCount > 0 ? `${pendingLeavesCount} pending` : undefined}
              warn={pendingLeavesCount > 0}
              onClick={() => setScreen('leaves')} />
            <ListRow title="Expense reports" desc="Weekly submissions and what was cleared"
              onClick={() => { setExpenseDefaultToDay(false); setScreen('expenses') }} />
          </RowGroup>
        </div>

      </div>
      {leaveModal}
    </div>
  )
}
