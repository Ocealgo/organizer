import { useState, useEffect } from 'react'
import { collection, onSnapshot, updateDoc, doc, addDoc, deleteDoc, query, orderBy } from 'firebase/firestore'
import { db } from '../../firebase'
import { LeaveRecord, AppUser, Holiday } from '../../types'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import { localDateStr, localMonthStr } from '../../utils/date'

interface Props { onBack: () => void }

type LeaveTab = 'today' | 'month' | 'all' | 'holidays'

const todayStr = () => localDateStr()
const thisMonth = () => localMonthStr()

export default function LeaveTracker({ onBack }: Props) {
  const { t, theme } = useTheme()
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
      'Approve Leave Request?',
      `${leave.name} · ${leave.leaveType === 'half_day' ? 'Half Day' : 'Full Day'} · ${leave.date}${leave.reason ? ` · ${leave.reason}` : ''}`,
      '✅ Approve'
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
      message: `✅ Your ${leave.leaveType === 'full_day' ? 'Full Day' : 'Half Day'} leave on ${leave.date} has been approved`,
      relatedId: leave.id!, read: false, createdAt: Date.now(),
      toUid: leave.uid,
    })
  }

  const handleRejectLeave = async (leave: LeaveRecord) => {
    const confirmed = await showConfirm(
      'Reject Leave Request?',
      `${leave.name} · ${leave.date}`,
      '❌ Reject'
    )
    if (!confirmed) return
    await updateDoc(doc(db, 'leave_records', leave.id!), {
      status: 'rejected',
      auditLog: [...(leave.auditLog || []), {
        action: 'leave_rejected', by: 'admin', byName: 'Admin', at: Date.now()
      }],
    })
  }

  const handleApproveUnmark = async (leave: LeaveRecord) => {
    const confirmed = await showConfirm('Approve Unmark?', `Remove leave for ${leave.name} on ${leave.date}?`, '✅ Approve')
    if (!confirmed) return
    await updateDoc(doc(db, 'leave_records', leave.id!), {
      status: 'removed',
      auditLog: [...(leave.auditLog || []), {
        action: 'unmark_approved', by: 'admin', byName: 'Admin', at: Date.now()
      }],
    })
  }

  const handleRejectUnmark = async (leave: LeaveRecord) => {
    const confirmed = await showConfirm('Reject Unmark Request?', `Keep leave active for ${leave.name} on ${leave.date}?`, '❌ Reject')
    if (!confirmed) return
    await updateDoc(doc(db, 'leave_records', leave.id!), {
      status: 'active',
      auditLog: [...(leave.auditLog || []), {
        action: 'unmark_rejected', by: 'admin', byName: 'Admin', at: Date.now()
      }],
    })
  }

  const handleAddHoliday = async () => {
    if (!newHolidayName.trim()) { await showAlert('Name required', 'Enter a holiday name.'); return }
    if (!newHolidayDate) { await showAlert('Date required', 'Pick a date.'); return }
    if (holidays.some(h => h.date === newHolidayDate)) { await showAlert('Already exists', `A holiday is already marked on ${newHolidayDate}.`); return }
    setAddingHoliday(true)
    try {
      await addDoc(collection(db, 'holidays'), {
        name: newHolidayName.trim(), date: newHolidayDate,
        createdBy: 'admin', createdByName: 'Admin', createdAt: Date.now(),
      })
      setNewHolidayName('')
      setNewHolidayDate(localDateStr())
    } finally { setAddingHoliday(false) }
  }

  const handleDeleteHoliday = async (h: Holiday) => {
    const ok = await showConfirm('Remove Holiday?', `Remove "${h.name}" on ${h.date}?`, '🗑️ Remove')
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

  const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
    pending_approval: { label: 'Pending', color: '#6366f1', bg: 'rgba(99,102,241,0.15)' },
    active:           { label: 'Approved', color: '#16a34a', bg: 'rgba(22,163,74,0.12)' },
    unmark_requested: { label: 'Unmark Req.', color: '#d97706', bg: 'rgba(245,158,11,0.15)' },
  }

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#0f766e,#14b8a6)', padding: '20px 20px 0' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', padding: '6px 14px', borderRadius: 20, fontSize: 13, marginBottom: 14 }}>← Back</button>
        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Admin</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', marginBottom: 10 }}>Leave Tracker</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <span style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 12, fontWeight: 800, padding: '4px 12px', borderRadius: 99 }}>Today: {todayCount}</span>
          <span style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 12, fontWeight: 800, padding: '4px 12px', borderRadius: 99 }}>Month: {monthCount}</span>
          {totalPending > 0 && (
            <span style={{ background: 'rgba(99,102,241,0.35)', color: '#fff', fontSize: 12, fontWeight: 800, padding: '4px 12px', borderRadius: 99 }}>⏳ {totalPending} pending</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 0 }}>
          {([['today', 'Today'], ['month', 'Month'], ['all', 'All'], ['holidays', '🎉 Holidays']] as [LeaveTab, string][]).map(([val, label]) => (
            <button key={val} onClick={() => setTab(val)}
              style={{ flex: 1, background: tab === val ? 'rgba(255,255,255,0.2)' : 'transparent', color: tab === val ? '#fff' : 'rgba(255,255,255,0.5)', border: 'none', borderRadius: '10px 10px 0 0', padding: '10px 8px', fontSize: 12, fontWeight: 800 }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ── HOLIDAYS TAB ── */}
        {tab === 'holidays' && (<>
          {/* Add holiday form */}
          <div style={{ background: t.card, borderRadius: 14, padding: 14, border: `1px solid ${t.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: t.text, marginBottom: 12 }}>Add Holiday</div>
            <input
              value={newHolidayName}
              onChange={e => setNewHolidayName(e.target.value)}
              placeholder="Holiday name (e.g. Onam, Eid)"
              style={{ width: '100%', background: t.bg3 ?? t.bg, border: `1px solid ${t.border}`, borderRadius: 8, padding: '10px 12px', fontSize: 13, color: t.text, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="date"
                value={newHolidayDate}
                onChange={e => setNewHolidayDate(e.target.value)}
                style={{ flex: 1, background: t.bg3 ?? t.bg, border: `1px solid ${t.border}`, borderRadius: 8, padding: '10px 12px', fontSize: 13, color: t.text, outline: 'none' }}
              />
              <button onClick={handleAddHoliday} disabled={addingHoliday}
                style={{ background: 'linear-gradient(135deg,#0f766e,#14b8a6)', border: 'none', color: '#fff', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 800, opacity: addingHoliday ? 0.6 : 1 }}>
                {addingHoliday ? '…' : 'Add'}
              </button>
            </div>
          </div>

          {/* Holiday list */}
          {holidays.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>🎉</div>
              <div style={{ fontWeight: 700 }}>No holidays marked</div>
            </div>
          ) : holidays.map(h => (
            <div key={h.id} style={{ background: t.card, borderRadius: 12, padding: '12px 14px', border: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>🎉</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: t.text }}>{h.name}</div>
                <div style={{ fontSize: 12, color: t.text3 }}>{new Date(h.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</div>
              </div>
              {h.date >= localDateStr() && (
                <button onClick={() => handleDeleteHoliday(h)}
                  style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.2)', color: '#fca5a5', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </>)}

        {tab !== 'holidays' && (<>
        {/* Pending Leave Approval Requests */}
        {pendingApproval.length > 0 && (
          <div style={{ background: 'rgba(99,102,241,0.06)', border: '1.5px solid rgba(99,102,241,0.2)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px 8px', fontSize: 13, fontWeight: 800, color: '#6366f1', letterSpacing: 1, textTransform: 'uppercase' }}>
              Leave Requests ({pendingApproval.length})
            </div>
            {pendingApproval.map(leave => (
              <div key={leave.id} style={{ background: 'rgba(99,102,241,0.05)', margin: '0 10px 10px', borderRadius: 10, padding: '12px 14px', border: '1px solid rgba(99,102,241,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: t.text }}>{leave.name}</div>
                    <div style={{ fontSize: 12, color: t.text3 }}>{leave.date}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, background: leave.leaveType === 'half_day' ? 'rgba(59,130,246,0.15)' : 'rgba(99,102,241,0.15)', color: leave.leaveType === 'half_day' ? '#3b82f6' : '#6366f1', padding: '3px 8px', borderRadius: 99 }}>
                      {leave.leaveType === 'half_day' ? 'Half Day' : 'Full Day'}
                    </span>
                    {leave.reason && (
                      <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(100,116,139,0.12)', color: t.text3, padding: '3px 8px', borderRadius: 99 }}>
                        {leave.reason}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleApproveLeave(leave)}
                    style={{ flex: 1, background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.25)', color: '#16a34a', borderRadius: 8, padding: '8px', fontSize: 13, fontWeight: 700 }}>
                    Approve
                  </button>
                  <button onClick={() => handleRejectLeave(leave)}
                    style={{ flex: 1, background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.25)', color: '#dc2626', borderRadius: 8, padding: '8px', fontSize: 13, fontWeight: 700 }}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pending Unmark Requests */}
        {pendingUnmark.length > 0 && (
          <div style={{ background: 'rgba(245,158,11,0.08)', border: '1.5px solid rgba(245,158,11,0.25)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px 8px', fontSize: 13, fontWeight: 800, color: '#d97706', letterSpacing: 1, textTransform: 'uppercase' }}>
              Pending Unmark Requests ({pendingUnmark.length})
            </div>
            {pendingUnmark.map(leave => (
              <div key={leave.id} style={{ background: 'rgba(245,158,11,0.06)', margin: '0 10px 10px', borderRadius: 10, padding: '12px 14px', border: '1px solid rgba(245,158,11,0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: t.text }}>{leave.name}</div>
                    <div style={{ fontSize: 12, color: t.text3 }}>{leave.date}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 800, background: leave.leaveType === 'half_day' ? 'rgba(59,130,246,0.15)' : 'rgba(245,158,11,0.15)', color: leave.leaveType === 'half_day' ? '#3b82f6' : '#f59e0b', padding: '3px 8px', borderRadius: 99 }}>
                    {leave.leaveType === 'half_day' ? 'Half Day' : 'Full Day'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleApproveUnmark(leave)}
                    style={{ flex: 1, background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.25)', color: '#16a34a', borderRadius: 8, padding: '8px', fontSize: 13, fontWeight: 700 }}>
                    Approve
                  </button>
                  <button onClick={() => handleRejectUnmark(leave)}
                    style={{ flex: 1, background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.25)', color: '#dc2626', borderRadius: 8, padding: '8px', fontSize: 13, fontWeight: 700 }}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Team Summary */}
        <div style={{ background: t.card, borderRadius: 14, padding: 14, border: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 13, color: t.text3, marginBottom: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Team Summary</div>
          {salesUsers.map(u => {
            const total = leaveRecords.filter(l => l.uid === u.uid && l.status === 'active').length
            const monthLeaves = leaveRecords.filter(l => l.uid === u.uid && l.date.startsWith(month) && l.status === 'active').length
            const onLeaveToday = leaveRecords.some(l => l.uid === u.uid && l.date === today && l.status === 'active')
            const hasPendingApproval = pendingApproval.some(l => l.uid === u.uid)
            const hasPendingUnmark = pendingUnmark.some(l => l.uid === u.uid)
            return (
              <div key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: `1px solid ${t.border}` }}>
                <div style={{ width: 36, height: 36, background: 'linear-gradient(135deg,#0f766e,#14b8a6)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 14, color: '#fff', flexShrink: 0 }}>
                  {u.name[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: t.text }}>{u.name}</span>
                    {onLeaveToday && <span style={{ fontSize: 14 }}>🏖️</span>}
                    {hasPendingApproval && <span style={{ fontSize: 11, background: 'rgba(99,102,241,0.15)', color: '#6366f1', padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}>Request</span>}
                    {hasPendingUnmark && <span style={{ fontSize: 11, background: 'rgba(245,158,11,0.15)', color: '#d97706', padding: '1px 6px', borderRadius: 99, fontWeight: 700 }}>⏳</span>}
                  </div>
                  <div style={{ fontSize: 12, color: t.text3 }}>{monthLeaves} this month · {total} total</div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Person filter chips */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={() => setSelectedPerson('all')}
            style={{ background: selectedPerson === 'all' ? '#0f766e' : theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', color: selectedPerson === 'all' ? '#fff' : t.text3, border: `1px solid ${selectedPerson === 'all' ? '#0f766e' : t.border}`, borderRadius: 20, padding: '5px 14px', fontSize: 13, fontWeight: 700 }}>
            All
          </button>
          {salesUsers.map(u => (
            <button key={u.uid} onClick={() => setSelectedPerson(u.uid)}
              style={{ background: selectedPerson === u.uid ? '#0f766e' : theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', color: selectedPerson === u.uid ? '#fff' : t.text3, border: `1px solid ${selectedPerson === u.uid ? '#0f766e' : t.border}`, borderRadius: 20, padding: '5px 14px', fontSize: 13, fontWeight: 700 }}>
              {u.name}
            </button>
          ))}
        </div>

        {/* Leave record list */}
        {displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: t.text3 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🏖️</div>
            <div style={{ fontWeight: 700 }}>No leave records</div>
          </div>
        ) : displayed.slice().sort((a, b) => b.markedAt - a.markedAt).map(leave => {
          const s = STATUS_LABEL[leave.status]
          return (
            <div key={leave.id} style={{ background: t.card, borderRadius: 14, padding: 14, border: `1px solid ${t.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 800, fontSize: 14, color: t.text }}>{leave.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, background: leave.leaveType === 'half_day' ? 'rgba(59,130,246,0.15)' : 'rgba(245,158,11,0.15)', color: leave.leaveType === 'half_day' ? '#3b82f6' : '#f59e0b', padding: '2px 8px', borderRadius: 99 }}>
                      {leave.leaveType === 'half_day' ? 'Half Day' : 'Full Day'}
                    </span>
                    {leave.reason && (
                      <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(100,116,139,0.1)', color: t.text3, padding: '2px 8px', borderRadius: 99 }}>{leave.reason}</span>
                    )}
                    {s && (
                      <span style={{ fontSize: 10, fontWeight: 800, background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 99 }}>{s.label}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{leave.date}</div>
                </div>
                {leave.auditLog && leave.auditLog.length > 0 && (
                  <button onClick={() => setExpandedAudit(expandedAudit === leave.id ? null : leave.id!)}
                    style={{ background: theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', border: `1px solid ${t.border}`, color: t.text3, borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 700 }}>
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
        </>)}
      </div>

      {modal}
    </div>
  )
}
