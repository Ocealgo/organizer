import React, { useState } from 'react'
import { deleteDoc, doc, updateDoc, addDoc, collection } from 'firebase/firestore'
import { db } from '../../firebase'
import { LeaveRecord, LeaveReason, LEAVE_REASONS } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import { localMonthStr, localDateStr } from '../../utils/date'

interface Props { leaveRecords: LeaveRecord[]; onBack: () => void }

export default function LeaveHistory({ leaveRecords, onBack }: Props) {
  const { appUser } = useAuth()
  const { t, theme } = useTheme()
  const { modal, showConfirm, showAlert } = useConfirm()
  const [selectedMonth, setSelectedMonth] = useState(localMonthStr())
  const [leaveDate, setLeaveDate] = useState(localDateStr())
  const [pendingLeaveType, setPendingLeaveType] = useState<'full_day' | 'half_day' | null>(null)
  const [leaveReason, setLeaveReason] = useState<LeaveReason | ''>('')
  const [markingLeave, setMarkingLeave] = useState(false)

  const today = localDateStr()

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
      'Cancel Leave Request?',
      `${leave.date} · ${leave.leaveType === 'full_day' ? 'Full Day' : 'Half Day'}${leave.reason ? ` · ${leave.reason}` : ''} · Request will be removed.`
    )
    if (!confirmed) return
    await deleteDoc(doc(db, 'leave_records', leave.id!))
  }

  const handleMarkLeave = async (type: 'full_day' | 'half_day', reason: LeaveReason) => {
    if (!appUser || markingLeave) return
    const confirmed = await showConfirm(
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
        message: `🏖️ ${appUser.name} requested ${type === 'full_day' ? 'Full Day' : 'Half Day'} leave · ${leaveDate} · ${reason}`,
        relatedId: leaveRef.id, read: false, createdAt: Date.now(),
        toRole: 'admin_group',
      })
    } catch (e) {
      console.error('Leave request failed:', e)
      await showAlert('Failed to send request', 'Check your connection and try again.')
    } finally { setMarkingLeave(false) }
  }

  // Request revocation of an approved leave (today or future) — admin must approve
  const handleRequestRevoke = async (leave: LeaveRecord) => {
    const confirmed = await showConfirm(
      'Request Leave Cancellation?',
      `${leave.date} · ${leave.leaveType === 'full_day' ? 'Full Day' : 'Half Day'} · Admin will need to approve this cancellation.`
    )
    if (!confirmed) return
    await updateDoc(doc(db, 'leave_records', leave.id!), {
      status: 'unmark_requested',
      unmarkRequestedAt: Date.now(),
      auditLog: [...((leave as any).auditLog || []), {
        action: 'unmark_requested', by: appUser!.uid, byName: appUser!.name, at: Date.now()
      }],
    })
    await addDoc(collection(db, 'alerts'), {
      type: 'leave_requested',
      message: `🔄 ${appUser!.name} requested cancellation of ${leave.leaveType === 'full_day' ? 'Full Day' : 'Half Day'} leave on ${leave.date}`,
      relatedId: leave.id!, read: false, createdAt: Date.now(),
      toRole: 'admin_group',
    })
  }

  const statusInfo = (l: LeaveRecord) => {
    switch (l.status) {
      case 'pending_approval':  return { label: 'Pending Approval', color: '#d97706', bg: 'rgba(217,119,6,0.12)', border: 'rgba(217,119,6,0.25)' }
      case 'active':            return { label: 'Approved', color: '#16a34a', bg: 'rgba(22,163,74,0.1)', border: 'rgba(22,163,74,0.25)' }
      case 'unmark_requested':  return { label: 'Cancellation Pending', color: '#0891b2', bg: 'rgba(8,145,178,0.1)', border: 'rgba(8,145,178,0.25)' }
      default:                  return { label: l.status, color: t.text3, bg: t.bg3, border: t.border }
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <div style={{ background: 'linear-gradient(135deg,#0d3d2e,#1a5c42)', padding: '20px 20px 20px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#6ee7b7', padding: '6px 14px', borderRadius: 20, fontSize: 13, marginBottom: 14 }}>← Back</button>
        <div style={{ color: '#6ee7b7', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>My Leave</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>Leave History</div>
          {pendingCount > 0 && (
            <span style={{ background: 'rgba(217,119,6,0.3)', color: '#fde68a', fontSize: 12, fontWeight: 800, padding: '3px 10px', borderRadius: 20, border: '1px solid rgba(217,119,6,0.4)' }}>
              {pendingCount} pending
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: '8px 12px', marginTop: 14 }}>
          <button onClick={() => changeMonth(-1)}
            style={{ background: 'none', border: 'none', color: '#6ee7b7', fontSize: 20, padding: '0 8px', cursor: 'pointer', lineHeight: 1 }}>‹</button>
          <div style={{ flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 700, color: '#fff' }}>{monthLabel}</div>
          <button onClick={() => changeMonth(1)}
            style={{ background: 'none', border: 'none', color: '#6ee7b7', fontSize: 20, padding: '0 8px', cursor: 'pointer', lineHeight: 1 }}>›</button>
        </div>
      </div>

      <div style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {monthRecords.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🏖️</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.text2 }}>No leaves this month</div>
            <div style={{ fontSize: 13, color: t.text3, marginTop: 6 }}>Use the arrows to navigate months</div>
          </div>
        ) : monthRecords.map(l => {
          const s = statusInfo(l)
          const dayLabel = new Date(l.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
          const isFutureOrToday = l.date >= today
          return (
            <div key={l.id} style={{ background: t.card, borderRadius: 14, padding: '14px 16px', border: `1px solid ${s.border}` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: t.text }}>{dayLabel}</div>
                  <div style={{ fontSize: 13, color: t.text2, marginTop: 3 }}>
                    {l.leaveType === 'full_day' ? '🏖️ Full Day' : '🌓 Half Day'}
                    {l.reason && <span style={{ color: t.text3 }}> · {l.reason}</span>}
                  </div>
                </div>
                <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, flexShrink: 0 }}>
                  {s.label}
                </span>
              </div>

              {/* Pending approval — can cancel directly */}
              {l.status === 'pending_approval' && (
                <button onClick={() => handleCancelPending(l)}
                  style={{ width: '100%', marginTop: 12, background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.2)', color: '#dc2626', borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 700 }}>
                  Cancel Request
                </button>
              )}

              {/* Approved leave — today or future — can request revocation */}
              {l.status === 'active' && isFutureOrToday && (
                <button onClick={() => handleRequestRevoke(l)}
                  style={{ width: '100%', marginTop: 12, background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.2)', color: '#dc2626', borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 700 }}>
                  Request Cancellation
                </button>
              )}

              {/* Cancellation already requested */}
              {l.status === 'unmark_requested' && (
                <div style={{ marginTop: 10, background: 'rgba(8,145,178,0.08)', border: '1px solid rgba(8,145,178,0.2)', borderRadius: 10, padding: '9px 12px', fontSize: 12, color: '#0891b2', fontWeight: 600 }}>
                  ⏳ Cancellation request sent — waiting for admin approval
                </div>
              )}
            </div>
          )
        })}
      </div>
      {/* Request Leave */}
      <div style={{ padding: '0 16px 40px' }}>
        <div style={{ borderTop: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`, paddingTop: 16 }}>
          <div style={{ fontSize: 13, color: theme === 'dark' ? 'rgba(255,255,255,0.7)' : '#6b7280', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, textAlign: 'center' }}>Request Leave</div>
          {!pendingLeaveType ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPendingLeaveType('full_day')} disabled={markingLeave}
                style={{ flex: 1, background: theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)'}`, color: theme === 'dark' ? '#fff' : '#374151', borderRadius: 12, padding: '11px', fontSize: 14, fontWeight: 700 }}>
                Full Day
              </button>
              <button onClick={() => setPendingLeaveType('half_day')} disabled={markingLeave}
                style={{ flex: 1, background: theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)'}`, color: theme === 'dark' ? '#fff' : '#374151', borderRadius: 12, padding: '11px', fontSize: 14, fontWeight: 700 }}>
                Half Day
              </button>
            </div>
          ) : (
            <div style={{ background: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: 14, padding: 14, border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: theme === 'dark' ? '#fff' : t.text, marginBottom: 10 }}>
                {pendingLeaveType === 'full_day' ? 'Full Day' : 'Half Day'} Leave Request · <span style={{ color: theme === 'dark' ? 'rgba(255,255,255,0.55)' : t.text3, fontWeight: 400 }}>Select a reason</span>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: theme === 'dark' ? 'rgba(255,255,255,0.55)' : t.text3, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Leave Date</div>
                <input type="date" value={leaveDate} min={today} onChange={e => setLeaveDate(e.target.value)}
                  style={{ width: '100%', background: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)', border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)'}`, borderRadius: 10, padding: '9px 12px', color: theme === 'dark' ? '#fff' : '#374151', fontSize: 14, outline: 'none', boxSizing: 'border-box', colorScheme: theme === 'dark' ? 'dark' : 'light' }} />
                {leaveDate < today && (
                  <div style={{ fontSize: 12, color: '#ef4444', marginTop: 5, fontWeight: 600 }}>
                    🔴 Cannot apply leave for a past date
                  </div>
                )}
                {leaveDate >= today && new Date(leaveDate + 'T00:00:00').getDay() === 0 && (
                  <div style={{ fontSize: 12, color: '#ef4444', marginTop: 5, fontWeight: 600 }}>
                    🔴 Sunday is a day off — leave cannot be applied
                  </div>
                )}
                {leaveDate >= today && new Date(leaveDate + 'T00:00:00').getDay() !== 0 && leaveRecords.some(l => l.date === leaveDate && l.status !== 'removed' && l.status !== 'rejected') && (
                  <div style={{ fontSize: 12, color: '#dc2626', marginTop: 5, fontWeight: 600 }}>
                    ⚠️ Leave already submitted for this date
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {LEAVE_REASONS.map(r => (
                  <button key={r} onClick={() => setLeaveReason(r)}
                    style={{ background: leaveReason === r ? (theme === 'dark' ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.12)') : (theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'transparent'), border: `1px solid ${leaveReason === r ? '#818cf8' : (theme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)')}`, color: leaveReason === r ? (theme === 'dark' ? '#fff' : '#4f46e5') : (theme === 'dark' ? '#fff' : '#374151'), borderRadius: 20, padding: '7px 15px', fontSize: 13, fontWeight: 700 }}>
                    {r}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setPendingLeaveType(null); setLeaveReason('') }}
                  style={{ flex: 1, background: theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.1)'}`, color: theme === 'dark' ? '#fff' : '#374151', borderRadius: 10, padding: '11px', fontSize: 14, fontWeight: 700 }}>
                  Cancel
                </button>
                <button onClick={() => leaveReason && handleMarkLeave(pendingLeaveType, leaveReason as LeaveReason)}
                  disabled={!leaveReason || markingLeave || leaveDate < today || new Date(leaveDate + 'T00:00:00').getDay() === 0 || leaveRecords.some(l => l.date === leaveDate && l.status !== 'removed' && l.status !== 'rejected')}
                  style={{ flex: 2, background: leaveReason ? 'rgba(99,102,241,0.2)' : (theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'transparent'), border: `1px solid ${leaveReason ? '#818cf8' : (theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')}`, color: leaveReason ? (theme === 'dark' ? '#fff' : '#4f46e5') : (theme === 'dark' ? 'rgba(255,255,255,0.35)' : t.text3), borderRadius: 10, padding: '11px', fontSize: 14, fontWeight: 700, opacity: (!leaveReason || markingLeave || leaveDate < today || new Date(leaveDate + 'T00:00:00').getDay() === 0 || leaveRecords.some(l => l.date === leaveDate && l.status !== 'removed' && l.status !== 'rejected')) ? 0.5 : 1 }}>
                  {markingLeave ? 'Sending…' : 'Send Request'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {modal}
    </div>
  )
}
