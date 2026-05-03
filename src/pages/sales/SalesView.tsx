import { useState, useEffect } from 'react'
import { collection, onSnapshot, query, where, updateDoc, doc } from 'firebase/firestore'
import { db } from '../../firebase'
import { submitCheckIn } from '../../hooks/useFirebase'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import PartyManager from '../distributors/PartyManager'
import StockManager from '../stock/StockManager'
import ExpenseLogger from '../stock/ExpenseLogger'
import CreditBook from '../credit/CreditBook'
import AllocationManager from '../distributors/AllocationManager'
import VisitLogger from './VisitLogger'
import { CheckIn } from '../../types'

interface Props { name: string }

const todayStr = () => new Date().toISOString().split('T')[0]
const currentMonth = () => new Date().toISOString().slice(0, 7)
const isLocked = (createdAt: number) => Date.now() - createdAt > 24 * 60 * 60 * 1000

type SubScreen = 'home' | 'visits' | 'parties' | 'stock' | 'expenses' | 'credits' | 'allocations'

export default function SalesView({ name }: Props) {
  const { appUser } = useAuth()
  const { t, theme } = useTheme()
  const isOnline = appUser?.role === 'online_sales'
  const [screen, setScreen] = useState<SubScreen>('home')
  const [checkIns, setCheckIns] = useState<CheckIn[]>([])

  useEffect(() => {
    if (!appUser) return
    const q = query(collection(db, 'checkins'), where('name', '==', name))
    return onSnapshot(q, snap => {
      const month = currentMonth()
      setCheckIns(snap.docs.map(d => ({ id: d.id, ...d.data() } as CheckIn))
        .filter(c => c.date.startsWith(month))
        .sort((a, b) => b.createdAt - a.createdAt))
    })
  }, [name, appUser])

  // Route to sub-screens — hooks are above so this is safe
  if (screen === 'visits')      return <VisitLogger onBack={() => setScreen('home')} />
  if (screen === 'parties')     return <PartyManager onBack={() => setScreen('home')} />
  if (screen === 'stock')       return <StockManager onBack={() => setScreen('home')} />
  if (screen === 'expenses')    return <ExpenseLogger onBack={() => setScreen('home')} />
  if (screen === 'credits')     return <CreditBook onBack={() => setScreen('home')} />
  if (screen === 'allocations') return <AllocationManager onBack={() => setScreen('home')} parties={[]} isAdmin={false} />

  // Online Sales — disabled
  if (isOnline) return (
    <div style={{ minHeight: '100vh', background: t.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <div style={{ fontSize: 64, marginBottom: 24 }}>🌐</div>
      <div style={{ background: 'rgba(217,119,6,0.2)', color: '#d97706', fontSize: 12, fontWeight: 800, padding: '4px 12px', borderRadius: 99, marginBottom: 16 }}>COMING SOON</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: t.text, marginBottom: 12, textAlign: 'center' }}>Online Sales Dashboard</div>
      <div style={{ color: t.text2, fontSize: 14, lineHeight: 1.8, textAlign: 'center', maxWidth: 280 }}>
        E-commerce orders, digital campaigns and online sales will be available soon.
      </div>
    </div>
  )

  // Count today's visits
  const todayCheckIn = checkIns.find(c => c.date === todayStr())
  const initials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase()

  const menuItems = [
    {
      emoji: '🗺️',
      label: "Today's Visits",
      sub: "Log shop visits & outcomes",
      action: () => setScreen('visits'),
      primary: true,
    },
    { emoji: '🤝', label: 'Distributors & Retailers', sub: 'View & manage network', action: () => setScreen('parties') },
    { emoji: '📦', label: 'Allocations', sub: 'View & create stock requests', action: () => setScreen('allocations') },
    { emoji: '📊', label: 'Stock Overview', sub: 'Check available stock', action: () => setScreen('stock') },
    { emoji: '💜', label: 'Credit Book', sub: 'Outstanding & settlements', action: () => setScreen('credits') },
    { emoji: '💸', label: 'Log an Expense', sub: 'Travel, food, misc', action: () => setScreen('expenses') },
  ]

  return (
    <div style={{ minHeight: '100vh', background: theme === 'dark' ? 'linear-gradient(145deg,#0d3d2e 0%,#1a5c42 55%,#2d7a56 100%)' : 'linear-gradient(145deg,#ecfdf5 0%,#d1fae5 100%)' }}>
      {/* Header */}
      <div style={{ padding: '28px 24px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 54, height: 54, background: 'rgba(255,255,255,0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 22, color: '#fff', border: '2px solid rgba(255,255,255,0.3)' }}>{initials}</div>
          <div>
            <div style={{ color: theme === 'dark' ? '#6ee7b7' : '#1a5c42', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 }}>🏪 Offline Sales</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: theme === 'dark' ? '#fff' : '#0d3d2e' }}>{name}</div>
          </div>
        </div>

        {/* Today summary */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          {[
            { label: 'Visits Today', val: '—', color: theme === 'dark' ? '#fff' : '#0d3d2e' },
            { label: 'Interested', val: '—', color: theme === 'dark' ? '#86efac' : '#16a34a' },
            { label: 'This Month', val: `${checkIns.length} logs`, color: theme === 'dark' ? '#bae6fd' : '#0891b2' },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, background: theme === 'dark' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.5)', borderRadius: 12, padding: '12px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 11, color: theme === 'dark' ? 'rgba(255,255,255,0.6)' : '#475569', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Menu */}
      <div style={{ padding: '0 20px 40px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {menuItems.map((item, i) => (
          <button key={i} onClick={item.action}
            style={{ background: item.primary ? '#fff' : theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.7)', color: item.primary ? '#0d3d2e' : theme === 'dark' ? '#fff' : '#0d3d2e', border: item.primary ? 'none' : `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)'}`, borderRadius: 18, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', boxShadow: item.primary ? '0 8px 32px rgba(0,0,0,0.2)' : 'none', cursor: 'pointer' }}>
            <span style={{ fontSize: 28 }}>{item.emoji}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{item.label}</div>
              <div style={{ fontSize: 13, color: item.primary ? '#6b7280' : theme === 'dark' ? '#a7f3d0' : '#475569', marginTop: 3 }}>{item.sub}</div>
            </div>
            <span style={{ fontSize: 22, opacity: 0.4 }}>›</span>
          </button>
        ))}
      </div>
    </div>
  )
}
