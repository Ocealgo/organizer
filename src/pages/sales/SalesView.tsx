import { useState } from 'react'
import { submitCheckIn } from '../../hooks/useFirebase'
import { UserRole } from '../../types'

interface Props { name: string; role: UserRole; onBack: () => void }

const today = () => new Date().toISOString().split('T')[0]

export default function SalesView({ name, onBack }: Props) {
  const [screen, setScreen] = useState<'home' | 'checkin' | 'done'>('home')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ shops: '', orders: '', did: '', doing: '', blocker: '' })

  const handleSubmit = async () => {
    setSaving(true)
    try {
      await submitCheckIn({
        name,
        role: 'sales',
        shops: parseInt(form.shops) || 0,
        orders: parseInt(form.orders) || 0,
        did: form.did,
        doing: form.doing,
        blocker: form.blocker || 'None',
        date: today(),
        createdAt: Date.now(),
      })
      setScreen('done')
    } catch (e) {
      alert('Failed to submit. Check your connection.')
    } finally {
      setSaving(false)
    }
  }

  if (screen === 'done') return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg,#0d3d2e,#1a5c42)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 24 }}>🎉</div>
      <div style={{ color: '#6ee7b7', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 8 }}>All done!</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 12 }}>Check-in submitted!</div>
      <div style={{ color: '#a7f3d0', fontSize: 15, lineHeight: 1.7, marginBottom: 36 }}>Your update has been saved.<br />Have a great day, {name}! 🌿</div>
      <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: '16px 20px', width: '100%', maxWidth: 300, textAlign: 'left', marginBottom: 32 }}>
        <div style={{ fontSize: 11, color: '#6ee7b7', marginBottom: 8, letterSpacing: 1 }}>TODAY'S SUMMARY</div>
        {form.shops && <div style={{ fontSize: 13, color: '#fff', marginBottom: 6 }}>🏪 Shops visited: <b>{form.shops}</b></div>}
        {form.orders && <div style={{ fontSize: 13, color: '#fff', marginBottom: 6 }}>📦 Orders: <b>{form.orders}</b></div>}
        {form.blocker && form.blocker !== 'None' && <div style={{ fontSize: 13, color: '#fca5a5' }}>🚧 Blocker: {form.blocker}</div>}
      </div>
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
          { emoji: '📦', label: 'Orders received',     key: 'orders' as const, placeholder: 'e.g. 3', type: 'number' },
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
          { emoji: '✅', label: 'What did you do today?',  key: 'did'    as const, placeholder: 'Areas visited, calls made, anything noteworthy...' },
          { emoji: '🔄', label: 'Plan for tomorrow?',      key: 'doing'  as const, placeholder: 'Where are you going? What will you do?' },
          { emoji: '🚧', label: 'Any blockers?',           key: 'blocker'as const, placeholder: 'e.g. Need more samples / No issues today' },
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
          style={{ background: saving ? '#94a3b8' : 'linear-gradient(135deg,#0d3d2e,#1a5c42)', color: '#fff', border: 'none', borderRadius: 18, padding: 18, fontSize: 16, fontWeight: 800, boxShadow: '0 8px 24px rgba(13,61,46,0.3)', transition: 'all 0.2s' }}>
          {saving ? 'Submitting...' : 'Submit Check-in 🌿'}
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg,#0d3d2e 0%,#1a5c42 55%,#2d7a56 100%)' }}>
      <div style={{ padding: '36px 24px 24px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#6ee7b7', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 20 }}>← Switch</button>
        <div style={{ color: '#6ee7b7', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Good morning 🌅</div>
        <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.1, marginBottom: 4 }}>{name}</div>
        <div style={{ color: '#a7f3d0', fontSize: 14 }}>Sales Team • Ocealgo</div>
      </div>

      <div style={{ margin: '0 20px', background: 'rgba(255,255,255,0.1)', borderRadius: 22, padding: 18, border: '1px solid rgba(255,255,255,0.15)' }}>
        <div style={{ color: '#6ee7b7', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>Today's Progress</div>
        <div style={{ display: 'flex', gap: 10 }}>
          {[{ emoji: '✅', label: 'Check-in', val: 'Pending' }, { emoji: '🏪', label: 'Shops', val: '0' }, { emoji: '📦', label: 'Orders', val: '0' }].map(i => (
            <div key={i.label} style={{ flex: 1, background: 'rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{i.emoji}</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{i.val}</div>
              <div style={{ color: '#a7f3d0', fontSize: 10 }}>{i.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button onClick={() => setScreen('checkin')}
          style={{ background: '#fff', color: '#0d3d2e', border: 'none', borderRadius: 18, padding: 20, display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
          <span style={{ fontSize: 28 }}>📋</span>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Daily Check-in</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Shops visited, orders, updates</div>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 22, color: '#1a5c42' }}>›</span>
        </button>
        {[
          { emoji: '💸', label: 'Log an Expense',    sub: 'Travel, meals, misc'   },
          { emoji: '📦', label: 'Report Low Stock',  sub: 'Flag inventory issues' },
        ].map(item => (
          <button key={item.label}
            style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 18, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 24 }}>{item.emoji}</span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 700 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: '#a7f3d0' }}>{item.sub}</div>
            </div>
          </button>
        ))}
      </div>
      <div style={{ textAlign: 'center', padding: 20, color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>🌿 Ocealgo • The Ocean's Gentle Touch</div>
    </div>
  )
}
