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
import RemoteContactScreen from './RemoteContactScreen'

interface Props { name: string }

const todayStr = () => localDateStr()
const currentMonth = () => localMonthStr()

type SubScreen = 'home' | 'duty' | 'outlet' | 'contact' | 'visits' | 'parties' | 'stock' | 'expenses' | 'credits' | 'allocations' | 'history' | 'leaves'

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
  const [collectedToday, setCollectedToday] = useState(0)
  const [collectedThisMonth, setCollectedThisMonth] = useState(0)
  const [outletVisitsToday, setOutletVisitsToday] = useState(0)
  const [outletVisitsLoaded, setOutletVisitsLoaded] = useState(false)
  const [holidaysLoaded, setHolidaysLoaded] = useState(false)
  const [leaveLoaded, setLeaveLoaded] = useState(false)
  const [ordersToday, setOrdersToday] = useState(0)
  const [monthlyOrderCount, setMonthlyOrderCount] = useState(0)
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
  //
  // `loading` is not decoration. Until the listener answers, "no session" and
  // "we have not looked yet" are the same value, and everything below — the
  // line at the top of the screen, which row is offered, and which of the two
  // duty forms opens — would otherwise treat the second as the first.
  const { session: dutySession, loading: dutyLoading, isOnDuty, isDayClosed } = useDutySession(appUser?.uid)
  /**
   * A desk day is a working day, not a field one.
   *
   * The outlet list is gated on being out, not merely on being punched in —
   * otherwise "I am working from the office today" would unlock a list of
   * shops to punch into from a chair, and every geofence distance on it would
   * be a lie about where somebody was.
   */
  const isRemoteDay = dutySession?.dayType === 'remote'
  const isInField = isOnDuty && !isRemoteDay

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

  /**
   * Money this rep has taken off shops, which is work with nothing else on
   * this screen to show for it.
   *
   * It replaced a count of `revisit_logs` — a card that could only ever read
   * zero for anyone working the outlet flow, since that flow writes no revisit
   * logs. Cash collected is the third real thing a rep does after visiting and
   * booking, and until now they had to open the credit book to see any of it.
   */
  useEffect(() => {
    if (!appUser) return
    const q = query(collection(db, 'payment_transactions'), where('collectedBy', '==', appUser.uid))
    return onSnapshot(q, snap => {
      const today = todayStr()
      const month = currentMonth()
      // A rejected receipt is not money the company got, so it is not money
      // this rep collected.
      const kept = snap.docs
        .map(d => d.data() as { amount?: number; date?: string; status?: string })
        .filter(p => p.status !== 'rejected' && typeof p.amount === 'number')
      const sum = (rows: typeof kept) => rows.reduce((n, p) => n + (p.amount ?? 0), 0)
      setCollectedToday(sum(kept.filter(p => p.date === today)))
      setCollectedThisMonth(sum(kept.filter(p => (p.date ?? '').startsWith(month))))
    })
  }, [appUser])

  /**
   * Orders this rep has raised, counted where orders actually live.
   *
   * This used to count `revisit_logs` documents carrying a `new_order` action,
   * which is the older screen's way of recording one. An order booked in a
   * shop writes an allocation and never touches `revisit_logs`, so a rep could
   * book six of them in a morning and watch their own home screen say none.
   *
   * Counting the allocations covers every route in — the outlet visit, the
   * revisit log and the Allocations screen all end up here with the rep as
   * `createdBy` — and a cancelled one stops counting, which a log entry never
   * did.
   */
  useEffect(() => {
    if (!appUser) return
    const q = query(collection(db, 'allocations_v2'), where('createdBy', '==', appUser.uid))
    return onSnapshot(q, snap => {
      const today = todayStr()
      const month = currentMonth()
      const live = snap.docs
        .map(d => d.data() as { createdAt?: number; status?: string })
        .filter(a => a.status !== 'cancelled' && typeof a.createdAt === 'number')
      // Grouped by the day it was raised, not the day it is planned for — the
      // question this answers is "what did I do today".
      const raisedOn = (a: { createdAt?: number }) => localDateStr(new Date(a.createdAt!))
      setOrdersToday(live.filter(a => raisedOn(a) === today).length)
      setMonthlyOrderCount(live.filter(a => raisedOn(a).startsWith(month)).length)
    })
  }, [appUser])

  // Today's shop visits. This is the collection the field app actually writes —
  // `visit_logs` below is the older screen, and an officer working the outlet
  // flow never creates one.
  useEffect(() => {
    if (!appUser) return
    const q = query(
      collection(db, 'outlet_visits'),
      where('uid', '==', appUser.uid),
      where('date', '==', todayStr()),
    )
    return onSnapshot(q, snap => {
      setOutletVisitsToday(snap.docs.filter(d => d.data().status === 'closed').length)
      setOutletVisitsLoaded(true)
    })
  }, [appUser])

  useEffect(() => {
    return onSnapshot(collection(db, 'holidays'), snap => {
      setHolidays(snap.docs.map(d => ({ id: d.id, ...d.data() } as Holiday)))
      setHolidaysLoaded(true)
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
      setLeaveLoaded(true)
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

  /**
   * A day with nothing on it is written down as one, so a blank in a report
   * reads as "nothing happened" rather than "nobody knows".
   *
   * This is the one thing on the officer's screen that records something about
   * their day without being asked to, so every reason not to write has to have
   * actually been heard before it does. Four separate listeners hold those
   * reasons, and this used to fire the moment the visit-log one came back —
   * whichever of the others had not landed yet simply counted as "no reason
   * not to". `holidays` was not even in the dependency list, so the holiday
   * check ran against whatever array the closure was built with, which is the
   * empty one. The result was "did nothing today" filed against public
   * holidays, approved leave, and days spent out visiting shops, with nothing
   * in the app to take it back.
   */
  const noEntryCreated = React.useRef(false)
  useEffect(() => {
    if (!appUser || noEntryCreated.current) return
    // Nothing is decided until everything that could say "do not" has spoken.
    if (!visitLogLoaded || !outletVisitsLoaded || !leaveLoaded || !holidaysLoaded || dutyLoading) return
    if (todayVisitLog !== null) return
    if (new Date().getHours() < 12) return
    if (todayLeave?.leaveType === 'full_day' && (todayLeave.status === 'active' || todayLeave.status === 'pending_approval')) return
    if (holidays.some(h => h.date === todayStr())) return
    // A day that was punched in, or that has a shop visit on it, is a day that
    // happened. Whatever else it is, it is not "no entry".
    if (dutySession || outletVisitsToday > 0) return
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
  }, [appUser, visitLogLoaded, outletVisitsLoaded, leaveLoaded, holidaysLoaded, dutyLoading,
      todayVisitLog, todayLeave, holidays, dutySession, outletVisitsToday])

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
  //
  // The duty screen reads the session it is handed once and becomes either the
  // opening form or the closing one on the strength of it, so it must not be
  // handed a session that has merely not arrived yet.
  if (screen === 'duty' && appUser) return dutyLoading
    ? (
      <div style={{ minHeight: '100vh', background: t.bg, padding: '30px 20px',
                    fontSize: 14, color: t.text3 }}>
        Checking where your day stands…
      </div>
    )
    : <DutyScreen appUser={appUser} session={dutySession} onBack={() => setScreen('home')} />
  // `isOnDuty`, not "a session exists". A closed day still has one, and this is
  // the gate that is supposed to stop visits being filed against a day that is
  // already finished — including one that closes while this screen is open.
  if (screen === 'outlet' && appUser && dutySession && isInField) return <OutletVisitScreen appUser={appUser} session={dutySession} onBack={() => setScreen('home')} />
  if (screen === 'contact' && appUser && dutySession && isOnDuty) return <RemoteContactScreen appUser={appUser} session={dutySession} onBack={() => setScreen('home')} />
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
  // Both flows count. The outlet screen is what an officer uses now and it
  // writes `outlet_visits`; `visit_logs` is the older screen, still reachable
  // from the expense sheet. Reading only the second showed a rep who had been
  // round six shops that they had logged nothing all day.
  const visitsToday = Math.max(todayVisitLog?.totalVisited ?? 0, outletVisitsToday)

  // One sentence saying what today looks like from the rep's side.
  const attention = dutyLoading
    ? 'Checking where your day stands…'
    : isTodayHoliday
    ? 'Today is a public holiday. Nothing is expected from you.'
    : isOnFullLeave
      ? 'You are on full day leave today. Visit logging is paused.'
      : isDayClosed && dutySession?.autoClosed
        ? `Your day was closed for you because it was left open — ${visitsToday} ${visitsToday === 1 ? 'visit' : 'visits'} logged, and no distance could be claimed.`
      : isDayClosed
        ? `Your day is finished — ${visitsToday} ${visitsToday === 1 ? 'visit' : 'visits'} logged and ${dutySession?.claimedDistanceKm ?? 0} km travelled.`
        : !isOnDuty
          ? 'You have not started your day yet. Punch in to unlock your outlet list.'
          : isRemoteDay
            ? `You are working from a desk today${ordersToday > 0 ? `, with ${ordersToday} ${ordersToday === 1 ? 'order' : 'orders'} placed so far` : ''}. Head out from Your day if that changes.`
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
            context={`${monthlyOrderCount} this month`} />
          <StatCard
            value={isOnFullLeave ? '—' : `₹${collectedToday.toLocaleString('en-IN')}`}
            label="Collected today"
            context={`₹${collectedThisMonth.toLocaleString('en-IN')} this month`} />
        </StatGrid>

        {/* Today's work */}
        <div>
          <div style={{ marginBottom: 12 }}><Eyebrow>Today</Eyebrow></div>
          <RowGroup>
            {/* Duty is the gate. Everything in the field hangs off this session.
                Until the listener has answered, this row does not claim to know
                which of the three states it is in — offering "Start the day" to
                somebody already punched in is how they end up on the wrong form
                with the wrong button under their thumb. */}
            <ListRow
              title={dutyLoading ? 'Your day' : isDayClosed ? 'Day finished' : isOnDuty ? 'Your day' : 'Start the day'}
              desc={dutyLoading
                ? 'Checking today’s record…'
                : isDayClosed
                  ? dutySession?.autoClosed
                    ? 'Closed automatically — no closing reading was given'
                    : `${dutySession?.claimedDistanceKm ?? 0} km recorded`
                  : isRemoteDay
                    ? `At a desk since ${new Date(dutySession!.startAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · head out, or finish the day`
                    : isOnDuty
                      ? `Started at ${new Date(dutySession!.startAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · closing reading and photo`
                      : 'Meter reading, photo and location'}
              value={!dutyLoading && isInField ? `${dutySession?.startOdometerKm} km` : undefined}
              warn={!dutyLoading && !isOnDuty && !isDayClosed && !isOnFullLeave}
              disabled={isOnFullLeave || dutyLoading}
              onClick={() => setScreen('duty')}
            />
            <ListRow
              title="Log a visit"
              desc={isTodayHoliday
                ? 'Paused — today is a public holiday'
                : isOnFullLeave
                  ? 'Paused — you are on full day leave'
                  : dutyLoading
                    ? 'Checking today’s record…'
                    : isDayClosed
                      ? 'Locked — you have punched out for the day'
                      : !isOnDuty
                        ? 'Locked until you start the day'
                        : isRemoteDay
                          ? 'Locked — you are at a desk today. Head out from Your day to unlock it'
                          : 'Record shop visits and what came of them'}
              value={isOnFullLeave || dutyLoading || !isInField ? undefined : `${visitsToday} today`}
              disabled={isOnFullLeave || dutyLoading || !isInField}
              onClick={() => setScreen('outlet')}
            />
            {/* Reaching a shop without going to it. Available on any day — a
                rep in the field takes calls too — but it is the whole of the
                job on a desk day, so it sits right under the visit row. */}
            <ListRow
              title="Log a call or message"
              desc={isOnFullLeave
                ? 'Paused — you are not working today'
                : dutyLoading
                  ? 'Checking today’s record…'
                  : isDayClosed
                    ? 'Locked — you have punched out for the day'
                    : !isOnDuty
                      ? 'Locked until you start the day'
                      : 'Orders and conversations from a desk. Never counted as a visit'}
              disabled={isOnFullLeave || dutyLoading || !isOnDuty}
              onClick={() => setScreen('contact')}
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
