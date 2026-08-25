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
import {
  PageHeader, TabBar, StatGrid, StatCard, Section, EmptyState,
  ChipGroup, GhostButton, PrimaryButton, inputStyle,
} from '../../components/ui'

interface Props { onBack: () => void }

type LeaveTab = 'today' | 'month' | 'all' | 'holidays'

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
  const [tab, setTab] = useState<LeaveTab>('today')
  const [selectedPerson, setSelectedPerson] = useState<string>('all')
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
    if (tab === 'today') return l.date === today
    if (tab === 'month') return l.date.startsWith(month)
    return true
  })

  const displayed = selectedPerson === 'all' ? tabFiltered : tabFiltered.filter(l => l.uid === selectedPerson)

  const todayCount = leaveRecords.filter(l => l.date === today && l.status === 'active').length
  const monthCount = leaveRecords.filter(l => l.date.startsWith(month) && l.status === 'active').length
  const totalPending = pendingApproval.length + pendingUnmark.length

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
        eyebrow="Attendance"
        title="Leave"
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
          { id: 'today', label: 'Today' },
          { id: 'month', label: 'This month' },
          { id: 'all', label: 'All' },
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
              )}
            </Section>
          </>
        )}

        {tab !== 'holidays' && (
          <>
            <StatGrid>
              <StatCard value={todayCount} label="On leave today" />
              <StatCard value={monthCount} label="Days this month" />
              <StatCard value={totalPending} label="Waiting on you"
                context={totalPending > 0 ? 'Approve or reject below' : undefined} />
            </StatGrid>

            {pendingApproval.length > 0 && (
              <Section label={`Leave requests · ${pendingApproval.length}`}>
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {pendingApproval.map(leave => (
                    <RequestRow key={leave.id} leave={leave} yes="Approve" no="Reject"
                      onYes={() => handleApproveLeave(leave)} onNo={() => handleRejectLeave(leave)} />
                  ))}
                </div>
              </Section>
            )}

            {pendingUnmark.length > 0 && (
              <Section label={`Unmark requests · ${pendingUnmark.length}`}>
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {pendingUnmark.map(leave => (
                    <RequestRow key={leave.id} leave={leave} yes="Remove" no="Keep"
                      onYes={() => handleApproveUnmark(leave)} onNo={() => handleRejectUnmark(leave)} />
                  ))}
                </div>
              </Section>
            )}

            <Section label="Team">
              {salesUsers.length === 0 ? (
                <EmptyState title="No sales staff yet" body="Approve a sales account and their leave will be tracked here." />
              ) : (
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {salesUsers.map(u => {
                    const total = leaveRecords.filter(l => l.uid === u.uid && l.status === 'active').length
                    const monthLeaves = leaveRecords.filter(l => l.uid === u.uid && l.date.startsWith(month) && l.status === 'active').length
                    const onLeaveToday = leaveRecords.some(l => l.uid === u.uid && l.date === today && l.status === 'active')
                    const waiting = pendingApproval.some(l => l.uid === u.uid) || pendingUnmark.some(l => l.uid === u.uid)
                    return (
                      <div key={u.uid} style={{ display: 'flex', alignItems: 'baseline', gap: 16, borderTop: `0.5px solid ${t.border}`, padding: '14px 0' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{u.name}</div>
                          <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                            {monthLeaves} this month · {total} in total
                          </div>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 400, whiteSpace: 'nowrap',
                                      color: waiting ? t.warn : t.text2 }}>
                          {waiting ? 'Request waiting' : onLeaveToday ? 'On leave today' : 'Working'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Section>

            <Section label="Records">
              {salesUsers.length > 0 && (
                <div style={{ marginBottom: 16 }}>
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
                  body={tab === 'today'
                    ? 'Nobody is marked off today.'
                    : tab === 'month'
                      ? 'No leave has been taken this month.'
                      : 'No leave has been recorded yet.'}
                />
              ) : (
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
              )}
            </Section>
          </>
        )}
      </div>

      {modal}
    </div>
  )
}
