import { useState, useEffect, useMemo } from 'react'
import { deleteDoc, doc, updateDoc, addDoc, collection, query, where } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import { LeaveRecord, LeaveReason, LEAVE_REASONS, DutySession, Holiday } from '../../types'
import AttendanceCalendar from '../../attendance/AttendanceCalendar'
import { monthOf, Day } from '../../attendance/attendance'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import { localMonthStr, localDateStr, isSunday } from '../../utils/date'
import DateInput from '../../components/DateInput'
import {
  PageHeader, Section, EmptyState, ChipGroup, Note,
  GhostButton, PrimaryButton, inputStyle,
} from '../../components/ui'

interface Props { leaveRecords: LeaveRecord[]; onBack: () => void }

const STATUS_LABEL: Record<string, string> = {
  pending_approval: 'Awaiting approval',
  active: 'Approved',
  unmark_requested: 'Cancellation requested',
}

export default function LeaveHistory({ leaveRecords, onBack }: Props) {
  const { appUser } = useAuth()
  const { t } = useTheme()
  const { modal, showConfirm, showAlert } = useConfirm()
  const [selectedMonth, setSelectedMonth] = useState(localMonthStr())
  const [leaveDate, setLeaveDate] = useState(localDateStr())
  const [pendingLeaveType, setPendingLeaveType] = useState<'full_day' | 'half_day' | null>(null)
  const [leaveReason, setLeaveReason] = useState<LeaveReason | ''>('')
  const [markingLeave, setMarkingLeave] = useState(false)
  /** Which leave the officer is appealing, and what they say happened. */
  const [revokeFor, setRevokeFor] = useState<string | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [revokeBlocked, setRevokeBlocked] = useState<string | null>(null)

  const today = localDateStr()

  // ── attendance: the month's duty days and the holidays ────────────────────
  const [sessions, setSessions] = useState<DutySession[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  useEffect(() => {
    if (!appUser) return
    // Own sessions only — the shape the rules allow a rep to ask for.
    return onSnapshot(query(collection(db, 'duty_sessions'), where('uid', '==', appUser.uid)),
      s => setSessions(s.docs.map(d => ({ id: d.id, ...d.data() } as DutySession))),
      err => console.error('[LeaveHistory] sessions listener failed', err))
  }, [appUser])
  useEffect(() => onSnapshot(collection(db, 'holidays'),
    s => setHolidays(s.docs.map(d => ({ id: d.id, ...d.data() } as Holiday))),
    err => console.error('[LeaveHistory] holidays listener failed', err)), [])
  const days = useMemo(
    () => appUser ? monthOf(appUser.uid, selectedMonth, today, sessions, leaveRecords, holidays) : [],
    [appUser, selectedMonth, today, sessions, leaveRecords, holidays])

  /** The calendar's appeal opens the same appeal the list below has. */
  const appealFromCalendar = (d: Day) => {
    if (!d.leave?.id) return
    setRevokeFor(d.leave.id); setRevokeReason(''); setRevokeBlocked(null)
    setTimeout(() => document.getElementById(`leave-${d.leave!.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
  }

  const changeMonth = (delta: number) => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const monthLabel = new Date(selectedMonth + '-02').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  const monthRecords = leaveRecords
    .filter(l => l.date.startsWith(selectedMonth) && l.status !== 'removed' && l.status !== 'rejected')
    .sort((a, b) => a.date.localeCompare(b.date))

  const pendingCount = leaveRecords.filter(l => l.status === 'pending_approval').length

  // Cancel a pending_approval leave — not yet seen by admin, safe to delete
  const handleCancelPending = async (leave: LeaveRecord) => {
    const confirmed = await showConfirm(
      'Withdraw this request?',
      `${leave.date} · ${leave.leaveType === 'full_day' ? 'Full day' : 'Half day'}${leave.reason ? ` · ${leave.reason}` : ''}\n\nThe request is removed and nobody is notified.`,
      'Withdraw',
    )
    if (!confirmed) return
    await deleteDoc(doc(db, 'leave_records', leave.id!))
  }

  const handleMarkLeave = async (type: 'full_day' | 'half_day', reason: LeaveReason) => {
    if (!appUser || markingLeave) return
    const confirmed = await showConfirm(
      `Request ${type === 'full_day' ? 'a full day' : 'a half day'} off?`,
      `${leaveDate} · ${reason}\n\nAn admin approves it before it takes effect.`,
      'Send request',
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
        message: `${appUser.name} requested ${type === 'full_day' ? 'a full day' : 'a half day'} off on ${leaveDate} · ${reason}`,
        relatedId: leaveRef.id, read: false, createdAt: Date.now(),
        toRole: 'admin_group',
      })
    } catch (e) {
      console.error('Leave request failed:', e)
      await showAlert('Could not send the request', 'Check your connection and try again.')
    } finally { setMarkingLeave(false) }
  }

  /**
   * Ask for a leave to be taken off, saying why.
   *
   * The reason is the whole point when the leave was marked automatically. The
   * app wrote that record because no punch-in arrived, which it cannot tell
   * apart from a dead battery, a godown with no signal, or a meeting somebody
   * arranged by phone. The officer is the only person who knows which, and a
   * manager deciding without that is guessing twice.
   */
  const handleRequestRevoke = async (leave: LeaveRecord) => {
    const why = revokeReason.trim()
    if (leave.autoMarked && !why) {
      setRevokeBlocked('Say what happened — your manager decides on this.')
      return
    }
    setRevokeBlocked(null)
    await updateDoc(doc(db, 'leave_records', leave.id!), {
      status: 'unmark_requested',
      unmarkRequestedAt: Date.now(),
      ...(why ? { unmarkReason: why } : {}),
      auditLog: [...((leave as any).auditLog || []), {
        action: 'unmark_requested', by: appUser!.uid, byName: appUser!.name, at: Date.now()
      }],
    })
    setRevokeFor(null); setRevokeReason('')
    await addDoc(collection(db, 'alerts'), {
      type: 'leave_requested',
      message: `${appUser!.name} asked to cancel ${leave.leaveType === 'full_day' ? 'a full day' : 'a half day'} of leave on ${leave.date}`
        + (why ? ` — ${why}` : ''),
      relatedId: leave.id!, read: false, createdAt: Date.now(),
      toRole: 'admin_group',
    })
  }

  const sunday = leaveDate >= today && isSunday(leaveDate)
  const past = leaveDate < today
  const duplicate = leaveRecords.some(l =>
    l.date === leaveDate && l.status !== 'removed' && l.status !== 'rejected')
  const dateProblem = past
    ? 'Leave cannot be applied for a date that has passed.'
    : sunday
      ? 'Sunday is already a day off.'
      : duplicate
        ? 'You already have leave recorded for this date.'
        : null
  const canSend = !!leaveReason && !markingLeave && !dateProblem

  const arrow = (label: string, onClick: () => void) => (
    <button className="oc-action" onClick={onClick} aria-label={label}
      style={{ background: 'none', border: 'none', padding: '0 6px', fontSize: 18, lineHeight: 1, color: t.text2, cursor: 'pointer' }}>
      {label === 'Previous month' ? '‹' : '›'}
    </button>
  )

  return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow="Yours"
        title="Attendance"
        subtitle={pendingCount > 0
          ? `${pendingCount} request${pendingCount > 1 ? 's' : ''} awaiting approval`
          : undefined}
        onBack={onBack}
      />

      {/* A column of records, not a table — capped so the lines stay a
          readable length on a wide screen. */}
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 820 }}>

        <Section
          label={monthLabel}
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {arrow('Previous month', () => changeMonth(-1))}
              {arrow('Next month', () => changeMonth(1))}
            </div>
          }
        >
          {/* The month as the app recorded it: worked, half, absent, leave. */}
          <div style={{ marginBottom: 22 }}>
            <AttendanceCalendar days={days} onAppeal={appealFromCalendar} />
            <div style={{ fontSize: 12, color: t.text3, marginTop: 10, lineHeight: 1.6 }}>
              Attendance as the app recorded it. No punch-in by the morning cutoff marks half a day,
              and none by the afternoon marks the day absent — both automatically, and both can be
              appealed. Tap a day to see what it was.
            </div>
          </div>
          <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
                        color: t.text3, marginBottom: 8 }}>Leave this month</div>
          {monthRecords.length === 0 ? (
            <EmptyState title="No leave this month" body="Use the arrows above to look at another month." />
          ) : (
            <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
              {monthRecords.map(l => {
                const dayLabel = new Date(l.date + 'T00:00:00')
                  .toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
                /**
                 * Whether this leave can still be argued with.
                 *
                 * A leave the officer asked for themselves is theirs to
                 * withdraw while it is still ahead of them; once the day has
                 * passed there is nothing left to cancel.
                 *
                 * An automatic one is the opposite case and used to be treated
                 * the same, which closed the appeal at midnight. The sweep
                 * marks the day it happened, and the reasons it exists to
                 * handle — a flat battery, no signal in a godown — are exactly
                 * the reasons the officer does not see the notification until
                 * the next morning. So the day the app decided they were absent
                 * was the only day they could say otherwise, and anyone it was
                 * actually wrong about had already missed it.
                 *
                 * A manager still decides. This only keeps the question
                 * askable.
                 */
                const canAppeal = l.autoMarked === true || l.date >= today
                return (
                  <div key={l.id} id={`leave-${l.id}`} style={{ borderTop: `0.5px solid ${t.border}`, padding: '14px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{dayLabel}</div>
                        <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                          {l.leaveType === 'full_day' ? 'Full day' : 'Half day'}
                          {l.reason ? ` · ${l.reason}` : ''}
                        </div>
                        {l.autoMarked && (
                          // Said plainly, because this is the app's conclusion
                          // rather than anybody's decision, and the officer is
                          // the only one who can correct it.
                          <div style={{ fontSize: 12, color: t.warn, marginTop: 4, lineHeight: 1.5 }}>
                            Marked automatically — no punch-in was received.
                            {l.status === 'active' && ' If that is wrong, cancel it and say what happened.'}
                          </div>
                        )}
                        {l.unmarkReason && (
                          <div style={{ fontSize: 12, color: t.text3, marginTop: 4, lineHeight: 1.5 }}>
                            You said: {l.unmarkReason}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexShrink: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 400, whiteSpace: 'nowrap',
                                       color: l.status === 'active' ? t.text2 : t.warn }}>
                          {STATUS_LABEL[l.status] ?? l.status}
                        </span>
                        {l.status === 'pending_approval' && (
                          <button className="oc-action" onClick={() => handleCancelPending(l)}
                            style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 400, color: t.text3, cursor: 'pointer' }}>
                            Withdraw
                          </button>
                        )}
                        {l.status === 'active' && canAppeal && (
                          <button className="oc-action"
                            onClick={() => {
                              // An automatic one needs an explanation, so it
                              // opens a box. One the officer asked for
                              // themselves does not, and goes straight through.
                              if (l.autoMarked) {
                                setRevokeFor(l.id!); setRevokeReason(''); setRevokeBlocked(null)
                              } else {
                                void handleRequestRevoke(l)
                              }
                            }}
                            style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, fontWeight: 400, color: t.text3, cursor: 'pointer' }}>
                            {/* The same words the home screen uses for the
                                same button. "Cancel" is what you do to a plan
                                you made; this is disputing somebody else's
                                conclusion about you. */}
                            {l.autoMarked ? 'This is wrong' : 'Cancel'}
                          </button>
                        )}
                      </div>
                    </div>

                    {revokeFor === l.id && (
                      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <input
                          value={revokeReason}
                          onChange={e => setRevokeReason(e.target.value)}
                          placeholder="Phone battery died · no signal at the godown · meeting arranged by phone"
                          style={inputStyle(t)}
                        />
                        {revokeBlocked && (
                          <div style={{ fontSize: 13, color: t.warn }}>{revokeBlocked}</div>
                        )}
                        <div className="oc-wrap" style={{ gap: 10 }}>
                          <GhostButton onClick={() => void handleRequestRevoke(l)}>
                            Send to my manager
                          </GhostButton>
                          <GhostButton onClick={() => { setRevokeFor(null); setRevokeBlocked(null) }}>
                            Cancel
                          </GhostButton>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Section>

        <Section label="Request leave">
          {!pendingLeaveType ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <GhostButton onClick={() => setPendingLeaveType('full_day')} disabled={markingLeave}>
                Full day
              </GhostButton>
              <GhostButton onClick={() => setPendingLeaveType('half_day')} disabled={markingLeave}>
                Half day
              </GhostButton>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 460 }}>
              <div style={{ fontSize: 14, fontWeight: 400, color: t.text2 }}>
                {pendingLeaveType === 'full_day' ? 'A full day off' : 'A half day off'}. Pick the date and a reason.
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 400, color: t.text, marginBottom: 7 }}>Date</div>
                <DateInput type="date" value={leaveDate} min={today} onChange={setLeaveDate} />
                {dateProblem && (
                  <div style={{ fontSize: 12, color: t.warn, marginTop: 6 }}>{dateProblem}</div>
                )}
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 400, color: t.text, marginBottom: 7 }}>Reason</div>
                <ChipGroup
                  options={LEAVE_REASONS as readonly LeaveReason[]}
                  value={leaveReason as LeaveReason}
                  onChange={setLeaveReason}
                />
              </div>

              <Note>An admin approves the request before it takes effect.</Note>

              <div style={{ display: 'flex', gap: 10 }}>
                <PrimaryButton
                  onClick={() => leaveReason && handleMarkLeave(pendingLeaveType, leaveReason as LeaveReason)}
                  disabled={!canSend}>
                  {markingLeave ? 'Sending' : 'Send request'}
                </PrimaryButton>
                <GhostButton onClick={() => { setPendingLeaveType(null); setLeaveReason('') }}>
                  Cancel
                </GhostButton>
              </div>
            </div>
          )}
        </Section>
      </div>
      {modal}
    </div>
  )
}
