import { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot, updateDoc, doc } from 'firebase/firestore'
import { db } from '../../firebase'
import { Reminder, WorkspaceCategory, ReminderType } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import DateInput from '../../components/DateInput'
import { localDateStr } from '../../utils/date'
import { Eyebrow, EmptyState, GhostButton, PrimaryButton, inputStyle } from '../../components/ui'

const CATEGORIES: WorkspaceCategory[] = ['Finance', 'Operations', 'Sales', 'Marketing', 'General']

const TYPE_LABEL: Record<ReminderType, string> = {
  manual: 'Manual',
  low_stock: 'Low stock',
  dispatch: 'Dispatch',
  credit_due: 'Credit due',
  allocation: 'Allocation',
}

function getDaysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate() }
function getFirstDayOfMonth(year: number, month: number) { return new Date(year, month, 1).getDay() }

function ReminderRow({ reminder: r, onToggle, showDate, overdue }: {
  reminder: Reminder; onToggle: () => void; showDate?: boolean; overdue?: boolean
}) {
  const { t } = useTheme()
  return (
    <div className="oc-row"
      style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 10px', borderTop: `0.5px solid ${t.border}` }}>
      <button onClick={onToggle} aria-pressed={r.done}
        style={{
          width: 17, height: 17, borderRadius: 4, flexShrink: 0, marginTop: 2,
          border: `1px solid ${r.done ? t.text2 : overdue ? t.warn : t.border2}`,
          background: r.done ? t.text2 : 'none', cursor: 'pointer',
        }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 400,
          color: r.done ? t.text3 : t.text,
          textDecoration: r.done ? 'line-through' : 'none',
          wordBreak: 'break-word',
        }}>
          {r.title}
        </div>
        <div style={{ fontSize: 12, color: overdue && !r.done ? t.warn : t.text3, marginTop: 3 }}>
          {r.category} · {TYPE_LABEL[r.type]}
          {showDate && ` · ${r.date}`}
          {r.createdByName && ` · ${r.createdByName}`}
        </div>
      </div>
    </div>
  )
}

export default function RemindersView() {
  const { appUser } = useAuth()
  const { t } = useTheme()
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

  const chip = (active: boolean) => ({
    background: 'none',
    border: `0.5px solid ${active ? t.text2 : t.border}`,
    borderRadius: 99,
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 400,
    color: active ? t.text : t.text3,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['calendar', 'list'] as const).map(v => (
            <button key={v} className="oc-action" onClick={() => setViewMode(v)} style={chip(viewMode === v)}>
              {v === 'calendar' ? 'Calendar' : 'List'}
            </button>
          ))}
        </div>
        <GhostButton onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? 'Cancel' : 'Add a reminder'}
        </GhostButton>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="What should we remember?"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            style={inputStyle(t)} />
          <DateInput type="date" value={form.date} onChange={v => setForm({ ...form, date: v })} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CATEGORIES.map(c => (
              <button key={c} className="oc-action" onClick={() => setForm({ ...form, category: c })}
                style={chip(form.category === c)}>
                {c}
              </button>
            ))}
          </div>
          <div>
            <PrimaryButton onClick={handleAdd} disabled={saving || !form.title.trim() || !form.date}>
              {saving ? 'Saving…' : 'Add it'}
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Overdue */}
      {overdue.length > 0 && (
        <div>
          <div style={{ marginBottom: 10, color: t.warn }}>
            <Eyebrow>{overdue.length} overdue</Eyebrow>
          </div>
          <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
            {overdue.map(r => (
              <ReminderRow key={r.id} reminder={r} onToggle={() => toggleDone(r)} showDate overdue />
            ))}
          </div>
        </div>
      )}

      {/* ── CALENDAR ── */}
      {viewMode === 'calendar' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button className="oc-action" onClick={() => { setCalDate(new Date(year, month - 1, 1)); setSelectedDay(null) }}
              style={{ background: 'none', border: 'none', padding: '4px 8px', fontSize: 16, color: t.text2, cursor: 'pointer' }}>
              ‹
            </button>
            <div style={{ fontSize: 14, fontWeight: 500, color: t.text }}>{monthName}</div>
            <button className="oc-action" onClick={() => { setCalDate(new Date(year, month + 1, 1)); setSelectedDay(null) }}
              style={{ background: 'none', border: 'none', padding: '4px 8px', fontSize: 16, color: t.text2, cursor: 'pointer' }}>
              ›
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, color: t.text3, padding: '4px 0' }}>{d}</div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day     = i + 1
              const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`
              const dayRems = remindersForDay(day)
              const isToday = dateStr === today
              const isSel   = selectedDay === dateStr
              const pending = dayRems.filter(r => !r.done).length

              return (
                <button key={day} className="oc-row"
                  onClick={() => setSelectedDay(isSel ? null : dateStr)}
                  style={{
                    background: isSel ? t.tint : 'none',
                    border: `0.5px solid ${isSel ? t.text2 : t.border}`,
                    borderRadius: 4, padding: '7px 2px', minHeight: 44,
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'flex-start', gap: 3, cursor: 'pointer',
                  }}>
                  <span style={{
                    fontSize: 12,
                    fontWeight: isToday ? 500 : 400,
                    color: isToday ? t.text : t.text2,
                    borderBottom: isToday ? `1px solid ${t.text}` : 'none',
                    lineHeight: 1.3,
                  }}>
                    {day}
                  </span>
                  {pending > 0 && (
                    <span style={{ fontSize: 10, color: t.text3 }}>{pending}</span>
                  )}
                </button>
              )
            })}
          </div>

          {selectedDay && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Eyebrow>
                  {new Date(selectedDay + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
                </Eyebrow>
                <button className="oc-action" onClick={() => setSelectedDay(null)}
                  style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: t.text2, cursor: 'pointer' }}>
                  Close
                </button>
              </div>
              {selectedReminders.length === 0 ? (
                <div style={{ fontSize: 14, color: t.text3 }}>Nothing on this day.</div>
              ) : (
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {selectedReminders.map(r => (
                    <ReminderRow key={r.id} reminder={r} onToggle={() => toggleDone(r)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── LIST ── */}
      {viewMode === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {upcoming.length > 0 && (
            <div>
              <div style={{ marginBottom: 10 }}><Eyebrow>Coming up ({upcoming.length})</Eyebrow></div>
              <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                {upcoming.map(r => <ReminderRow key={r.id} reminder={r} onToggle={() => toggleDone(r)} showDate />)}
              </div>
            </div>
          )}
          {done.length > 0 && (
            <div>
              <div style={{ marginBottom: 10 }}><Eyebrow>Done ({done.length})</Eyebrow></div>
              <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                {done.map(r => <ReminderRow key={r.id} reminder={r} onToggle={() => toggleDone(r)} showDate />)}
              </div>
            </div>
          )}
          {reminders.length === 0 && (
            <EmptyState
              title="No reminders yet"
              body="Put a date on the things that would otherwise slip — a payment to chase, a dispatch to confirm, a call to make."
              actionLabel={showAdd ? undefined : 'Add a reminder'}
              onAction={showAdd ? undefined : () => setShowAdd(true)}
            />
          )}
        </div>
      )}
    </div>
  )
}
