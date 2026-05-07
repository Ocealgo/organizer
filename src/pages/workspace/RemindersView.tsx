import React, { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, updateDoc, doc } from 'firebase/firestore'
import { db } from '../../firebase'
import { Reminder, WorkspaceCategory, ReminderType } from '../../types'
import { useAuth } from '../../context/AuthContext'
import DateInput from '../../components/DateInput'
import { localDateStr, localMonthStr } from '../../utils/date'

const CATEGORIES: WorkspaceCategory[] = ['Finance', 'Operations', 'Sales', 'Marketing', 'General']

const TYPE_STYLE: Record<ReminderType, { color: string; bg: string; label: string }> = {
  manual:     { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)',  label: 'Manual' },
  low_stock:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  label: 'Low Stock' },
  dispatch:   { color: '#16a34a', bg: 'rgba(22,163,74,0.15)',   label: 'Dispatch' },
  credit_due: { color: '#dc2626', bg: 'rgba(220,38,38,0.15)',   label: 'Credit Due' },
  allocation: { color: '#7c3aed', bg: 'rgba(124,58,237,0.15)', label: 'Allocation' },
}

const CAT_COLOR: Record<WorkspaceCategory, string> = {
  Finance: '#16a34a', Operations: '#0891b2', Sales: '#f59e0b', Marketing: '#7c3aed', General: '#64748b',
}

const TYPE_DOT: Record<ReminderType, string> = {
  manual: '#3b82f6', low_stock: '#f59e0b', dispatch: '#16a34a', credit_due: '#dc2626', allocation: '#7c3aed',
}

function getDaysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate() }
function getFirstDayOfMonth(year: number, month: number) { return new Date(year, month, 1).getDay() }

// Reusable reminder card — outside component to prevent re-mount
function ReminderCard({ reminder: r, onToggle, showDate }: { reminder: Reminder; onToggle: () => void; showDate?: boolean }) {
  const ts = TYPE_STYLE[r.type]
  const catColor = CAT_COLOR[r.category] || '#64748b'
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: r.done ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '10px 12px', border: `1px solid ${r.done ? 'rgba(255,255,255,0.04)' : ts.color + '33'}`, opacity: r.done ? 0.6 : 1 }}>
      <button onClick={onToggle}
        style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${r.done ? '#16a34a' : ts.color}`, background: r.done ? '#16a34a' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, marginTop: 1 }}>
        {r.done && <span style={{ color: '#fff', fontSize: 11, fontWeight: 900 }}>✓</span>}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: r.done ? '#64748b' : '#e2e8f0', fontWeight: 600, textDecoration: r.done ? 'line-through' : 'none', wordBreak: 'break-word' }}>{r.title}</div>
        <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, background: `${catColor}20`, color: catColor, padding: '2px 7px', borderRadius: 99 }}>{r.category}</span>
          <span style={{ fontSize: 10, background: ts.bg, color: ts.color, padding: '2px 7px', borderRadius: 99 }}>{ts.label}</span>
          {showDate && <span style={{ fontSize: 10, color: '#475569' }}>{r.date}</span>}
          <span style={{ fontSize: 10, color: '#475569' }}>by {r.createdByName}</span>
        </div>
      </div>
    </div>
  )
}

export default function RemindersView() {
  const { appUser } = useAuth()
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar')
  const [calDate, setCalDate] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: '',
    date: localDateStr(),
    category: 'General' as WorkspaceCategory,
  })

  // No orderBy — sort client-side to avoid Firestore index requirement
  useEffect(() => {
    return onSnapshot(collection(db, 'reminders'), snap => {
      setReminders(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as Reminder))
          .sort((a, b) => a.date.localeCompare(b.date))
      )
    })
  }, [])

  const handleAdd = async () => {
    if (!form.title.trim() || !form.date) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'reminders'), {
        title: form.title.trim(),
        date: form.date,
        category: form.category,
        type: 'manual' as ReminderType,
        createdBy: appUser?.uid || '',
        createdByName: appUser?.name || '',
        done: false,
        createdAt: Date.now(),
      })
      setForm({ title: '', date: localDateStr(), category: 'General' })
      setShowAdd(false)
    } finally { setSaving(false) }
  }

  const toggleDone = async (r: Reminder) => {
    if (!r.id) return
    await updateDoc(doc(db, 'reminders', r.id), { done: !r.done })
  }

  const today = localDateStr()
  const year  = calDate.getFullYear()
  const month = calDate.getMonth()
  const daysInMonth = getDaysInMonth(year, month)
  const firstDay    = getFirstDayOfMonth(year, month)
  const monthStr    = `${year}-${String(month + 1).padStart(2, '0')}`

  const remindersForDay = (day: number) => {
    const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`
    return reminders.filter(r => r.date === dateStr)
  }

  const selectedReminders = selectedDay ? reminders.filter(r => r.date === selectedDay) : []
  const overdue  = reminders.filter(r => !r.done && r.date < today)
  const upcoming = reminders.filter(r => !r.done && r.date >= today)
  const done     = reminders.filter(r => r.done)

  const monthName = calDate.toLocaleString('default', { month: 'long', year: 'numeric' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 3, gap: 3, flex: 1 }}>
          {(['calendar', 'list'] as const).map(v => (
            <button key={v} onClick={() => setViewMode(v)}
              style={{ flex: 1, background: viewMode === v ? '#1e3a5f' : 'transparent', color: viewMode === v ? '#93c5fd' : '#64748b', border: 'none', borderRadius: 8, padding: '7px', fontSize: 12, fontWeight: 700 }}>
              {v === 'calendar' ? '📅 Calendar' : '📋 List'}
            </button>
          ))}
        </div>
        <button onClick={() => setShowAdd(!showAdd)}
          style={{ background: showAdd ? '#1e40af' : 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', color: '#93c5fd', borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 700 }}>
          {showAdd ? '✕ Close' : '+ Add'}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ background: '#161b22', borderRadius: 14, padding: 14, border: '1px solid rgba(59,130,246,0.2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="Reminder title..."
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '11px 14px', fontSize: 14, color: '#fff', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
          <DateInput type="date" value={form.date} onChange={v => setForm({ ...form, date: v })} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => setForm({ ...form, category: c })}
                style={{ background: form.category === c ? `${CAT_COLOR[c]}22` : 'rgba(255,255,255,0.04)', color: form.category === c ? CAT_COLOR[c] : '#64748b', border: `1px solid ${form.category === c ? CAT_COLOR[c] : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700 }}>
                {c}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowAdd(false)} style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: 'none', color: '#64748b', borderRadius: 10, padding: 10, fontSize: 13, fontWeight: 700 }}>Cancel</button>
            <button onClick={handleAdd} disabled={saving || !form.title.trim() || !form.date}
              style={{ flex: 2, background: saving ? '#475569' : '#ffffff', color: saving ? '#aaa' : '#000', border: 'none', borderRadius: 10, padding: 10, fontSize: 13, fontWeight: 800, opacity: (!form.title.trim() || !form.date) ? 0.5 : 1 }}>
              {saving ? 'Saving...' : 'Add Reminder'}
            </button>
          </div>
        </div>
      )}

      {/* Overdue banner */}
      {overdue.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '10px 14px' }}>
          <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginBottom: 8 }}>{overdue.length} Overdue</div>
          {overdue.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <button onClick={() => toggleDone(r)}
                style={{ width: 18, height: 18, borderRadius: 4, border: '1.5px solid #dc2626', background: 'none', cursor: 'pointer', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#fca5a5', flex: 1 }}>{r.title}</span>
              <span style={{ fontSize: 10, color: '#dc2626' }}>{r.date}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── CALENDAR VIEW ── */}
      {viewMode === 'calendar' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#161b22', borderRadius: 12, padding: '10px 14px' }}>
            <button onClick={() => { setCalDate(new Date(year, month - 1, 1)); setSelectedDay(null) }}
              style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: '#93c5fd', fontSize: 18, cursor: 'pointer', width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>{monthName}</div>
            <button onClick={() => { setCalDate(new Date(year, month + 1, 1)); setSelectedDay(null) }}
              style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: '#93c5fd', fontSize: 18, cursor: 'pointer', width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
          </div>

          {/* Day labels */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 10, color: '#475569', fontWeight: 700, padding: '4px 0' }}>{d}</div>
            ))}
          </div>

          {/* Calendar cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
            {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day     = i + 1
              const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`
              const dayRems = remindersForDay(day)
              const isToday = dateStr === today
              const isSel   = selectedDay === dateStr
              const pending = dayRems.filter(r => !r.done)

              return (
                <button key={day}
                  onClick={() => setSelectedDay(isSel ? null : dateStr)}
                  style={{ background: isSel ? '#1e40af' : isToday ? 'rgba(59,130,246,0.12)' : '#161b22', border: `1.5px solid ${isSel ? '#3b82f6' : isToday ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.05)'}`, borderRadius: 8, padding: '6px 2px', minHeight: 46, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', transition: 'all 0.15s' }}>
                  <span style={{ fontSize: 12, fontWeight: isToday ? 900 : 500, color: isToday ? '#93c5fd' : isSel ? '#fff' : '#e2e8f0' }}>{day}</span>
                  {dayRems.length > 0 && (
                    <div style={{ display: 'flex', gap: 2, marginTop: 3, justifyContent: 'center', flexWrap: 'wrap' }}>
                      {dayRems.slice(0, 3).map(r => (
                        <div key={r.id} style={{ width: 5, height: 5, borderRadius: '50%', background: r.done ? '#334155' : TYPE_DOT[r.type] }} />
                      ))}
                      {dayRems.length > 3 && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#475569' }} />}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* Selected day panel */}
          {selectedDay && (
            <div style={{ background: '#161b22', borderRadius: 14, padding: 14, border: '1px solid rgba(59,130,246,0.25)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: '#93c5fd', fontWeight: 700 }}>
                  {new Date(selectedDay + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
                <button onClick={() => setSelectedDay(null)}
                  style={{ background: 'none', border: 'none', color: '#475569', fontSize: 16, cursor: 'pointer' }}>✕</button>
              </div>
              {selectedReminders.length === 0 ? (
                <div style={{ fontSize: 13, color: '#475569', textAlign: 'center', padding: '8px 0' }}>No events on this day</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {selectedReminders.map(r => (
                    <ReminderCard key={r.id} reminder={r} onToggle={() => toggleDone(r)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Legend */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '4px 0' }}>
            {Object.entries(TYPE_DOT).map(([type, color]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
                <span style={{ fontSize: 10, color: '#64748b' }}>{type.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── LIST VIEW ── */}
      {viewMode === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {upcoming.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Upcoming ({upcoming.length})</div>
              {upcoming.map(r => <ReminderCard key={r.id} reminder={r} onToggle={() => toggleDone(r)} showDate />)}
            </>
          )}
          {done.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginTop: 6 }}>Completed ({done.length})</div>
              {done.map(r => <ReminderCard key={r.id} reminder={r} onToggle={() => toggleDone(r)} showDate />)}
            </>
          )}
          {reminders.length === 0 && (
            <div style={{ textAlign: 'center', padding: 32, color: '#475569' }}>
              <div style={{ fontWeight: 700 }}>No reminders yet</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>Tap "+ Add" to create your first reminder</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
