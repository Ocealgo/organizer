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
import {
  Party, DailyVisitLog, LeaveRecord, Holiday,
  WorkPlan, SalesRoute, workPlanId, ManagerActivity, MANAGER_ACTIVITY_LABEL,
} from '../../types'
import { useConfirm } from '../../hooks/useConfirm'
import { localDateStr, localMonthStr, localTimeStr, isSunday } from '../../utils/date'
import { Eyebrow, StatGrid, StatCard, RowGroup, ListRow, EmptyState, GhostButton } from '../../components/ui'
import { useDutySession, closeAbandonedSessions } from '../../hooks/useDutySession'
import { REMINDER_HOUR, AUTO_CLOSE_HOUR } from '../../device/notify'
import DutyScreen from './DutyScreen'
import OutletVisitScreen from './OutletVisitScreen'
import RemoteContactScreen from './RemoteContactScreen'
import OpportunitiesScreen from '../reports/OpportunitiesScreen'
import ManagerLog from '../planner/ManagerLog'

interface Props { name: string }

const todayStr = () => localDateStr()
const currentMonth = () => localMonthStr()

type SubScreen = 'home' | 'duty' | 'outlet' | 'contact' | 'opportunities' | 'visits' | 'parties' | 'stock' | 'expenses' | 'credits' | 'allocations' | 'history' | 'leaves' | 'managerLog'

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
  /** Shops reached today, for measuring the day against the beat. */
  const [visitedTodayIds, setVisitedTodayIds] = useState<Set<string>>(new Set())
  const [todayPlan, setTodayPlan] = useState<WorkPlan | null>(null)
  const [routes, setRoutes] = useState<SalesRoute[]>([])
  const [planOpen, setPlanOpen] = useState(false)
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
  /** When a half day ends and the afternoon may be worked. From config/settings. */
  const [halfDayResumeAt, setHalfDayResumeAt] = useState('13:00')
  /** Ticks every minute so a time-based block lifts without a reload. */
  const [now, setNow] = useState(localTimeStr())
  /** Meetings a manager put this person in today. Read-only from here. */
  const [myMeetings, setMyMeetings] = useState<ManagerActivity[]>([])
  const { modal: leaveModal, showConfirm: showLeaveConfirm } = useConfirm()
  // Spec §2.3 — the outlet list stays locked until the day is punched in.
  //
  // `loading` is not decoration. Until the listener answers, "no session" and
  // "we have not looked yet" are the same value, and everything below — the
  // line at the top of the screen, which row is offered, and which of the two
  // duty forms opens — would otherwise treat the second as the first.
  const { session: dutySession, loading: dutyLoading, isOnDuty, isDayClosed } = useDutySession(appUser?.uid)

  useEffect(() => {
    return onSnapshot(collection(db, 'parties'), snap => {
      setParties(snap.docs.map(d => ({ id: d.id, ...d.data() } as Party)))
    })
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(localTimeStr()), 60_000)
    return () => clearInterval(id)
  }, [])

  /**
   * Meetings somebody put this person in today.
   *
   * A rep who spent the morning in a team review has less of the day left for
   * shops, and nothing anywhere said so — their visit count simply read low
   * with no explanation. This is the explanation, on their own screen, without
   * them having to type it.
   *
   * `array-contains` on withUids is not only the filter but the reason the read
   * is allowed at all: it is what lets the rules verify the membership check
   * for every document the query could return.
   */
  useEffect(() => {
    if (!appUser) return
    const q = query(
      collection(db, 'manager_activities'),
      where('withUids', 'array-contains', appUser.uid),
      where('date', '==', todayStr()),
    )
    return onSnapshot(q,
      s => setMyMeetings(s.docs.map(d => ({ id: d.id, ...d.data() } as ManagerActivity))),
      () => setMyMeetings([]),
    )
  }, [appUser])

  useEffect(() => onSnapshot(doc(db, 'config', 'settings'), snap => {
    const at = (snap.data() as any)?.attendance?.halfDayResumeAt
    if (typeof at === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(at)) setHalfDayResumeAt(at)
  }, () => {}), [])

  /**
   * Land where a notification said it would.
   *
   * "Start your day or it is marked absent" that opens the home screen is a
   * notification asking somebody to go and find the thing it was about. Two
   * routes in, because a phone has two cases: the app was closed, so the URL
   * carries it; or the app was already open, so the service worker focuses the
   * window and posts the same URL through.
   *
   * The parameter is scrubbed once used. Left in place it survives a refresh
   * and drags the rep back to the same screen every time they reload.
   */
  useEffect(() => {
    const go = (raw: string | null) => {
      if (!raw) return
      const allowed: SubScreen[] = ['duty', 'outlet', 'leaves', 'expenses', 'credits', 'visits']
      if ((allowed as string[]).includes(raw)) setScreen(raw as SubScreen)
    }

    go(new URLSearchParams(window.location.search).get('go'))
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname)
    }

    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== 'NAVIGATE' || typeof e.data.url !== 'string') return
      try {
        go(new URL(e.data.url, window.location.origin).searchParams.get('go'))
      } catch { /* a malformed link is not worth breaking the screen over */ }
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
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
      // Coverage counts anywhere they have been today, an open visit included —
      // a rep standing inside a shop has covered it whether or not the form is
      // finished. The count above is completed logs, a different and
      // deliberately stricter question.
      setVisitedTodayIds(new Set(
        snap.docs
          .filter(d => d.data().status !== 'abandoned')
          .map(d => d.data().partyId as string),
      ))
      setOutletVisitsLoaded(true)
    })
  }, [appUser])

  // What the office asked of today.
  useEffect(() => {
    if (!appUser) return
    return onSnapshot(
      doc(db, 'work_plans', workPlanId(appUser.uid, todayStr())),
      snap => setTodayPlan(snap.exists() ? ({ id: snap.id, ...snap.data() } as WorkPlan) : null),
      // No plan is the ordinary case, not a fault worth reporting.
      () => setTodayPlan(null),
    )
  }, [appUser])

  // The beats themselves, for the shop list behind today's plan.
  useEffect(() => onSnapshot(collection(db, 'sales_routes'), s =>
    setRoutes(s.docs.map(d => ({ id: d.id, ...d.data() } as SalesRoute)))), [])

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

  /**
   * Appeals happen on the Leave screen, not here.
   *
   * This used to raise the request itself — flip the status and stop. It told
   * nobody: no alert, so a manager only found out by opening the leave tracker
   * and noticing, and it asked for no reason even on a leave the app had marked
   * automatically, which is the one case where the reason is the whole point.
   * Meanwhile the identical action on the Leave screen did both.
   *
   * Two copies of one action is what produced that, so there is one now. This
   * hands over to it rather than growing a third.
   */
  const goToLeaveAppeal = () => setScreen('leaves')
  /**
   * A half day off is half a day off.
   *
   * Leave that changed nothing was not leave — a rep marked half a day for
   * missing the morning cutoff could punch in at 10:05 and work a full day,
   * which makes the record a fiction and the deduction meaningless. The morning
   * is closed and the afternoon is theirs.
   *
   * `now` ticks every minute so the block lifts on its own. Computed once at
   * render, somebody waiting for one o'clock would sit looking at a locked
   * screen until they thought to reload — the app appearing broken at exactly
   * the moment they are trying to comply.
   *
   * Declared above the routing because the duty screen is handed it on the way
   * in, not only shown it on the way past.
   */
  /**
   * A leave under appeal still stands.
   *
   * `unmark_requested` counts as much as `active`. Otherwise asking to cancel
   * is itself the way out — appeal at ten past ten, work the morning, and it
   * never mattered whether the manager agreed. The block holds until somebody
   * decides, and the moment they do it lifts on the next tick.
   */
  const leaveStands = (l: LeaveRecord | null) =>
    !!l && (l.status === 'active' || l.status === 'unmark_requested')

  const halfDayLeave = !!todayLeave && todayLeave.leaveType === 'half_day' && leaveStands(todayLeave)
  const inHalfDayMorning = halfDayLeave && now < halfDayResumeAt


  // Route to sub-screens — hooks are above so this is safe
  //
  // The duty screen reads the session it is handed once and becomes either the
  // opening form or the closing one on the strength of it, so it must not be
  // handed a session that has merely not arrived yet.
  if (screen === 'duty' && appUser) return dutyLoading
    ? (
      <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, padding: '30px 20px',
                    fontSize: 14, color: t.text3 }}>
        Checking where your day stands…
      </div>
    )
    : <DutyScreen appUser={appUser} session={dutySession} onBack={() => setScreen('home')}
        blockedUntil={inHalfDayMorning ? halfDayResumeAt : undefined} />
  // `isOnDuty`, not "a session exists". A closed day still has one, and this is
  // the gate that is supposed to stop visits being filed against a day that is
  // already finished — including one that closes while this screen is open.
  if (screen === 'outlet' && appUser && dutySession && isOnDuty) return <OutletVisitScreen appUser={appUser} session={dutySession} onBack={() => setScreen('home')} />
  if (screen === 'contact' && appUser && dutySession && isOnDuty) return <RemoteContactScreen appUser={appUser} session={dutySession} onBack={() => setScreen('home')} />
  // A rep's own list, not a league table of anybody else's territory.
  if (screen === 'opportunities' && appUser) return <OpportunitiesScreen uid={appUser.uid} onBack={() => setScreen('home')} onVisit={() => setScreen('outlet')} />
  if (screen === 'visits')      return <VisitLogger onBack={() => { setVisitInitialDate(undefined); setScreen('home') }} initialDate={visitInitialDate} onViewAllocation={(id) => { setHighlightAllocationId(id); setScreen('allocations') }} onViewPayment={(partyId, paymentId) => { setDeepLinkPaymentPartyId(partyId); setDeepLinkPaymentId(paymentId); setCreditReturnScreen('visits'); setScreen('credits') }} />
  if (screen === 'parties')     return <PartyManager onBack={() => setScreen('home')} />
  if (screen === 'stock')       return <StockManager onBack={() => setScreen('home')} />
  if (screen === 'expenses')    return <ExpenseLogger onBack={() => setScreen('home')} onLogVisit={date => { setVisitInitialDate(date); setScreen('visits') }} defaultToDay={expenseDefaultToDay} />
  if (screen === 'credits')     return <CreditBook onBack={() => { const ret = creditReturnScreen; setDeepLinkPaymentPartyId(undefined); setDeepLinkPaymentId(undefined); setCreditReturnScreen('home'); setScreen(ret) }} initialPartyId={deepLinkPaymentPartyId} focusPaymentId={deepLinkPaymentId} salesRepOnly={!!deepLinkPaymentId} />
  if (screen === 'allocations') return <AllocationManager onBack={() => { const ret = allocReturnScreen; setHighlightAllocationId(undefined); setAllocSalesRepOnly(false); setAllocReturnScreen('home'); setScreen(ret) }} parties={parties} isAdmin={false} highlightId={highlightAllocationId} salesRepOnly={allocSalesRepOnly} />
  if (screen === 'history')     return <ActivityScreen onBack={() => setScreen('home')} onViewAllocation={(allocId) => { setHighlightAllocationId(allocId); setAllocSalesRepOnly(true); setAllocReturnScreen('history'); setScreen('allocations') }} onViewPayment={(partyId, paymentId) => { setDeepLinkPaymentPartyId(partyId); setDeepLinkPaymentId(paymentId); setCreditReturnScreen('history'); setScreen('credits') }} />
  if (screen === 'leaves')      return <LeaveHistory leaveRecords={allLeaveRecords} onBack={() => setScreen('home')} />
  // A sales manager working a field day logs their meetings and desk time on
  // the same screen they punch in on. A rep never reaches it — the row that
  // leads here is theirs only.
  if (screen === 'managerLog') return <ManagerLog onBack={() => setScreen('home')} />

  // Online Sales — not built yet
  if (isOnline) return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, padding: '30px 20px' }}>
      <EmptyState
        title="Online sales"
        body="E-commerce orders and digital campaigns will live here. Nothing to do in this space yet."
      />
    </div>
  )

  const isTodayHoliday = holidays.some(h => h.date === todayStr())
  // develop's version keeps `leaveStands`, which counts a leave under appeal —
  // otherwise asking to cancel is itself the way out of the block.
  const isOnFullLeave = isTodayHoliday
    || (!!todayLeave && todayLeave.leaveType === 'full_day' && leaveStands(todayLeave))

  /** Sunday blocks starting a day, the same way the older visit logger always has. */
  const isSundayToday = isSunday(todayStr())

  /**
   * Today's beat, and how far through it they are.
   *
   * Derived every render from the plan and the visits rather than stored, so
   * it corrects itself the moment a visit is logged and cannot drift from what
   * actually happened.
   *
   * Only what is left is listed. A rep does not need to be shown the eight
   * shops they have already walked into; they need the four they have not.
   */
  const todayBeat = todayPlan?.routeId
    ? routes.find(r => r.id === todayPlan.routeId)
    : undefined
  const beatShops = (todayBeat?.outletIds ?? [])
    .map(id => parties.find(p => p.id === id))
    .filter(Boolean) as Party[]
  const beatDone = beatShops.filter(p => visitedTodayIds.has(p.id!)).length
  const beatLeft = beatShops.filter(p => !visitedTodayIds.has(p.id!))
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
          : visitsToday === 0
            ? `Nothing logged yet today${ordersToday > 0 ? `, though ${ordersToday} ${ordersToday === 1 ? 'order' : 'orders'} placed` : ''}.`
            : `${visitsToday} ${visitsToday === 1 ? 'visit' : 'visits'} logged today${ordersToday > 0 ? `, and ${ordersToday} ${ordersToday === 1 ? 'order' : 'orders'} placed` : ''}.`

  return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg }}>
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
                <GhostButton onClick={goToLeaveAppeal} style={{ flexShrink: 0 }}>
                  {todayLeave.autoMarked ? 'This is wrong' : 'Unmark'}
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

        {/* What the office asked of today. Sits above the day's controls
            because it is the answer to "what am I doing", which comes before
            "start". Absent for a rep nobody has planned for, rather than
            occupying the space to say so. */}
        {todayPlan && !isSundayToday && (
          <div>
            <div style={{ marginBottom: 12 }}><Eyebrow>Your beat today</Eyebrow></div>
            <div style={{ background: t.tint, borderRadius: 6, padding: 16 }}>
              <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16,
              }}>
                <span style={{ fontSize: 15, fontWeight: 500, color: t.text }}>
                  {todayPlan.routeName}
                </span>
                {beatShops.length > 0 && (
                  <span style={{
                    fontSize: 13, whiteSpace: 'nowrap',
                    color: beatDone === beatShops.length ? t.accent : t.text2,
                  }}>
                    {beatDone} of {beatShops.length}
                  </span>
                )}
              </div>

              {todayPlan.note && (
                <div style={{ fontSize: 13, color: t.text2, marginTop: 8, lineHeight: 1.6 }}>
                  {todayPlan.note}
                </div>
              )}

              {todayPlan.targets && (
                <div style={{ fontSize: 12, color: t.text3, marginTop: 8, lineHeight: 1.6 }}>
                  {[
                    todayPlan.targets.visits ? `${todayPlan.targets.visits} shops` : null,
                    todayPlan.targets.orderValue
                      ? `₹${todayPlan.targets.orderValue.toLocaleString('en-IN')} of orders`
                      : null,
                  ].filter(Boolean).join(' · ')} asked for today
                </div>
              )}

              {beatLeft.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <button className="oc-action" onClick={() => setPlanOpen(o => !o)}
                    style={{
                      background: 'none', border: 'none', padding: 0,
                      fontSize: 13, color: t.text2, cursor: 'pointer',
                    }}>
                    {planOpen ? 'Hide' : 'Show'} the {beatLeft.length} still to go
                  </button>
                  {planOpen && (
                    <div style={{ marginTop: 10, borderTop: `0.5px solid ${t.border}` }}>
                      {beatLeft.map(p => (
                        <div key={p.id} style={{
                          fontSize: 13, color: t.text2, padding: '9px 0',
                          borderBottom: `0.5px solid ${t.border}`, lineHeight: 1.5,
                        }}>
                          {p.name}
                          <span style={{ color: t.text3 }}>
                            {p.place ? ` · ${p.place}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {beatShops.length > 0 && beatLeft.length === 0 && (
                <div style={{ fontSize: 13, color: t.accent, marginTop: 10 }}>
                  Every shop on the beat has been visited.
                </div>
              )}

              <div style={{ fontSize: 12, color: t.text3, marginTop: 12, lineHeight: 1.6 }}>
                A guide, not a limit. Anywhere else you go today still counts.
              </div>
            </div>
          </div>
        )}

        {/* Time somebody else put in this person's day.
            Read-only: a rep did not arrange it and cannot change it, and a card
            they can edit would invite them to explain away a thin day. It is
            here so a low visit count has its reason on the same screen. */}
        {myMeetings.length > 0 && (
          <div>
            <div style={{ marginBottom: 12 }}><Eyebrow>Also today</Eyebrow></div>
            <div style={{ background: t.tint, borderRadius: 6, padding: 16 }}>
              {myMeetings
                .sort((a, b) => a.createdAt - b.createdAt)
                .map((m, i) => (
                  <div key={m.id} style={{
                    paddingTop: i === 0 ? 0 : 11,
                    marginTop: i === 0 ? 0 : 11,
                    borderTop: i === 0 ? 'none' : `0.5px solid ${t.border}`,
                  }}>
                    <div style={{ fontSize: 14, color: t.text }}>{m.title}</div>
                    <div style={{ fontSize: 12, color: t.text3, marginTop: 3, lineHeight: 1.6 }}>
                      {[
                        MANAGER_ACTIVITY_LABEL[m.kind],
                        `with ${m.name}`,
                        m.minutes ? `${m.minutes} min` : null,
                      ].filter(Boolean).join(' · ')}
                    </div>
                    {m.notes && (
                      <div style={{ fontSize: 12, color: t.text2, marginTop: 4, lineHeight: 1.55 }}>
                        {m.notes}
                      </div>
                    )}
                  </div>
                ))}
              <div style={{ fontSize: 12, color: t.text3, marginTop: 12, lineHeight: 1.6 }}>
                Recorded by your manager. It counts as your day — you do not need to log it.
              </div>
            </div>
          </div>
        )}

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
              // Sunday first: on a Sunday there is no day to be half of.
              title={dutyLoading ? 'Your day'
                : isDayClosed ? 'Day finished'
                : isOnDuty ? 'End the day'
                : isSundayToday ? 'Sunday — day off'
                : inHalfDayMorning ? `Half day — starts at ${halfDayResumeAt}`
                : 'Start the day'}
              desc={dutyLoading
                ? 'Checking today’s record…'
                : isDayClosed
                  ? dutySession?.autoClosed
                    ? 'Closed automatically — no closing reading was given'
                    : `${dutySession?.claimedDistanceKm ?? 0} km recorded`
                  : isOnDuty
                    ? `Started at ${new Date(dutySession!.startAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · closing reading and photo`
                    : isSundayToday
                      ? 'Nothing to log today. Your next day starts tomorrow.'
                      : inHalfDayMorning
                        ? `Half a day is recorded against this morning. You can start at ${halfDayResumeAt}.`
                        : 'Meter reading, photo and location'}
              value={!dutyLoading && isOnDuty ? `${dutySession?.startOdometerKm} km` : undefined}
              warn={!dutyLoading && !isOnDuty && !isDayClosed && !isOnFullLeave
                && !isSundayToday && !inHalfDayMorning}
              // A day already open stays openable so it can be closed — every
              // block here is on starting one, never on finishing one that
              // already exists.
              disabled={isOnFullLeave || dutyLoading
                || ((isSundayToday || inHalfDayMorning) && !isOnDuty && !isDayClosed)}
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
                        : 'Record shop visits and what came of them'}
              value={isOnFullLeave || dutyLoading || !isOnDuty ? undefined : `${visitsToday} today`}
              disabled={isOnFullLeave || dutyLoading || !isOnDuty}
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
            {/* A manager's own day. Not gated on a duty session: a meeting or a
                desk day is exactly what happens when nobody punched in, and
                that is the case this exists to record. A rep never sees it. */}
            {appUser?.role === 'sales_manager' && (
              <ListRow
                title="What I did today"
                desc="Meetings, days out with a rep, desk days — the parts nothing else records"
                onClick={() => setScreen('managerLog')}
              />
            )}
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
            <ListRow title="Worth going back to"
              desc="Shops that stopped ordering, or ran empty last time you looked"
              onClick={() => setScreen('opportunities')} />
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
