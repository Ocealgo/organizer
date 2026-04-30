import { useState, useEffect } from 'react'
import { collection, addDoc, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'
import { Expense, ExpenseCategory } from '../../types'
import { useAuth } from '../../context/AuthContext'

interface Props { onBack: () => void }

const CATEGORIES: { value: ExpenseCategory; label: string; emoji: string }[] = [
  { value: 'travel',     label: 'Travel',     emoji: '🚗' },
  { value: 'food',       label: 'Food',       emoji: '🍱' },
  { value: 'marketing',  label: 'Marketing',  emoji: '📣' },
  { value: 'operations', label: 'Operations', emoji: '⚙️' },
  { value: 'misc',       label: 'Misc',       emoji: '📦' },
]

export default function ExpenseLogger({ onBack }: Props) {
  const { appUser } = useAuth()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [tab, setTab] = useState<'list' | 'add'>('list')
  const [dateMode, setDateMode] = useState<'day' | 'month'>('month')
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 7))
  const [form, setForm] = useState({ amount: '', category: 'travel' as ExpenseCategory, note: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'expenses'), snap => {
      setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() } as Expense)).sort((a, b) => b.createdAt - a.createdAt))
    })
    return unsub
  }, [])

  const filtered = expenses.filter(e => {
    if (dateMode === 'day') return e.date === dateFilter
    if (dateMode === 'month') return e.date.startsWith(dateFilter)
    return true
  })

  const handleAdd = async () => {
    if (!form.amount || !form.note) return alert('Please fill amount and note')
    setSaving(true)
    try {
      await addDoc(collection(db, 'expenses'), {
        amount: parseFloat(form.amount),
        category: form.category,
        note: form.note,
        addedBy: appUser!.uid,
        addedByName: appUser!.name,
        date: new Date().toISOString().split('T')[0],
        createdAt: Date.now(),
      })
      setForm({ amount: '', category: 'travel', note: '' })
      setTab('list')
    } finally {
      setSaving(false)
    }
  }

  const totalFiltered = filtered.reduce((s, e) => s + e.amount, 0)

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', paddingBottom: 40 }}>
      <div style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)', padding: '24px 20px 16px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fecaca', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 16 }}>← Back</button>
        <div style={{ color: '#fecaca', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Finance 💸</div>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>Expenses</div>
        <div style={{ fontSize: 26, fontWeight: 900, color: '#fca5a5', marginBottom: 4 }}>₹{totalFiltered.toLocaleString()}</div>
        <div style={{ color: '#fecaca', fontSize: 12, marginBottom: 16 }}>
          {dateMode === 'day' ? `on ${dateFilter}` : `in ${dateFilter}`} • {filtered.length} entries
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['list', 'add'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ background: tab === t ? 'rgba(255,255,255,0.2)' : 'transparent', color: tab === t ? '#fff' : 'rgba(255,255,255,0.5)', border: 'none', borderRadius: 20, padding: '7px 18px', fontSize: 12, fontWeight: 700 }}>
              {t === 'list' ? '📋 History' : '➕ Add Expense'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 14px' }}>
        {tab === 'list' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Date filter */}
            <div style={{ background: '#161b22', borderRadius: 14, padding: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {(['day', 'month'] as const).map(m => (
                  <button key={m} onClick={() => {
                    setDateMode(m)
                    setDateFilter(m === 'month' ? new Date().toISOString().slice(0, 7) : new Date().toISOString().split('T')[0])
                  }}
                    style={{ flex: 1, background: dateMode === m ? 'rgba(220,38,38,0.2)' : 'rgba(255,255,255,0.04)', color: dateMode === m ? '#fca5a5' : '#64748b', border: `1px solid ${dateMode === m ? 'rgba(220,38,38,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, padding: '8px', fontSize: 12, fontWeight: 700 }}>
                    {m === 'day' ? '📅 By Day' : '🗓️ By Month'}
                  </button>
                ))}
              </div>
              <input
                type={dateMode === 'day' ? 'date' : 'month'}
                value={dateFilter}
                onChange={e => setDateFilter(e.target.value)}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', fontSize: 14, color: '#fff', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
            </div>

            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>💸</div>
                <div style={{ fontWeight: 700 }}>No expenses for this period</div>
              </div>
            ) : filtered.map(e => {
              const cat = CATEGORIES.find(c => c.value === e.category)
              return (
                <div key={e.id} style={{ background: '#161b22', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ width: 40, height: 40, background: 'rgba(220,38,38,0.15)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                    {cat?.emoji}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{e.note}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{cat?.label} • {e.date} • {e.addedByName}</div>
                  </div>
                  <div style={{ fontWeight: 900, fontSize: 16, color: '#dc2626' }}>−₹{e.amount.toLocaleString()}</div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'add' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>Amount (₹)</div>
              <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
                placeholder="e.g. 250"
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '13px 16px', fontSize: 26, fontWeight: 900, color: '#fff', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>Category</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {CATEGORIES.map(c => (
                  <button key={c.value} onClick={() => setForm({ ...form, category: c.value })}
                    style={{ background: form.category === c.value ? 'rgba(220,38,38,0.15)' : 'rgba(255,255,255,0.04)', color: form.category === c.value ? '#dc2626' : '#64748b', border: `1.5px solid ${form.category === c.value ? 'rgba(220,38,38,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 12, padding: '12px', fontSize: 13, fontWeight: 700 }}>
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>Note</div>
              <textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}
                placeholder="e.g. Petrol for Koramangala visit" rows={3}
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '13px 16px', fontSize: 14, color: '#fff', outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
            </div>
            <button onClick={handleAdd} disabled={saving}
              style={{ background: saving ? '#475569' : 'linear-gradient(135deg,#dc2626,#b91c1c)', color: '#fff', border: 'none', borderRadius: 14, padding: 16, fontSize: 15, fontWeight: 800 }}>
              {saving ? 'Saving...' : 'Log Expense 💸'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
