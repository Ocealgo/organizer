import { useState, useEffect } from 'react'
import { collection, updateDoc, doc, addDoc, deleteDoc, query, orderBy } from 'firebase/firestore'
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
import { FilterBox, ScrollList } from '../../components/FilterBox'
import {
  PageHeader, TabBar, StatGrid, StatCard, Section, EmptyState,
  ChipGroup, GhostButton, PrimaryButton, inputStyle,
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
}

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
  const [when, setWhen] = useState<LeaveWhen>('day')
  const [leaveDay, setLeaveDay] = useState(localDateStr())
  const [leaveMonth, setLeaveMonth] = useState(localMonthStr())
  const [expandedAudit, setExpandedAudit] = useState<string | null>(null)
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [newHolidayName, setNewHolidayName] = useState('')
  const [newHolidayDate, setNewHolidayDate] = useState(localDateStr())
  const [addingHoliday, setAddingHoliday] = useState(false)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'leave_records'), snap => {
      setLeaveRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRecord)))
    })
    const u2 = onSnapshot(collection(db, 'users'), snap => {
      setSalesUsers(snap.docs
        .map(d => ({ uid: d.id, ...d.data() } as AppUser))
        .filter(u => u.status === 'approved' && (u.role === 'offline_sales' || u.role === 'online_sales')))
    })
    const u3 = onSnapshot(query(collection(db, 'holidays'), orderBy('date')), snap => {
      setHolidays(snap.docs.map(d => ({ id: d.id, ...d.data() } as Holiday)))
    })
    return () => { u1(); u2(); u3() }
  }, [])

  const today = todayStr()
  const month = thisMonth()

  const pendingApproval = leaveRecords.filter(l => l.status === 'pending_approval')
  const pendingUnmark = leaveRecords.filter(l => l.status === 'unmark_requested')

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
      setNewHolidayName('')
      setNewHolidayDate(localDateStr())
    } finally { setAddingHoliday(false) }
  }

  const handleDeleteHoliday = async (h: Holiday) => {
    const ok = await showConfirm('Remove this holiday?', `${h.name} on ${longDate(h.date)}.`, 'Remove')
    if (!ok) return
    await deleteDoc(doc(db, 'holidays', h.id!))
  }

  const tabFiltered = leaveRecords.filter(l => {
    if (l.status === 'removed' || l.status === 'rejected') return false
    if (when === 'day') return l.date === leaveDay
    if (when === 'month') return l.date.startsWith(leaveMonth)
    return true
  })

  const displayed = selectedPerson === 'all' ? tabFiltered : tabFiltered.filter(l => l.uid === selectedPerson)

  const active = leaveRecords.filter(l => l.status === 'active')
  const dayCount = active.filter(l => l.date === leaveDay).length
  const monthCount = active.filter(l => l.date.startsWith(leaveMonth)).length
  const holidayMap = new Map(holidays.map(h => [h.date, h.name]))
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
              <AttendanceRegister reps={salesUsers} leaves={leaveRecords} holidays={holidays} />
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
                {when === 'month' && <StatCard value={monthCount} label={`Leave days in ${monthName}`} />}
                {when === 'month' && <StatCard value={new Set(active.filter(l => l.date.startsWith(leaveMonth)).map(l => l.uid)).size} label="People who took leave" />}
                {when === 'all' && <StatCard value={active.length} label="Leave days on record" />}
                {when === 'all' && <StatCard value={new Set(active.map(l => l.uid)).size} label="People who took leave" />}
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
            <Section label="Team">
              {salesUsers.length === 0 ? (
                <EmptyState title="No sales staff yet" body="Approve a sales account and their leave will be tracked here." />
              ) : (
                <ScrollList count={salesUsers.length} label="people">
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {salesUsers.map(u => {
                    const total = leaveRecords.filter(l => l.uid === u.uid && l.status === 'active').length
                    const monthLeaves = leaveRecords.filter(l => l.uid === u.uid && l.date.startsWith(month) && l.status === 'active').length
                    const inMonth = active.filter(l => l.uid === u.uid && l.date.startsWith(leaveMonth)).length
                    const status = waitingFor(u.uid) ? 'Request waiting'
                      : when === 'month' ? `${inMonth} in ${monthName.split(' ')[0]}`
                        : `${total} in total`
                    return (
                      <div key={u.uid} style={{ display: 'flex', alignItems: 'baseline', gap: 16, borderTop: `0.5px solid ${t.border}`, padding: '14px 0' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{u.name}</div>
                          <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                            {monthLeaves} this month · {total} in total
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

            <Section label="Records">
              {salesUsers.length > 0 && (
                <div>
                  <ChipGroup
                    value={selectedPerson}
                    onChange={setSelectedPerson}
                    options={[{ id: 'all', label: 'Everyone' }, ...salesUsers.map(u => ({ id: u.uid, label: u.name }))]}
                  />
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
            </Section>
            </FilterBox>
          </>
        )}
      </div>

      {modal}
    </div>
  )
}
