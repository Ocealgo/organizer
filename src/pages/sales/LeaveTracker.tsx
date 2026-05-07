import { useState, useEffect } from 'react'
import { collection, onSnapshot, updateDoc, doc, addDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { LeaveRecord, AppUser } from '../../types'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import { localDateStr, localMonthStr } from '../../utils/date'

interface Props { onBack: () => void }

type LeaveTab = 'today' | 'month' | 'all'

const todayStr = () => localDateStr()
const thisMonth = () => localMonthStr()

export default function LeaveTracker({ onBack }: Props) {
  const { t } = useTheme()
  const { modal, showConfirm } = useConfirm()

  const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([])
  const [salesUsers, setSalesUsers] = useState<AppUser[]>([])
  const [tab, setTab] = useState<LeaveTab>('today')
  const [selectedPerson, setSelectedPerson] = useState<string>('all')
  const [expandedAudit, setExpandedAudit] = useState<string | null>(null)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'leave_records'), snap => {
      setLeaveRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRecord)))
    })
    const u2 = onSnapshot(collection(db, 'users'), snap => {
      setSalesUsers(snap.docs
        .map(d => ({ uid: d.id, ...d.data() } as AppUser))
        .filter(u => u.status === 'approved' && (u.role === 'offline_sales' || u.role === 'online_sales')))
    })
    return () => { u1(); u2() }
  }, [])

  const today = todayStr()
  const month = thisMonth()

  const pendingApproval = leaveRecords.filter(l => l.status === 'pending_approval')
  const pendingUnmark = leaveRecords.filter(l => l.status === 'unmark_requested')

  const handleApproveLeave = async (leave: LeaveRecord) => {
    const confirmed = await showConfirm(
      'Approve Leave Request?',
      `${leave.name} · ${leave.leaveType === 'half_day' ? 'Half Day' : 'Full Day'} · ${leave.date}${leave.reason ? ` · ${leave.reason}` : ''}`,
      'Approve'
    )
    if (!confirmed) return
    await updateDoc(doc(db, 'leave_records', leave.id!), {
      status: 'active',
      auditLog: [...(leave.auditLog || []), {
        action: 'leave_approved', by: 'admin', byName: 'Admin', at: Date.now()
      }],
    })
    await addDoc(collection(db, 'alerts'), {
      type: 'leave_approved',
      message: `Your ${leave.leaveType === 'full_day' ? 'Full Day' : 'Half Day'} leave on ${leave.date} has been approved`,
      relatedId: leave.id!, read: false, createdAt: Date.now(),
      toUid: leave.uid,
    })
  }

  const handleRejectLeave = async (leave: LeaveRecord) => {
    const confirmed = await showConfirm('Reject Leave Request?', `${leave.name} · ${leave.date}`, 'Reject')
    if (!confirmed) return
    await updateDoc(doc(db, 'leave_records', leave.id!), {
      status: 'rejected',
      auditLog: [...(leave.auditLog || []), {
        action: 'leave_rejected', by: 'admin', byName: 'Admin', at: Date.now()
      }],
    })
  }

  const handleApproveUnmark = async (leave: LeaveRecord) => {
    const confirmed = await showConfirm('Approve Cancellation?', `Remove leave for ${leave.name} on ${leave.date}?`, 'Approve')
    if (!confirmed) return
    await updateDoc(doc(db, 'leave_records', leave.id!), {
      status: 'removed',
      auditLog: [...(leave.auditLog || []), {
        action: 'unmark_approved', by: 'admin', byName: 'Admin', at: Date.now()
      }],
    })
  }

  const handleRejectUnmark = async (leave: LeaveRecord) => {
    const confirmed = await showConfirm('Reject Cancellation?', `Keep leave active for ${leave.name} on ${leave.date}?`, 'Reject')
    if (!confirmed) return
    await updateDoc(doc(db, 'leave_records', leave.id!), {
      status: 'active',
      auditLog: [...(leave.auditLog || []), {
        action: 'unmark_rejected', by: 'admin', byName: 'Admin', at: Date.now()
      }],
    })
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

  const statusBadge = (status: string, leaveType: string) => {
    const typeStyle = leaveType === 'half_day'
      ? { label: 'Half Day', color: '#6b7280', bg: 'rgba(107,114,128,0.1)', border: 'rgba(107,114,128,0.2)' }
      : { label: 'Full Day', color: '#6b7280', bg: 'rgba(107,114,128,0.1)', border: 'rgba(107,114,128,0.2)' }
    const statusStyle =
      status === 'pending_approval' ? { label: 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)' } :
      status === 'active'           ? { label: 'Approved', color: '#22c55e', bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.2)' } :
      status === 'unmark_requested' ? { label: 'Cancel Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)' } :
      null
    return { typeStyle, statusStyle }
  }

  const pill = (label: string, color: string, bg: string, border: string) => (
    <span style={{ fontSize: 10, fontWeight: 700, background: bg, color, border: `1px solid ${border}`, padding: '2px 8px', borderRadius: 99 }}>{label}</span>
  )

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ background: '#000000', padding: '20px 20px 0' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, marginBottom: 16 }}>← Back</button>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Admin</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', marginBottom: 12 }}>Leave Tracker</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <span style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 99 }}>Today: {todayCount}</span>
          <span style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 99 }}>Month: {monthCount}</span>
          {totalPending > 0 && (
            <span style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 99, border: '1px solid rgba(245,158,11,0.25)' }}>
              {totalPending} pending
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          {([['today', 'Today'], ['month', 'Month'], ['all', 'All']] as [LeaveTab, string][]).map(([val, label]) => (
            <button key={val} onClick={() => setTab(val)}
              style={{ flex: 1, background: 'transparent', color: tab === val ? '#fff' : 'rgba(255,255,255,0.35)', border: 'none', borderBottom: tab === val ? '2px solid #fff' : '2px solid transparent', padding: '10px 12px', fontSize: 13, fontWeight: tab === val ? 800 : 500, marginBottom: -1 }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Pending Leave Requests */}
        {pendingApproval.length > 0 && (
          <div style={{ background: t.card, border: `1px solid rgba(245,158,11,0.2)`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px 8px', fontSize: 11, fontWeight: 800, color: '#f59e0b', letterSpacing: 1, textTransform: 'uppercase' }}>
              Leave Requests ({pendingApproval.length})
            </div>
            {pendingApproval.map(leave => (
              <div key={leave.id} style={{ margin: '0 10px 10px', borderRadius: 8, padding: '12px', border: `1px solid ${t.border}`, background: t.bg3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>{leave.name}</div>
                    <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{leave.date} · {leave.leaveType === 'half_day' ? 'Half Day' : 'Full Day'}{leave.reason ? ` · ${leave.reason}` : ''}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleApproveLeave(leave)}
                    style={{ flex: 1, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#22c55e', borderRadius: 8, padding: '8px', fontSize: 13, fontWeight: 700 }}>
                    Approve
                  </button>
                  <button onClick={() => handleRejectLeave(leave)}
                    style={{ flex: 1, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', borderRadius: 8, padding: '8px', fontSize: 13, fontWeight: 700 }}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pending Cancellation Requests */}
        {pendingUnmark.length > 0 && (
          <div style={{ background: t.card, border: `1px solid rgba(245,158,11,0.2)`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px 8px', fontSize: 11, fontWeight: 800, color: '#f59e0b', letterSpacing: 1, textTransform: 'uppercase' }}>
              Cancellation Requests ({pendingUnmark.length})
            </div>
            {pendingUnmark.map(leave => (
              <div key={leave.id} style={{ margin: '0 10px 10px', borderRadius: 8, padding: '12px', border: `1px solid ${t.border}`, background: t.bg3 }}>
                <div style={{ flex: 1, marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>{leave.name}</div>
                  <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{leave.date} · {leave.leaveType === 'half_day' ? 'Half Day' : 'Full Day'}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleApproveUnmark(leave)}
                    style={{ flex: 1, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#22c55e', borderRadius: 8, padding: '8px', fontSize: 13, fontWeight: 700 }}>
                    Approve
                  </button>
                  <button onClick={() => handleRejectUnmark(leave)}
                    style={{ flex: 1, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', borderRadius: 8, padding: '8px', fontSize: 13, fontWeight: 700 }}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Team Summary */}
        <div style={{ background: t.card, borderRadius: 12, padding: 14, border: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 11, color: t.text3, marginBottom: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Team</div>
          {salesUsers.map(u => {
            const total = leaveRecords.filter(l => l.uid === u.uid && l.status === 'active').length
            const monthLeaves = leaveRecords.filter(l => l.uid === u.uid && l.date.startsWith(month) && l.status === 'active').length
            const onLeaveToday = leaveRecords.some(l => l.uid === u.uid && l.date === today && l.status === 'active')
            const hasPending = pendingApproval.some(l => l.uid === u.uid) || pendingUnmark.some(l => l.uid === u.uid)
            return (
              <div key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: `1px solid ${t.border}` }}>
                <div style={{ width: 34, height: 34, background: t.bg3, border: `1px solid ${t.border2}`, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: t.text, flexShrink: 0 }}>
                  {u.name[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: t.text }}>{u.name}</span>
                    {onLeaveToday && pill('On Leave', '#f59e0b', 'rgba(245,158,11,0.1)', 'rgba(245,158,11,0.2)')}
                    {hasPending && pill('Pending', '#f59e0b', 'rgba(245,158,11,0.1)', 'rgba(245,158,11,0.2)')}
                  </div>
                  <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{monthLeaves} this month · {total} total</div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Person filter */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[{ uid: 'all', name: 'All' }, ...salesUsers].map(u => (
            <button key={u.uid} onClick={() => setSelectedPerson(u.uid)}
              style={{ background: selectedPerson === u.uid ? t.primary : t.bg3, color: selectedPerson === u.uid ? t.primaryText : t.text3, border: `1px solid ${selectedPerson === u.uid ? t.primary : t.border}`, borderRadius: 20, padding: '5px 14px', fontSize: 12, fontWeight: 700 }}>
              {u.name}
            </button>
          ))}
        </div>

        {/* Leave record list */}
        {displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>No leave records</div>
          </div>
        ) : displayed.slice().sort((a, b) => b.markedAt - a.markedAt).map(leave => {
          const { typeStyle, statusStyle } = statusBadge(leave.status, leave.leaveType)
          return (
            <div key={leave.id} style={{ background: t.card, borderRadius: 12, padding: 14, border: `1px solid ${t.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: t.text }}>{leave.name}</span>
                    {pill(typeStyle.label, typeStyle.color, typeStyle.bg, typeStyle.border)}
                    {leave.reason && pill(leave.reason, t.text3, t.bg3, t.border)}
                    {statusStyle && pill(statusStyle.label, statusStyle.color, statusStyle.bg, statusStyle.border)}
                  </div>
                  <div style={{ fontSize: 12, color: t.text3 }}>{leave.date}</div>
                </div>
                {leave.auditLog && leave.auditLog.length > 0 && (
                  <button onClick={() => setExpandedAudit(expandedAudit === leave.id ? null : leave.id!)}
                    style={{ background: t.bg3, border: `1px solid ${t.border}`, color: t.text3, borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 700 }}>
                    {expandedAudit === leave.id ? 'Hide' : 'Log'}
                  </button>
                )}
              </div>
              {expandedAudit === leave.id && leave.auditLog && (
                <div style={{ marginTop: 10, borderTop: `1px solid ${t.border}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {leave.auditLog.map((entry, i) => (
                    <div key={i} style={{ fontSize: 12, color: t.text3 }}>
                      <span style={{ fontWeight: 700, color: t.text2 }}>{entry.action}</span> by {entry.byName} · {new Date(entry.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  ))}
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
