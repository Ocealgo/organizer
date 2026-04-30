import { useState, useEffect } from 'react'
import { collection, onSnapshot, query, where, updateDoc, doc } from 'firebase/firestore'
import { submitCheckIn } from '../../hooks/useFirebase'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import PartyManager from '../distributors/PartyManager'
import StockManager from '../stock/StockManager'
import ExpenseLogger from '../stock/ExpenseLogger'
import CreditBook from '../credit/CreditBook'
import { CheckIn } from '../../types'

interface Props { name: string; role: string; onBack: () => void }

const todayStr = () => new Date().toISOString().split('T')[0]
const currentMonth = () => new Date().toISOString().slice(0, 7)
const isLocked = (createdAt: number) => Date.now() - createdAt > 24 * 60 * 60 * 1000

type SubScreen = 'home' | 'checkin' | 'done' | 'parties' | 'stock' | 'expenses' | 'credits' | 'history'

export default function SalesView({ name, onBack }: Props) {
  const { appUser } = useAuth()
  const [screen, setScreen] = useState<SubScreen>('home')
  const [saving, setSaving] = useState(false)
  const [checkIns, setCheckIns] = useState<CheckIn[]>([])
  const [editingCheckIn, setEditingCheckIn] = useState<CheckIn | null>(null)
  const [form, setForm] = useState({ shops: '', orders: '', did: '', doing: '', blocker: '' })

  if (screen === 'parties')  return <PartyManager onBack={() => setScreen('home')} />
  if (screen === 'stock')    return <StockManager onBack={() => setScreen('home')} />
  if (screen === 'expenses') return <ExpenseLogger onBack={() => setScreen('home')} />
  if (screen === 'credits')  return <CreditBook onBack={() => setScreen('home')} />

  useEffect(() => {
    if (!appUser) return
    const nameKey = name.toLowerCase().replace(/\s/g, '_')
    const month = currentMonth()
    // Query check-ins for this user this month
    const q = query(collection(db, 'checkins'), where('name', '==', name))
    return onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as CheckIn))
        .filter(c => c.date.startsWith(month))
        .sort((a, b) => b.createdAt - a.createdAt)
      setCheckIns(all)
    })
  }, [name, appUser])

  const todayCheckIn = checkIns.find(c => c.date === todayStr())

  const handleSubmit = async () => {
    setSaving(true)
    try {
      if (editingCheckIn) {
        // Update existing
        await updateDoc(doc(db, 'checkins', editingCheckIn.id!), {
          shops: parseInt(form.shops) || 0,
          orders: parseInt(form.orders) || 0,
          did: form.did, doing: form.doing,
          blocker: form.blocker || 'None',
        })
      } else {
        await submitCheckIn({
          name, role: 'sales',
          shops: parseInt(form.shops) || 0,
          orders: parseInt(form.orders) || 0,
          did: form.did, doing: form.doing,
          blocker: form.blocker || 'None',
          date: todayStr(), createdAt: Date.now(),
        })
      }
      setScreen('done')
      setEditingCheckIn(null)
    } catch { alert('Failed to submit.') }
    finally { setSaving(false) }
  }

  const startEdit = (ci: CheckIn) => {
    setForm({ shops: String(ci.shops), orders: String(ci.orders), did: ci.did, doing: ci.doing, blocker: ci.blocker })
    setEditingCheckIn(ci)
    setScreen('checkin')
  }

  // ── HISTORY SCREEN ──────────────────────────────────────────────────────────
  if (screen === 'history') return (
    <div style={{ minHeight: '100vh', background: '#0d1117', paddingBottom: 40 }}>
      <div style={{ background: 'linear-gradient(135deg,#0d3d2e,#1a5c42)', padding: '24px 20px 20px' }}>
        <button onClick={() => setScreen('home')} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#6ee7b7', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 16 }}>← Back</button>
        <div style={{ color: '#6ee7b7', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>This Month</div>
        <div style={{ fontSize: 22, fontWeight: 900 }}>My Check-ins</div>
        <div style={{ color: '#a7f3d0', fontSize: 13, marginTop: 2 }}>{checkIns.length} entries in {currentMonth()}</div>
      </div>
      <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {checkIns.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
            <div style={{ fontWeight: 700 }}>No check-ins this month</div>
          </div>
        ) : checkIns.map(ci => {
          const locked = isLocked(ci.createdAt)
          return (
            <div key={ci.id} style={{ background: '#161b22', borderRadius: 14, padding: 16, border: `1px solid ${ci.date === todayStr() ? 'rgba(22,163,74,0.3)' : 'rgba(255,255,255,0.06)'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>{ci.date}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    🏪 {ci.shops} shops • 📦 {ci.orders} orders
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {locked ? (
                    <span style={{ fontSize: 10, color: '#475569', background: 'rgba(255,255,255,0.04)', padding: '3px 8px', borderRadius: 99 }}>🔒 Locked</span>
                  ) : (
                    <button onClick={() => startEdit(ci)}
                      style={{ background: 'rgba(8,145,178,0.1)', border: '1px solid rgba(8,145,178,0.2)', color: '#0891b2', borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      ✏️ Edit
                    </button>
                  )}
                </div>
              </div>
              {[
                { emoji: '✅', label: 'Did', val: ci.did, color: '#16a34a' },
                { emoji: '🔄', label: 'Tomorrow', val: ci.doing, color: '#0891b2' },
                { emoji: '🚧', label: 'Blocker', val: ci.blocker, color: ci.blocker === 'None' ? '#64748b' : '#dc2626' },
              ].map(r => (
                <div key={r.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: '#475569', marginBottom: 2 }}>{r.emoji} {r.label}</div>
                  <div style={{ fontSize: 12, color: r.color, lineHeight: 1.5 }}>{r.val}</div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )

  // ── DONE SCREEN ─────────────────────────────────────────────────────────────
  if (screen === 'done') return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg,#0d3d2e,#1a5c42)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 24 }}>🎉</div>
      <div style={{ color: '#6ee7b7', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 8 }}>All done!</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 12 }}>Check-in submitted!</div>
      <div style={{ color: '#a7f3d0', fontSize: 15, lineHeight: 1.7, marginBottom: 36 }}>
        Have a great day, {name}! 🌿
      </div>
      <button onClick={() => { setScreen('home'); setForm({ shops: '', orders: '', did: '', doing: '', blocker: '' }) }}
        style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '12px 32px', borderRadius: 50, fontSize: 14 }}>
        Back to Home
      </button>
    </div>
  )

  // ── CHECK-IN SCREEN ─────────────────────────────────────────────────────────
  if (screen === 'checkin') return (
    <div style={{ minHeight: '100vh', background: '#f0fdf4', color: '#0d3d2e', paddingBottom: 40 }}>
      <div style={{ background: 'linear-gradient(135deg,#0d3d2e,#1a5c42)', padding: '20px 20px 28px', borderRadius: '0 0 24px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <button onClick={() => { setScreen('home'); setEditingCheckIn(null) }} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', width: 34, height: 34, borderRadius: '50%', fontSize: 18 }}>‹</button>
          <span style={{ color: '#6ee7b7', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
            {editingCheckIn ? 'Edit Check-in' : 'Daily Check-in'}
          </span>
        </div>
        <div style={{ color: '#fff', fontSize: 20, fontWeight: 800 }}>
          {editingCheckIn ? `Editing ${editingCheckIn.date}` : `Hey ${name}! 👋`}
        </div>
        {!editingCheckIn && <div style={{ color: '#a7f3d0', fontSize: 13 }}>Takes less than 2 minutes</div>}
      </div>
      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[
          { emoji: '🏪', label: 'Shops visited today', key: 'shops' as const, type: 'number', placeholder: 'e.g. 5' },
          { emoji: '📦', label: 'Orders received', key: 'orders' as const, type: 'number', placeholder: 'e.g. 3' },
        ].map(f => (
          <div key={f.key} style={{ background: '#fff', borderRadius: 18, padding: 18, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 22 }}>{f.emoji}</span>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{f.label}</div>
            </div>
            <input type={f.type} value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })}
              placeholder={f.placeholder}
              style={{ width: '100%', border: '1.5px solid #d1fae5', borderRadius: 12, padding: '12px 14px', fontSize: 22, fontWeight: 800, color: '#0d3d2e', outline: 'none', background: '#f0fdf4', boxSizing: 'border-box' }} />
          </div>
        ))}
        {[
          { emoji: '✅', label: 'What did you do today?', key: 'did' as const, placeholder: 'Areas visited, calls made...' },
          { emoji: '🔄', label: 'Plan for tomorrow?', key: 'doing' as const, placeholder: 'Where are you going?' },
          { emoji: '🚧', label: 'Any blockers?', key: 'blocker' as const, placeholder: 'e.g. Need more samples / None' },
        ].map(f => (
          <div key={f.key} style={{ background: '#fff', borderRadius: 18, padding: 18, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 22 }}>{f.emoji}</span>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{f.label}</div>
            </div>
            <textarea value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })}
              placeholder={f.placeholder} rows={3}
              style={{ width: '100%', border: '1.5px solid #d1fae5', borderRadius: 12, padding: '12px 14px', fontSize: 14, color: '#0d3d2e', outline: 'none', background: '#f0fdf4', boxSizing: 'border-box', resize: 'none' }} />
          </div>
        ))}
        <button onClick={handleSubmit} disabled={saving}
          style={{ background: saving ? '#94a3b8' : 'linear-gradient(135deg,#0d3d2e,#1a5c42)', color: '#fff', border: 'none', borderRadius: 18, padding: 18, fontSize: 16, fontWeight: 800 }}>
          {saving ? 'Submitting...' : editingCheckIn ? 'Save Changes ✅' : 'Submit Check-in 🌿'}
        </button>
      </div>
    </div>
  )

  // ── HOME SCREEN ─────────────────────────────────────────────────────────────
  const initials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase()

  const menuItems = [
    {
      emoji: todayCheckIn ? '✅' : '📋',
      label: todayCheckIn ? 'Today: Checked In' : 'Daily Check-in',
      sub: todayCheckIn ? `${todayCheckIn.shops} shops • ${todayCheckIn.orders} orders` : 'Shops visited, orders, updates',
      action: () => {
        if (todayCheckIn && !isLocked(todayCheckIn.createdAt)) {
          startEdit(todayCheckIn)
        } else if (!todayCheckIn) {
          setForm({ shops: '', orders: '', did: '', doing: '', blocker: '' })
          setScreen('checkin')
        }
      },
      primary: true,
      locked: todayCheckIn ? isLocked(todayCheckIn.createdAt) : false,
    },
    { emoji: '📅', label: 'My Check-in History', sub: `${checkIns.length} entries this month`, action: () => setScreen('history'), primary: false, locked: false },
    { emoji: '🤝', label: 'Distributors & Retailers', sub: 'View & add network', action: () => setScreen('parties'), primary: false, locked: false },
    { emoji: '📦', label: 'Stock Overview', sub: 'Check available stock', action: () => setScreen('stock'), primary: false, locked: false },
    { emoji: '💜', label: 'Credit Book', sub: 'Outstanding & settlements', action: () => setScreen('credits'), primary: false, locked: false },
    { emoji: '💸', label: 'Log an Expense', sub: 'Travel, food, misc', action: () => setScreen('expenses'), primary: false, locked: false },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg,#0d3d2e 0%,#1a5c42 55%,#2d7a56 100%)' }}>
      <div style={{ padding: '36px 24px 24px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#6ee7b7', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 20 }}>← Sign out</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 52, height: 52, background: 'rgba(255,255,255,0.15)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 20 }}>{initials}</div>
          <div>
            <div style={{ color: '#6ee7b7', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase' }}>Sales Team 🤝</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{name}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 20px 40px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {menuItems.map((item, i) => (
          <button key={i} onClick={item.locked ? undefined : item.action}
            style={{ background: item.primary ? '#fff' : 'rgba(255,255,255,0.1)', color: item.primary ? '#0d3d2e' : '#fff', border: item.primary ? 'none' : '1px solid rgba(255,255,255,0.15)', borderRadius: 18, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', boxShadow: item.primary ? '0 8px 32px rgba(0,0,0,0.2)' : 'none', opacity: item.locked ? 0.6 : 1, cursor: item.locked ? 'default' : 'pointer' }}>
            <span style={{ fontSize: 26 }}>{item.emoji}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: item.primary ? '#6b7280' : '#a7f3d0', marginTop: 2 }}>{item.sub}</div>
            </div>
            {item.locked
              ? <span style={{ fontSize: 14, opacity: 0.5 }}>🔒</span>
              : <span style={{ marginLeft: 'auto', fontSize: 20, opacity: 0.5 }}>›</span>}
          </button>
        ))}
      </div>
      <div style={{ textAlign: 'center', paddingBottom: 24, color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>🌿 Ocealgo • The Ocean's Gentle Touch</div>
    </div>
  )
}
