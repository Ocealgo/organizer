import { useState } from 'react'
import { submitCheckIn } from '../../hooks/useFirebase'
import { useAuth } from '../../context/AuthContext'
import PartyManager from '../distributors/PartyManager'
import StockManager from '../stock/StockManager'
import ExpenseLogger from '../stock/ExpenseLogger'
import CreditBook from '../credit/CreditBook'

interface Props { name: string; role: string; onBack: () => void }

const today = () => new Date().toISOString().split('T')[0]

type SubScreen = 'home' | 'checkin' | 'done' | 'parties' | 'stock' | 'expenses' | 'credits'

export default function SalesView({ name, onBack }: Props) {
  const [screen, setScreen] = useState<SubScreen>('home')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ shops: '', orders: '', did: '', doing: '', blocker: '' })

  if (screen === 'parties')  return <PartyManager onBack={() => setScreen('home')} />
  if (screen === 'stock')    return <StockManager onBack={() => setScreen('home')} />
  if (screen === 'expenses') return <ExpenseLogger onBack={() => setScreen('home')} />
  if (screen === 'credits')  return <CreditBook onBack={() => setScreen('home')} />

  if (screen === 'done') return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg,#0d3d2e,#1a5c42)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 24 }}>🎉</div>
      <div style={{ color: '#6ee7b7', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 8 }}>All done!</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 12 }}>Check-in submitted!</div>
      <div style={{ color: '#a7f3d0', fontSize: 15, lineHeight: 1.7, marginBottom: 36 }}>Your update has been saved.<br />Have a great day, {name}! 🌿</div>
      <button onClick={() => { setScreen('home'); setForm({ shops: '', orders: '', did: '', doing: '', blocker: '' }) }}
        style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '12px 32px', borderRadius: 50, fontSize: 14 }}>
        Back to Home
      </button>
    </div>
  )

  if (screen === 'checkin') return (
    <div style={{ minHeight: '100vh', background: '#f0fdf4', color: '#0d3d2e', paddingBottom: 40 }}>
      <div style={{ background: 'linear-gradient(135deg,#0d3d2e,#1a5c42)', padding: '20px 20px 28px', borderRadius: '0 0 24px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <button onClick={() => setScreen('home')} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', width: 34, height: 34, borderRadius: '50%', fontSize: 18 }}>‹</button>
          <span style={{ color: '#6ee7b7', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>Daily Check-in</span>
        </div>
        <div style={{ color: '#fff', fontSize: 20, fontWeight: 800 }}>Hey {name}! 👋</div>
        <div style={{ color: '#a7f3d0', fontSize: 13 }}>Takes less than 2 minutes</div>
      </div>
      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[
          { emoji: '🏪', label: 'Shops visited today', key: 'shops' as const, placeholder: 'e.g. 5', type: 'number' },
          { emoji: '📦', label: 'Orders received', key: 'orders' as const, placeholder: 'e.g. 3', type: 'number' },
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
        <button onClick={async () => {
          setSaving(true)
          try {
            await submitCheckIn({ name, role: 'sales', shops: parseInt(form.shops) || 0, orders: parseInt(form.orders) || 0, did: form.did, doing: form.doing, blocker: form.blocker || 'None', date: today(), createdAt: Date.now() })
            setScreen('done')
          } catch { alert('Failed to submit.') } finally { setSaving(false) }
        }} disabled={saving}
          style={{ background: saving ? '#94a3b8' : 'linear-gradient(135deg,#0d3d2e,#1a5c42)', color: '#fff', border: 'none', borderRadius: 18, padding: 18, fontSize: 16, fontWeight: 800 }}>
          {saving ? 'Submitting...' : 'Submit Check-in 🌿'}
        </button>
      </div>
    </div>
  )

  const initials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase()
  const menuItems = [
    { emoji: '📋', label: 'Daily Check-in', sub: 'Shops visited, orders, updates', screen: 'checkin' as SubScreen, primary: true },
    { emoji: '🤝', label: 'Distributors & Retailers', sub: 'View & add network', screen: 'parties' as SubScreen, primary: false },
    { emoji: '📦', label: 'Stock Overview', sub: 'Check available stock', screen: 'stock' as SubScreen, primary: false },
    { emoji: '💜', label: 'Credit Book', sub: 'Outstanding & settlements', screen: 'credits' as SubScreen, primary: false },
    { emoji: '💸', label: 'Log an Expense', sub: 'Travel, food, misc', screen: 'expenses' as SubScreen, primary: false },
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
          <button key={item.screen} onClick={() => setScreen(item.screen)}
            style={{ background: item.primary ? '#fff' : 'rgba(255,255,255,0.1)', color: item.primary ? '#0d3d2e' : '#fff', border: item.primary ? 'none' : '1px solid rgba(255,255,255,0.15)', borderRadius: 18, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', boxShadow: item.primary ? '0 8px 32px rgba(0,0,0,0.2)' : 'none' }}>
            <span style={{ fontSize: 26 }}>{item.emoji}</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: item.primary ? '#6b7280' : '#a7f3d0', marginTop: 2 }}>{item.sub}</div>
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 20, opacity: 0.5 }}>›</span>
          </button>
        ))}
      </div>
      <div style={{ textAlign: 'center', paddingBottom: 24, color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>🌿 Ocealgo • The Ocean's Gentle Touch</div>
    </div>
  )
}
