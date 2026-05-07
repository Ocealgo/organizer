import React, { useState } from 'react'
import { deleteDoc, doc, updateDoc, addDoc, collection } from 'firebase/firestore'
import { db } from '../../firebase'
import { LeaveRecord } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import { localMonthStr, localDateStr } from '../../utils/date'

interface Props { leaveRecords: LeaveRecord[]; onBack: () => void }

export default function LeaveHistory({ leaveRecords, onBack }: Props) {
  const { appUser } = useAuth()
  const { t } = useTheme()
  const { modal, showConfirm } = useConfirm()
  const [selectedMonth, setSelectedMonth] = useState(localMonthStr())

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

  const handleCancelPending = async (leave: LeaveRecord) => {
    const confirmed = await showConfirm(
      'Cancel Leave Request?',
      `${leave.date} · ${leave.leaveType === 'full_day' ? 'Full Day' : 'Half Day'}${leave.reason ? ` · ${leave.reason}` : ''} · Request will be removed.`
    )
    if (!confirmed) return
    await deleteDoc(doc(db, 'leave_records', leave.id!))
  }

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
      message: `${appUser!.name} requested cancellation of ${leave.leaveType === 'full_day' ? 'Full Day' : 'Half Day'} leave on ${leave.date}`,
      relatedId: leave.id!, read: false, createdAt: Date.now(),
      toRole: 'admin_group',
    })
  }

  const statusInfo = (l: LeaveRecord) => {
    switch (l.status) {
      case 'pending_approval':  return { label: 'Pending Approval', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)' }
      case 'active':            return { label: 'Approved', color: '#22c55e', bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.2)' }
      case 'unmark_requested':  return { label: 'Cancellation Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)' }
      default:                  return { label: l.status, color: t.text3, bg: t.bg3, border: t.border }
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <div style={{ background: '#000000', padding: '20px 20px 0' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, marginBottom: 16 }}>← Back</button>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>My Leave</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>Leave History</div>
          {pendingCount > 0 && (
            <span style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, border: '1px solid rgba(245,158,11,0.25)' }}>
              {pendingCount} pending
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: '8px 12px', marginBottom: 1 }}>
          <button onClick={() => changeMonth(-1)}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 20, padding: '0 8px', cursor: 'pointer', lineHeight: 1 }}>‹</button>
          <div style={{ flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 700, color: '#fff' }}>{monthLabel}</div>
          <button onClick={() => changeMonth(1)}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 20, padding: '0 8px', cursor: 'pointer', lineHeight: 1 }}>›</button>
        </div>
      </div>

      <div style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {monthRecords.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.text2 }}>No leaves this month</div>
            <div style={{ fontSize: 13, color: t.text3, marginTop: 6 }}>Use the arrows to navigate months</div>
          </div>
        ) : monthRecords.map(l => {
          const s = statusInfo(l)
          const dayLabel = new Date(l.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
          const isFutureOrToday = l.date >= today
          return (
            <div key={l.id} style={{ background: t.card, borderRadius: 12, padding: '14px 16px', border: `1px solid ${t.border}` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: t.text }}>{dayLabel}</div>
                  <div style={{ fontSize: 13, color: t.text2, marginTop: 3 }}>
                    {l.leaveType === 'full_day' ? 'Full Day' : 'Half Day'}
                    {l.reason && <span style={{ color: t.text3 }}> · {l.reason}</span>}
                  </div>
                </div>
                <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, flexShrink: 0 }}>
                  {s.label}
                </span>
              </div>

              {l.status === 'pending_approval' && (
                <button onClick={() => handleCancelPending(l)}
                  style={{ width: '100%', marginTop: 12, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', borderRadius: 8, padding: '10px', fontSize: 13, fontWeight: 700 }}>
                  Cancel Request
                </button>
              )}

              {l.status === 'active' && isFutureOrToday && (
                <button onClick={() => handleRequestRevoke(l)}
                  style={{ width: '100%', marginTop: 12, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', borderRadius: 8, padding: '10px', fontSize: 13, fontWeight: 700 }}>
                  Request Cancellation
                </button>
              )}

              {l.status === 'unmark_requested' && (
                <div style={{ marginTop: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>
                  Cancellation request sent — waiting for admin approval
                </div>
              )}
            </div>
          )
        })}
      </div>
      {modal}
    </div>
  )
}
