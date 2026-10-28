import { useState, useEffect } from 'react'
import { collection, updateDoc, doc, addDoc, deleteDoc, query, orderBy, where, getDocs, writeBatch } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import { LeaveRecord, AppUser, Holiday } from '../../types'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import { useConfirm } from '../../hooks/useConfirm'
import { localDateStr, localMonthStr } from '../../utils/date'
import DateInput from '../../components/DateInput'
import DayPicker, { dayOffLabel, HolidayNote } from '../../components/DayPicker'
import AttendanceRegister from '../../attendance/AttendanceRegister'
import { datesOfMonth, fmtDays, leaveDaysOf } from '../../attendance/attendance'
import { FilterBox, ScrollList } from '../../components/FilterBox'
import {
  PageHeader, TabBar, StatGrid, StatCard, Section, EmptyState, Eyebrow,
  ChipGroup, GhostButton, PrimaryButton, ShowHide, inputStyle,
} from '../../components/ui'

interface Props { onBack: () => void }

type LeaveTab = 'register' | 'leave' | 'holidays'
type LeaveWhen = 'day' | 'month' | 'all'

const todayStr = () => localDateStr()
const thisMonth = () => localMonthStr()

const STATUS_LABEL: Record<string, string> = {
  pending_approval: 'Awaiting approval',
  active: 'Approved',
  unmark_requested: 'Unmark requested',
}

/** Audit entries are stored as machine tokens; nobody should have to read those. */
const ACTION_LABEL: Record<string, string> = {
  leave_marked: 'Leave requested',
  leave_approved: 'Leave approved',
  leave_rejected: 'Leave rejected',
  unmark_requested: 'Unmark requested',
  unmark_approved: 'Unmark approved',
  unmark_rejected: 'Unmark rejected',
  holiday_declared: 'Cancelled — the day was declared a holiday',
}

/** A cell of the leave report: numbers right-aligned, in even figures. */
const reportCell = (t: any, align: 'left' | 'right' = 'right') => ({
  textAlign: align, padding: '9px 10px', borderBottom: `0.5px solid ${t.border}`,
  color: t.text2, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const,
})

const longDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-IN',
    { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })

export default function LeaveTracker({ onBack }: Props) {
  const { t } = useTheme()
  /**
   * Who is actually doing this.
   *
   * Every approval, rejection and holiday in here was stamped `by: 'admin',
   * byName: 'Admin'` — a literal, not a lookup. So the audit log on a leave
   * record said "Admin" whoever pressed the button, which is the one question
   * an audit log exists to answer.
   */
  const { appUser } = useAuth()
  const { modal, showConfirm, showAlert } = useConfirm()

  const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([])
  const [salesUsers, setSalesUsers] = useState<AppUser[]>([])
  const [tab, setTab] = useState<LeaveTab>('register')
  const [selectedPerson, setSelectedPerson] = useState<string>('all')
  // Each leave tab has its own "when": a day, a month, or everything.
  const [when, setWhen] = useState<LeaveWhen>('month')
  const [leaveDay, setLeaveDay] = useState(localDateStr())
  const [leaveMonth, setLeaveMonth] = useState(localMonthStr())
  const [expandedAudit, setExpandedAudit] = useState<string | null>(null)
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [newHolidayName, setNewHolidayName] = useState('')
  const [newHolidayDate, setNewHolidayDate] = useState(localDateStr())
  const [addingHoliday, setAddingHoliday] = useState(false)
  const [teamOpen, setTeamOpen] = useState(false)
  const [recordsOpen, setRecordsOpen] = useState(true)

  /**
   * Whose attendance this is. Sales managers are tracked like the reps; a
   * sales manager looking at it sees only the reps — not their own leave, nor
   * a fellow manager's, which are an admin's to decide.
   */
  const viewerIsManager = appUser?.role === 'sales_manager'

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'leave_records'), snap => {
      setLeaveRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRecord)))
    })
    const u2 = onSnapshot(collection(db, 'users'), snap => {
      setSalesUsers(snap.docs
        .map(d => ({ uid: d.id, ...d.data() } as AppUser))
        .filter(u => u.status === 'approved' && (u.role === 'offline_sales' || u.role === 'online_sales'
          || (u.role === 'sales_manager' && !viewerIsManager)))
        .sort((a, b) => a.name.localeCompare(b.name)))
    })
    const u3 = onSnapshot(query(collection(db, 'holidays'), orderBy('date')), snap => {
      setHolidays(snap.docs.map(d => ({ id: d.id, ...d.data() } as Holiday)))
    })
    return () => { u1(); u2(); u3() }
  }, [viewerIsManager])

  const today = todayStr()
  const month = thisMonth()

  /**
   * A holiday means nobody works, so an automatic absence on one is void. The
   * sweep skips holidays, but one declared after 10:00 finds the absences
   * already written; adding the holiday cancels them, and until it has (or for
   * one written before that existed) they are simply not shown.
   */
  const holidayMap = new Map(holidays.map(h => [h.date, h.name]))
  const voidOnDayOff = (l: LeaveRecord) => l.autoMarked === true
    && (holidayMap.has(l.date) || new Date(l.date + 'T00:00:00').getDay() === 0)
  // Only the people on this screen: a sales manager never sees, nor decides, their own leave.
  const tracked = new Set(salesUsers.map(u => u.uid))
  const ownLeave = leaveRecords.filter(l => tracked.has(l.uid))
  const shown = ownLeave.filter(l => !voidOnDayOff(l))

  const pendingApproval = shown.filter(l => l.status === 'pending_approval')
  const pendingUnmark = shown.filter(l => l.status === 'unmark_requested')

  const handleApproveLeave = async (leave: LeaveRecord) => {
    const confirmed = await showConfirm(
      'Approve this leave?',
      `${leave.name} · ${leave.leaveType === 'half_day' ? 'Half day' : 'Full day'} · ${longDate(leave.date)}${leave.reason ? `\n\n${leave.reason}` : ''}`,
      'Approve',
    )
    if (!confirmed) return
    await updateDoc(doc(db, 'leave_records', leave.id!), {
      status: 'active',
      auditLog: [...(leave.auditLog || []), {
        action: 'leave_approved', by: appUser?.uid ?? '', byName: appUser?.name ?? 'Somebody', at: Date.now()
      }],
    })
    await addDoc(collection(db, 'alerts'), {
      type: 'leave_approved',
      message: `Your ${leave.leaveType === 'full_day' ? 'full day' : 'half day'} leave on ${leave.date} was approved.`,
      relatedId: leave.id!, read: false, createdAt: Date.now(),
      toUid: leave.uid,
    })
  }

  const handleRejectLeave = async (leave: LeaveRecord) => {
    const confirmed = await showConfirm(
      'Reject this leave?',
      `${leave.name} · ${longDate(leave.date)}`,
      'Reject',
    )
    if (!confirmed) return
    await updateDoc(doc(db, 'leave_records', leave.id!), {
      status: 'rejected',
      auditLog: [...(leave.auditLog || []), {
        action: 'leave_rejected', by: appUser?.uid ?? '', byName: appUser?.name ?? 'Somebody', at: Date.now()
      }],
    })
    await tellOfficer(leave,
      `Your ${dayWord(leave)} leave on ${leave.date} was not approved by ${who()}.`)
  }

  const who = () => appUser?.name ?? 'A manager'
  const dayWord = (l: LeaveRecord) => (l.leaveType === 'full_day' ? 'full day' : 'half day')

  /**
   * Tell the officer what was decided.
   *
   * Only approval used to say anything. A rejection, and both answers to a
   * cancellation request, were silent — so somebody who appealed an absence
   * the app had marked against them waited for a reply that was never coming,
   * and found out by noticing the record had or had not moved. The whole point
   * of letting them argue is that somebody answers.
   */
  const tellOfficer = async (leave: LeaveRecord, message: string) => {
    await addDoc(collection(db, 'alerts'), {
      type: 'leave_approved',
      message,
      relatedId: leave.id!,
      toUid: leave.uid,
      url: '/?go=leaves',
      read: false,
      createdAt: Date.now(),
    })
  }

  const handleApproveUnmark = async (leave: LeaveRecord) => {
    const confirmed = await showConfirm(
      'Remove this leave?',
      `${leave.name} asked to unmark their leave on ${longDate(leave.date)}. Approving removes the record.`,
      'Remove it',
    )
    if (!confirmed) return
    await updateDoc(doc(db, 'leave_records', leave.id!), {
      status: 'removed',
      auditLog: [...(leave.auditLog || []), {
        action: 'unmark_approved', by: appUser?.uid ?? '', byName: appUser?.name ?? 'Somebody', at: Date.now()
      }],
    })
    await tellOfficer(leave,
      `${who()} removed the ${dayWord(leave)} leave on ${leave.date}. `
      + (leave.autoMarked ? 'The day is yours again.' : 'Nothing is recorded against that day.'))
  }

  const handleRejectUnmark = async (leave: LeaveRecord) => {
    const confirmed = await showConfirm(
      'Keep this leave?',
      `The leave for ${leave.name} on ${longDate(leave.date)} stays approved.`,
      'Keep it',
    )
    if (!confirmed) return
    await updateDoc(doc(db, 'leave_records', leave.id!), {
      status: 'active',
      auditLog: [...(leave.auditLog || []), {
        action: 'unmark_rejected', by: appUser?.uid ?? '', byName: appUser?.name ?? 'Somebody', at: Date.now()
      }],
    })
    await tellOfficer(leave,
      `${who()} kept the ${dayWord(leave)} leave on ${leave.date}. `
      + 'Speak to them if you think that is wrong.')
  }

  const handleAddHoliday = async () => {
    if (!newHolidayName.trim()) { await showAlert('Name needed', 'Enter a name for the holiday.'); return }
    if (!newHolidayDate) { await showAlert('Date needed', 'Pick the date of the holiday.'); return }
    if (holidays.some(h => h.date === newHolidayDate)) {
      await showAlert('Already marked', `${longDate(newHolidayDate)} is already a holiday.`); return
    }
    setAddingHoliday(true)
    try {
      await addDoc(collection(db, 'holidays'), {
        name: newHolidayName.trim(), date: newHolidayDate,
        createdBy: appUser?.uid ?? '', createdByName: appUser?.name ?? 'Somebody', createdAt: Date.now(),
      })
      // Automatic absences already written for the day are cancelled: a
      // holiday means no work, so there was nothing to be absent from.
      const autos = (await getDocs(query(collection(db, 'leave_records'), where('date', '==', newHolidayDate))))
        .docs.filter(d => d.data().autoMarked === true && ['active', 'unmark_requested'].includes(d.data().status))
      if (autos.length) {
        const batch = writeBatch(db)
        for (const d of autos) batch.update(d.ref, {
          status: 'removed',
          auditLog: [...(d.data().auditLog || []), {
            action: 'holiday_declared', by: appUser?.uid ?? '', byName: appUser?.name ?? 'Somebody', at: Date.now(),
          }],
        })
        await batch.commit()
      }
      setNewHolidayName('')
      setNewHolidayDate(localDateStr())
    } finally { setAddingHoliday(false) }
  }

  const handleDeleteHoliday = async (h: Holiday) => {
    const ok = await showConfirm('Remove this holiday?', `${h.name} on ${longDate(h.date)}.`, 'Remove')
    if (!ok) return
    await deleteDoc(doc(db, 'holidays', h.id!))
  }

  const tabFiltered = shown.filter(l => {
    if (l.status === 'removed' || l.status === 'rejected') return false
    if (when === 'day') return l.date === leaveDay
    if (when === 'month') return l.date.startsWith(leaveMonth)
    return true
  })

  const displayed = selectedPerson === 'all' ? tabFiltered : tabFiltered.filter(l => l.uid === selectedPerson)

  /**
   * Leave counted in days, not records: a half day is half, two half days are
   * one, a day with two records on it counts once, and leave on a Sunday or a
   * holiday counts nothing. Leave under appeal still stands until decided.
   */
  const standingLeave = shown.filter(l => l.status === 'active' || l.status === 'unmark_requested')
  const countOf = (f: (l: LeaveRecord) => boolean) => leaveDaysOf(standingLeave.filter(f), holidays)
  const dayCount = new Set(standingLeave.filter(l => l.date === leaveDay).map(l => l.uid)).size
  const monthLeave = countOf(l => l.date.startsWith(leaveMonth))
  const allLeave = countOf(() => true)
  const breakdown = (c: { full: number; half: number; absent: number }) => [
    c.full && `${c.full} full day${c.full > 1 ? 's' : ''}`,
    c.half && `${c.half} half day${c.half > 1 ? 's' : ''}`,
    c.absent && `${c.absent} absent`,
  ].filter(Boolean).join(' · ') || 'None'
  const dayOff = dayOffLabel(leaveDay, holidayMap)
  const monthName = new Date(leaveMonth + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  const monthEnd = (() => { const [y, m] = leaveMonth.split('-').map(Number); return localDateStr(new Date(y, m, 0)) })()
  const stepMonth = (n: number) => {
    const [y, m] = leaveMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + n, 1)
    setLeaveMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const dayPending = [...pendingApproval, ...pendingUnmark].filter(l => l.date === leaveDay)
  const dayWords = leaveDay === today ? 'today' : `on ${longDate(leaveDay)}`
  const totalPending = pendingApproval.length + pendingUnmark.length
  const waitingFor = (uid: string) => pendingApproval.some(l => l.uid === uid) || pendingUnmark.some(l => l.uid === uid)

  /**
   * The leave report: for each person in the period picked, the working days
   * there were, the leave taken in days, and how much of it they asked for
   * against how much the app marked when nobody punched in. Leave still
   * waiting on a decision is not taken yet, so it is counted on its own.
   */
  const inPeriod = (date: string) =>
    when === 'day' ? date === leaveDay : when === 'month' ? date.startsWith(leaveMonth) : true
  const workingDays = when === 'day' ? (dayOff ? 0 : 1)
    : when === 'month' ? datesOfMonth(leaveMonth).filter(d => !dayOffLabel(d, holidayMap)).length
    : null
  const reportPeople = selectedPerson === 'all' ? salesUsers : salesUsers.filter(u => u.uid === selectedPerson)
  const reportOf = (uids: Set<string>) => {
    const mine = standingLeave.filter(l => uids.has(l.uid) && inPeriod(l.date))
    return {
      taken: leaveDaysOf(mine, holidays).days,
      applied: leaveDaysOf(mine.filter(l => !l.autoMarked), holidays).days,
      automatic: leaveDaysOf(mine.filter(l => l.autoMarked), holidays).days,
      waiting: shown.filter(l => uids.has(l.uid) && inPeriod(l.date) && l.status === 'pending_approval').length,
    }
  }
  const reportRows = reportPeople.map(u => ({ user: u, ...reportOf(new Set([u.uid])) }))
  const reportTotal = reportOf(new Set(reportPeople.map(u => u.uid)))
  const periodWords = when === 'day' ? longDate(leaveDay) : when === 'month' ? monthName : 'all time'

  // A pending request, with the two decisions available on it.
  const RequestRow = ({ leave, onYes, onNo, yes, no }: {
    leave: LeaveRecord; onYes: () => void; onNo: () => void; yes: string; no: string
  }) => (
    <div style={{ borderTop: `0.5px solid ${t.border}`, padding: '16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{leave.name}</div>
          <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
            {longDate(leave.date)} · {leave.leaveType === 'half_day' ? 'Half day' : 'Full day'}
            {leave.reason ? ` · ${leave.reason}` : ''}
          </div>
          {leave.autoMarked && (
            // The difference that decides this: a leave somebody asked for is
            // a request, and one the app wrote is a guess about a person who
            // was not there to argue with it.
            <div style={{ fontSize: 12, color: t.warn, marginTop: 4, lineHeight: 1.5 }}>
              Marked automatically — no punch-in was received that day.
            </div>
          )}
          {leave.unmarkReason && (
            <div style={{ fontSize: 13, color: t.text2, marginTop: 6, lineHeight: 1.55 }}>
              {leave.name.split(' ')[0]} says: {leave.unmarkReason}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 14, flexShrink: 0 }}>
          <button className="oc-action" onClick={onYes}
            style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 400, color: t.text, cursor: 'pointer' }}>
            {yes}
          </button>
          <button className="oc-action" onClick={onNo}
            style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 400, color: t.text3, cursor: 'pointer' }}>
            {no}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow="Team"
        title="Attendance"
        subtitle={totalPending > 0
          ? `${totalPending} request${totalPending > 1 ? 's' : ''} waiting on you`
          : 'Nothing is waiting for a decision'}
        onBack={onBack}
        divider={false}
      />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'register', label: 'Register' },
          { id: 'leave', label: 'Leave' },
          { id: 'holidays', label: 'Holidays' },
        ]}
      />

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>


        {/* ── HOLIDAYS ── */}
        {tab === 'holidays' && (
          <>
            <Section label="Add a holiday">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 460 }}>
                <input
                  value={newHolidayName}
                  onChange={e => setNewHolidayName(e.target.value)}
                  placeholder="Onam, Eid, Christmas"
                  style={inputStyle(t)}
                />
                <div className="oc-wrap" style={{ gap: 10, alignItems: 'center' }}>
                  <div style={{ flex: '1 1 150px' }}>
                    <DateInput type="date" value={newHolidayDate} onChange={setNewHolidayDate} />
                  </div>
                  <PrimaryButton onClick={handleAddHoliday} disabled={addingHoliday}>
                    {addingHoliday ? 'Adding' : 'Add'}
                  </PrimaryButton>
                </div>
              </div>
            </Section>

            <Section label="Marked holidays">
              {holidays.length === 0 ? (
                <EmptyState title="No holidays marked" body="Add the dates the team is off so leave is not counted against them." />
              ) : (
                <ScrollList count={holidays.length} label="holidays">
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {holidays.map(h => (
                    <div key={h.id} style={{ display: 'flex', alignItems: 'baseline', gap: 16, borderTop: `0.5px solid ${t.border}`, padding: '14px 0' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{h.name}</div>
                        <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>{longDate(h.date)}</div>
                      </div>
                      {h.date >= localDateStr() && (
                        <button className="oc-action" onClick={() => handleDeleteHoliday(h)}
                          style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 400, color: t.text2, cursor: 'pointer', flexShrink: 0 }}>
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                </ScrollList>
              )}
            </Section>
          </>
        )}

        {/* ── REGISTER: the requests to decide, then the team's month, a letter a day ── */}
        {tab === 'register' && (
          <>
            {totalPending > 0 && (
              <div style={{ fontSize: 13, color: t.warn }}>
                {totalPending} request{totalPending > 1 ? 's' : ''} waiting on you — approve or reject below
              </div>
            )}

            {pendingApproval.length > 0 && (
              <Section label={`Leave requests · ${pendingApproval.length}`}>
                <ScrollList count={pendingApproval.length} label="requests">
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {pendingApproval.map(leave => (
                    <RequestRow key={leave.id} leave={leave} yes="Approve" no="Reject"
                      onYes={() => handleApproveLeave(leave)} onNo={() => handleRejectLeave(leave)} />
                  ))}
                </div>
                </ScrollList>
              </Section>
            )}

            {pendingUnmark.length > 0 && (
              <Section label={`Unmark requests · ${pendingUnmark.length}`}>
                <ScrollList count={pendingUnmark.length} label="requests">
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {pendingUnmark.map(leave => (
                    <RequestRow key={leave.id} leave={leave} yes="Remove" no="Keep"
                      onYes={() => handleApproveUnmark(leave)} onNo={() => handleRejectUnmark(leave)} />
                  ))}
                </div>
                </ScrollList>
              </Section>
            )}

            <FilterBox title="Register" note="The month you pick changes everything in this box." testId="register-box">
              <AttendanceRegister reps={salesUsers} leaves={ownLeave} holidays={holidays} />
            </FilterBox>
          </>
        )}

        {/* ── LEAVE: one list, a day (today by default), a month, or everything ── */}
        {tab === 'leave' && (
          <>
            <FilterBox testId="leave-box"
              title="Leave"
              note="When and the person you pick change everything in this box.">
            <div>
              <div style={{ fontSize: 12, color: t.text3, marginBottom: 6 }}>When</div>
              <ChipGroup value={when} onChange={setWhen}
                options={[{ id: 'day', label: 'A day' }, { id: 'month', label: 'A month' }, { id: 'all', label: 'Everything' }]} />
            </div>
            {when === 'day' && (
              <div style={{ maxWidth: 260 }}>
                <DayPicker value={leaveDay} onChange={setLeaveDay} ariaLabel="Leave day" />
              </div>
            )}
            {when === 'month' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button className="oc-action" aria-label="Previous month" onClick={() => stepMonth(-1)}
                    style={{ background: 'none', border: `0.5px solid ${t.border2}`, borderRadius: 6, padding: '4px 10px', color: t.text, cursor: 'pointer' }}>‹</button>
                  <span style={{ fontSize: 15, fontWeight: 500, color: t.text, minWidth: 140 }}>{monthName}</span>
                  <button className="oc-action" aria-label="Next month" onClick={() => stepMonth(1)}
                    style={{ background: 'none', border: `0.5px solid ${t.border2}`, borderRadius: 6, padding: '4px 10px', color: t.text, cursor: 'pointer' }}>›</button>
                </div>
                <HolidayNote from={leaveMonth + '-01'} to={monthEnd} />
              </div>
            )}
            {when === 'day' && dayOff ? (
              <div data-testid="leave-day-off" style={{ fontSize: 14, color: t.off, lineHeight: 1.5 }}>
                {dayOff} — a day off for everyone, so nobody is on leave {dayWords}.
              </div>
            ) : (
              <StatGrid>
                {when === 'day' && <StatCard value={dayCount} label={`On leave ${dayWords}`} />}
                {when === 'month' && <StatCard value={fmtDays(monthLeave.days)}
                  label={`Days off across the team, ${monthName}`} context={breakdown(monthLeave)}
                  explain="Every person's leave added up, in days. A full day of leave or an absence is one, a half day is half — two half days make one day. Sundays and holidays are not counted." />}
                {when === 'month' && <StatCard value={new Set(standingLeave.filter(l => l.date.startsWith(leaveMonth)).map(l => l.uid)).size} label="People who took leave" />}
                {when === 'all' && <StatCard value={fmtDays(allLeave.days)}
                  label="Days off across the team, all time" context={breakdown(allLeave)}
                  explain="Every person's leave on record added up, in days. A full day of leave or an absence is one, a half day is half — two half days make one day. Sundays and holidays are not counted." />}
                {when === 'all' && <StatCard value={new Set(standingLeave.map(l => l.uid)).size} label="People who took leave" />}
              </StatGrid>
            )}
            {when === 'day' && (
              // The day's to-do: requests for this day still waiting on a decision.
              <Section label={`Waiting on you for this day · ${dayPending.length}`}>
                {dayPending.length === 0 ? (
                  <div data-testid="day-nothing-pending" style={{ fontSize: 13, color: t.text3 }}>
                    Nothing to decide {dayWords}.
                  </div>
                ) : (
                  <div data-testid="day-pending" style={{ borderBottom: `0.5px solid ${t.border}` }}>
                    {dayPending.map(leave => leave.status === 'pending_approval'
                      ? <RequestRow key={leave.id} leave={leave} yes="Approve" no="Reject"
                          onYes={() => handleApproveLeave(leave)} onNo={() => handleRejectLeave(leave)} />
                      : <RequestRow key={leave.id} leave={leave} yes="Remove" no="Keep"
                          onYes={() => handleApproveUnmark(leave)} onNo={() => handleRejectUnmark(leave)} />)}
                  </div>
                )}
              </Section>
            )}
            {when !== 'day' && (
            <Section label={`Team · ${salesUsers.length}`}
              right={salesUsers.length > 0 && <ShowHide open={teamOpen} onToggle={() => setTeamOpen(o => !o)} what="team" testId="team-toggle" />}>
              {salesUsers.length === 0 ? (
                <EmptyState title="No sales staff yet" body="Approve a sales account and their leave will be tracked here." />
              ) : teamOpen && (
                <ScrollList count={salesUsers.length} label="people">
                <div data-testid="team-list" style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {salesUsers.map(u => {
                    const theirs = (f: (l: LeaveRecord) => boolean) => countOf(l => l.uid === u.uid && f(l)).days
                    const total = theirs(() => true)
                    const monthLeaves = theirs(l => l.date.startsWith(month))
                    const inMonth = theirs(l => l.date.startsWith(leaveMonth))
                    const dd = (n: number) => `${fmtDays(n)} day${n === 1 ? '' : 's'}`
                    const status = waitingFor(u.uid) ? 'Request waiting'
                      : when === 'month' ? `${dd(inMonth)} in ${monthName.split(' ')[0]}`
                        : `${dd(total)} in total`
                    return (
                      <div key={u.uid} style={{ display: 'flex', alignItems: 'baseline', gap: 16, borderTop: `0.5px solid ${t.border}`, padding: '14px 0' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>
                            {u.name}
                            {u.role === 'sales_manager' && <span style={{ fontSize: 12, fontWeight: 400, color: t.text3 }}> · Sales manager</span>}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                            {dd(monthLeaves)} this month · {dd(total)} in total
                          </div>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 400, whiteSpace: 'nowrap',
                                      color: waitingFor(u.uid) ? t.warn : t.text2 }}>
                          {status}
                        </div>
                      </div>
                    )
                  })}
                </div>
                </ScrollList>
              )}
            </Section>
            )}

            <div data-testid="records-card" style={{ border: `0.5px solid ${t.border2}`, borderRadius: 8, padding: 16,
                                                     background: t.bg2, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>Records</div>
                  <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>
                    Leave report and every record, {periodWords}
                  </div>
                </div>
                <ShowHide open={recordsOpen} onToggle={() => setRecordsOpen(o => !o)} testId="records-toggle" />
              </div>
              {recordsOpen && (<>
              {salesUsers.length > 0 && (
                <div>
                  <ChipGroup
                    value={selectedPerson}
                    onChange={setSelectedPerson}
                    options={[{ id: 'all', label: 'Everyone' }, ...salesUsers.map(u => ({ id: u.uid, label: u.name }))]}
                  />
                </div>
              )}

              {reportPeople.length > 0 && (
                <div data-testid="leave-report">
                  <div style={{ marginBottom: 8 }}><Eyebrow>Leave report · {periodWords}</Eyebrow></div>
                  <div className="oc-scroll-x" style={{ border: `0.5px solid ${t.border}`, borderRadius: 6,
                                                        ...(reportRows.length > 10 ? { maxHeight: 460, overflowY: 'auto' } : {}) }}>
                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, minWidth: 560 }}>
                      <thead>
                        <tr>
                          {[['Person', ''],
                            ['Working days', 'Days the team was due to work in the period — not Sundays, not holidays'],
                            ['Leave taken', 'Days off in total: a full day or an absence is one, a half day is half, so two half days are one'],
                            ['Applied', 'Leave the person asked for and a manager approved, in days'],
                            ['Automatic', 'Leave the app marked because there was no punch-in, in days'],
                            ['Waiting', 'Requests not decided yet — not counted as taken'],
                          ].map(([h, title], i) => (
                            <th key={h} title={title || undefined} style={{
                              position: 'sticky', top: 0, background: t.bg2, zIndex: 1,
                              textAlign: i === 0 ? 'left' : 'right', padding: '9px 10px', fontSize: 11, fontWeight: 400,
                              letterSpacing: '0.06em', textTransform: 'uppercase', color: t.text3,
                              borderBottom: `0.5px solid ${t.border}`, whiteSpace: 'nowrap',
                            }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {reportRows.map(r => (
                          <tr key={r.user.uid} data-testid={`leave-report-${r.user.uid}`}>
                            <td style={reportCell(t, 'left')}>
                              <span style={{ fontWeight: 500, color: t.text }}>{r.user.name}</span>
                              {r.user.role === 'sales_manager' && <span style={{ fontSize: 12, color: t.text3 }}> · Sales manager</span>}
                            </td>
                            <td style={reportCell(t)}>{workingDays ?? '—'}</td>
                            <td style={{ ...reportCell(t), fontWeight: 600, color: r.taken ? t.text : t.text3 }}>{fmtDays(r.taken)}</td>
                            <td style={reportCell(t)}>{fmtDays(r.applied)}</td>
                            <td style={{ ...reportCell(t), color: r.automatic ? t.warn : t.text3 }}>{fmtDays(r.automatic)}</td>
                            <td style={{ ...reportCell(t), color: r.waiting ? t.warn : t.text3 }}>{r.waiting}</td>
                          </tr>
                        ))}
                      </tbody>
                      {reportRows.length > 1 && (
                        <tfoot>
                          <tr data-testid="leave-report-total">
                            <td style={{ ...reportCell(t, 'left'), fontWeight: 500, color: t.text, borderBottom: 'none' }}>
                              Everyone · {reportRows.length}
                            </td>
                            <td style={{ ...reportCell(t), borderBottom: 'none' }}>
                              {workingDays === null ? '—' : workingDays * reportRows.length}
                            </td>
                            <td style={{ ...reportCell(t), fontWeight: 600, color: t.text, borderBottom: 'none' }}>{fmtDays(reportTotal.taken)}</td>
                            <td style={{ ...reportCell(t), borderBottom: 'none' }}>{fmtDays(reportTotal.applied)}</td>
                            <td style={{ ...reportCell(t), borderBottom: 'none' }}>{fmtDays(reportTotal.automatic)}</td>
                            <td style={{ ...reportCell(t), borderBottom: 'none' }}>{reportTotal.waiting}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                  <div style={{ fontSize: 12, color: t.text3, marginTop: 8, lineHeight: 1.6 }}>
                    A full day of leave or an absence counts one, a half day counts half — two half days are one day.
                    Sundays and holidays are never counted.
                    {workingDays === null && ' Working days are shown for a day or a month, not for everything.'}
                    {reportRows.length > 1 && workingDays !== null && ' The total row adds up the working days of everyone listed.'}
                  </div>
                </div>
              )}

              {displayed.length === 0 ? (
                <EmptyState
                  title="No leave here"
                  body={when === 'day'
                    ? dayOff ? `${dayOff} — nobody needed leave.` : `Nobody is marked off ${dayWords}.`
                    : when === 'month'
                      ? `No leave was taken in ${monthName}.`
                      : 'No leave has been recorded yet.'}
                />
              ) : (
                <ScrollList count={displayed.length} label="records">
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {displayed.slice().sort((a, b) => b.markedAt - a.markedAt).map(leave => (
                    <div key={leave.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '14px 0' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{leave.name}</div>
                          <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                            {longDate(leave.date)} · {leave.leaveType === 'half_day' ? 'Half day' : 'Full day'}
                            {leave.reason ? ` · ${leave.reason}` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexShrink: 0 }}>
                          <span style={{ fontSize: 14, fontWeight: 400, whiteSpace: 'nowrap',
                                         color: leave.status === 'active' ? t.text2 : t.warn }}>
                            {STATUS_LABEL[leave.status] ?? leave.status}
                          </span>
                          {leave.auditLog && leave.auditLog.length > 0 && (
                            <button className="oc-action"
                              onClick={() => setExpandedAudit(expandedAudit === leave.id ? null : leave.id!)}
                              style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 400, color: t.text3, cursor: 'pointer' }}>
                              {expandedAudit === leave.id ? 'Hide history' : 'History'}
                            </button>
                          )}
                        </div>
                      </div>
                      {expandedAudit === leave.id && leave.auditLog && (
                        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
                          {leave.auditLog.map((entry, i) => (
                            <div key={i} style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>
                              {ACTION_LABEL[entry.action] ?? entry.action} by {entry.byName} ·{' '}
                              {new Date(entry.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                </ScrollList>
              )}
              </>)}
            </div>
            </FilterBox>
          </>
        )}
      </div>

      {modal}
    </div>
  )
}
