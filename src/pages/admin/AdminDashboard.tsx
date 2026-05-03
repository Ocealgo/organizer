import { useState, useEffect } from 'react'
import DateInput from '../../components/DateInput'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { usePostStatuses } from '../../hooks/useFirebase'
import { MAY_POSTS, FORMAT_EMOJI, PILLAR_COLORS, STATUS_CONFIG } from '../../data'
import { CheckIn, AppUser } from '../../types'
import StockManager from '../stock/StockManager'
import WorkspaceDashboard from '../workspace/WorkspaceDashboard'
import PartyManager from '../distributors/PartyManager'
import CreditBook from '../credit/CreditBook'
import ExpenseLogger from '../stock/ExpenseLogger'
import AllocationManager from '../distributors/AllocationManager'
import ProductManager from '../products/ProductManager'

const MONTH = '2026-05'

type MainTab = 'overview' | 'sales' | 'marketing' | 'workspace'
type SalesTab = 'offline' | 'online'
type MarketingTab = 'offline' | 'online'
type SubScreen = 'dashboard' | 'stock' | 'parties' | 'credits' | 'expenses' | 'allocations' | 'products'

export default function AdminDashboard() {
  const [subScreen, setSubScreen] = useState<SubScreen>('dashboard')
  const [allocations, setAllocations] = useState<any[]>([])
  const [mainTab, setMainTab] = useState<MainTab>('overview')
  const [salesTab, setSalesTab] = useState<SalesTab>('offline')
  const [marketingTab, setMarketingTab] = useState<MarketingTab>('offline')
  const { statuses } = usePostStatuses(MONTH)

  // Sales filters
  const [salesUsers, setSalesUsers] = useState<AppUser[]>([])
  const [selectedUser, setSelectedUser] = useState<string>('all')
  const [dateMode, setDateMode] = useState<'day' | 'month' | 'period'>('month')
  const [dateDay, setDateDay] = useState(new Date().toISOString().split('T')[0])
  const [dateMonth, setDateMonth] = useState(new Date().toISOString().slice(0, 7))
  const [datePeriodFrom, setDatePeriodFrom] = useState(new Date().toISOString().split('T')[0])
  const [datePeriodTo, setDatePeriodTo] = useState(new Date().toISOString().split('T')[0])
  const [allCheckIns, setAllCheckIns] = useState<CheckIn[]>([])

  useEffect(() => {
    const u3 = onSnapshot(collection(db, 'allocations_v2'), snap => {
      setAllocations(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return () => u3()
  }, [])

  useEffect(() => {
    // Fetch offline sales users
    const unsub = onSnapshot(collection(db, 'users'), snap => {
      setSalesUsers(snap.docs
        .map(d => ({ uid: d.id, ...d.data() } as AppUser))
        .filter(u => u.status === 'approved' && u.role === 'offline_sales'))
    })
    return unsub
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'checkins'), snap => {
      setAllCheckIns(snap.docs.map(d => ({ id: d.id, ...d.data() } as CheckIn)).sort((a, b) => b.createdAt - a.createdAt))
    })
    return unsub
  }, [])

  // Filter check-ins
  const filteredCheckIns = allCheckIns.filter(ci => {
    if (selectedUser !== 'all' && ci.name !== selectedUser) return false
    if (dateMode === 'day') return ci.date === dateDay
    if (dateMode === 'month') return ci.date.startsWith(dateMonth)
    if (dateMode === 'period') return ci.date >= datePeriodFrom && ci.date <= datePeriodTo
    return true
  })

  const todayStr = new Date().toISOString().split('T')[0]

  // Marketing stats
  const done   = MAY_POSTS.filter(p => statuses[p.id] === 'posted').length
  const missed = MAY_POSTS.filter(p => statuses[p.id] === 'missed').length
  const pct    = Math.round((done / MAY_POSTS.length) * 100)
  const weekStats = [1,2,3,4].map(w => {
    const wp = MAY_POSTS.filter(p => p.week === w)
    return { week: w, total: wp.length, done: wp.filter(p => statuses[p.id] === 'posted').length, missed: wp.filter(p => statuses[p.id] === 'missed').length }
  })

  if (subScreen === 'stock')    return <StockManager onBack={() => setSubScreen('dashboard')} />
  if (subScreen === 'allocations') return <AllocationManager onBack={() => setSubScreen('dashboard')} parties={[]} isAdmin />
  if (subScreen === 'products') return <ProductManager onBack={() => setSubScreen('dashboard')} />
  if (subScreen === 'parties')  return <PartyManager onBack={() => setSubScreen('dashboard')} />
  if (subScreen === 'credits')  return <CreditBook onBack={() => setSubScreen('dashboard')} />
  if (subScreen === 'expenses') return <ExpenseLogger onBack={() => setSubScreen('dashboard')} />

  const quickLinks = [
    { emoji: '📦', label: 'Stock',        sub: 'Manage inventory',      screen: 'stock'    as SubScreen, color: '#16a34a' },
    { emoji: '🤝', label: 'Distributors', sub: 'View & manage network', screen: 'parties'  as SubScreen, color: '#0891b2' },
    { emoji: '💜', label: 'Credit Book',  sub: 'Outstanding payments',  screen: 'credits'  as SubScreen, color: '#7c3aed' },
    { emoji: '💸', label: 'Expenses',     sub: 'Team expenses log',     screen: 'expenses' as SubScreen, color: '#dc2626' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#78350f,#d97706)', padding: '16px 20px 0' }}>
        <div style={{ color: '#fde68a', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 2 }}>Founders 👑</div>
        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 14 }}>Admin Dashboard</div>
        <div style={{ display: 'flex', gap: 0 }}>
          {([
            { id: 'overview',  label: '📊 Overview' },
            { id: 'sales',     label: '🤝 Sales' },
            { id: 'marketing', label: '📣 Marketing' },
            { id: 'workspace', label: '🏠 Workspace' },
          ] as { id: MainTab; label: string }[]).map(t => (
            <button key={t.id} onClick={() => setMainTab(t.id)}
              style={{ flex: 1, background: mainTab === t.id ? 'rgba(255,255,255,0.2)' : 'transparent', color: mainTab === t.id ? '#fff' : 'rgba(255,255,255,0.45)', border: 'none', borderRadius: '12px 12px 0 0', padding: '10px 6px', fontSize: 11, fontWeight: 800 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ── WORKSPACE ── */}
        {mainTab === 'workspace' && <WorkspaceDashboard />}

        {/* ── OVERVIEW ────────────────────────────────────────────────────── */}
        {mainTab === 'overview' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Quick links */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {quickLinks.map(q => (
                <button key={q.screen} onClick={() => setSubScreen(q.screen)}
                  style={{ background: '#161b22', border: `1px solid ${q.color}33`, borderRadius: 14, padding: 14, textAlign: 'left', color: '#fff' }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{q.emoji}</div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: q.color }}>{q.label}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{q.sub}</div>
                </button>
              ))}
            </div>

            {/* Allocation summary */}
            {(() => {
              const today = new Date().toISOString().split('T')[0]
              const pending  = allocations.filter(a => a.status === 'pending' && a.plannedDate >= today).length
              const overdue  = allocations.filter(a => a.status === 'pending' && a.plannedDate < today).length
              const creditDue = allocations.filter(a => a.status === 'sent' && a.paymentType === 'credit').reduce((s: number, a: any) => s + a.totalAmount, 0)
              return (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {[
                    { label: 'Overdue', val: overdue, color: '#dc2626', bg: 'rgba(220,38,38,0.1)', emoji: '🔴' },
                    { label: 'Pending', val: pending, color: '#d97706', bg: 'rgba(217,119,6,0.1)', emoji: '🟡' },
                    { label: 'Credit Due', val: creditDue > 0 ? `₹${(creditDue/1000).toFixed(0)}k` : '0', color: '#7c3aed', bg: 'rgba(124,58,237,0.1)', emoji: '💜' },
                  ].map(s => (
                    <button key={s.label} onClick={() => setSubScreen('allocations')}
                      style={{ background: s.bg, borderRadius: 12, padding: '10px 6px', textAlign: 'center', border: `1px solid ${s.color}33` }}>
                      <div style={{ fontSize: 11 }}>{s.emoji}</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: s.color }}>{s.val}</div>
                      <div style={{ fontSize: 9, color: '#64748b', marginTop: 1 }}>{s.label}</div>
                    </button>
                  ))}
                </div>
              )
            })()}

            {/* Today's sales snapshot */}
            <div style={{ background: '#161b22', borderRadius: 16, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Sales Today</div>
              {allCheckIns.filter(c => c.date === todayStr).length === 0 ? (
                <div style={{ color: '#475569', fontSize: 13 }}>No check-ins yet today</div>
              ) : allCheckIns.filter(c => c.date === todayStr).map(ci => (
                <div key={ci.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 36, height: 36, background: 'linear-gradient(135deg,#0891b2,#0e7490)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 14, flexShrink: 0 }}>
                    {ci.name[0]}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{ci.name}</div>
                    <div style={{ fontSize: 11, color: '#16a34a' }}>✅ {ci.shops} shops • 📦 {ci.orders} orders</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Marketing snapshot */}
            <div style={{ background: '#161b22', borderRadius: 16, padding: 16, border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
                <svg width="56" height="56" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="28" cy="28" r="22" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
                  <circle cx="28" cy="28" r="22" fill="none" stroke="#22c55e" strokeWidth="5"
                    strokeDasharray={`${2 * Math.PI * 22}`}
                    strokeDashoffset={`${2 * Math.PI * 22 * (1 - pct / 100)}`}
                    strokeLinecap="round" />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, color: '#6ee7b7' }}>{pct}%</div>
              </div>
              <div>
                <div style={{ color: '#6ee7b7', fontSize: 10, letterSpacing: 1 }}>ONLINE MARKETING — MAY</div>
                <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1 }}>{done}<span style={{ fontSize: 12, color: '#6ee7b7' }}>/{MAY_POSTS.length}</span></div>
                <div style={{ color: '#64748b', fontSize: 11 }}>posts {missed > 0 ? `• ❌ ${missed} missed` : '✅ on track'}</div>
              </div>
            </div>
          </div>
        )}

        {/* ── SALES TAB ───────────────────────────────────────────────────── */}
        {mainTab === 'sales' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Offline | Online sub-tabs */}
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 4, gap: 4 }}>
              {([['offline', '🏪 Offline Sales'], ['online', '🌐 Online Sales']] as [SalesTab, string][]).map(([val, label]) => (
                <button key={val} onClick={() => setSalesTab(val)}
                  style={{ flex: 1, background: salesTab === val ? '#161b22' : 'transparent', color: salesTab === val ? '#fff' : '#64748b', border: salesTab === val ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent', borderRadius: 8, padding: '9px', fontSize: 12, fontWeight: 700 }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Online Sales — placeholder */}
            {salesTab === 'online' && (
              <div style={{ background: '#161b22', borderRadius: 16, padding: 32, textAlign: 'center', border: '1px dashed rgba(217,119,6,0.3)' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🌐</div>
                <div style={{ background: 'rgba(217,119,6,0.2)', color: '#d97706', fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 99, display: 'inline-block', marginBottom: 10 }}>COMING SOON</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Online Sales Analytics</div>
                <div style={{ fontSize: 13, color: '#64748b' }}>E-commerce orders, digital campaign tracking and online sales performance will appear here.</div>
              </div>
            )}

            {/* Offline Sales — filters + check-ins */}
            {salesTab === 'offline' && (
              <>
                {/* Filters */}
                <div style={{ background: '#161b22', borderRadius: 14, padding: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>Filters</div>

                  {/* User filter */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: '#475569', marginBottom: 6 }}>👤 Team Member</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => setSelectedUser('all')}
                        style={{ background: selectedUser === 'all' ? '#0891b2' : 'rgba(255,255,255,0.04)', color: selectedUser === 'all' ? '#fff' : '#64748b', border: `1px solid ${selectedUser === 'all' ? '#0891b2' : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '5px 14px', fontSize: 12, fontWeight: 700 }}>
                        All
                      </button>
                      {salesUsers.map(u => (
                        <button key={u.uid} onClick={() => setSelectedUser(u.name)}
                          style={{ background: selectedUser === u.name ? '#0891b2' : 'rgba(255,255,255,0.04)', color: selectedUser === u.name ? '#fff' : '#64748b', border: `1px solid ${selectedUser === u.name ? '#0891b2' : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '5px 14px', fontSize: 12, fontWeight: 700 }}>
                          {u.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Date mode */}
                  <div>
                    <div style={{ fontSize: 11, color: '#475569', marginBottom: 6 }}>📅 Date Filter</div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                      {([['day', 'Day'], ['month', 'Month'], ['period', 'Period']] as [typeof dateMode, string][]).map(([val, label]) => (
                        <button key={val} onClick={() => setDateMode(val)}
                          style={{ flex: 1, background: dateMode === val ? 'rgba(217,119,6,0.2)' : 'rgba(255,255,255,0.04)', color: dateMode === val ? '#d97706' : '#64748b', border: `1px solid ${dateMode === val ? 'rgba(217,119,6,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 8, padding: '7px', fontSize: 11, fontWeight: 700 }}>
                          {label}
                        </button>
                      ))}
                    </div>

                    {dateMode === 'day' && (
                      <DateInput type="date" value={dateDay} onChange={setDateDay} />
                    )}
                    {dateMode === 'month' && (
                      <DateInput type="month" value={dateMonth} onChange={setDateMonth} />
                    )}
                    {dateMode === 'period' && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, color: '#475569', marginBottom: 4 }}>From</div>
                          <DateInput type="date" value={datePeriodFrom} onChange={setDatePeriodFrom} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, color: '#475569', marginBottom: 4 }}>To</div>
                          <DateInput type="date" value={datePeriodTo} onChange={setDatePeriodTo} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Summary pills */}
                {filteredCheckIns.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    {[
                      { label: 'Check-ins', val: filteredCheckIns.length, color: '#6ee7b7' },
                      { label: 'Total Shops', val: filteredCheckIns.reduce((s, c) => s + c.shops, 0), color: '#0891b2' },
                      { label: 'Total Orders', val: filteredCheckIns.reduce((s, c) => s + c.orders, 0), color: '#16a34a' },
                    ].map(s => (
                      <div key={s.label} style={{ background: '#161b22', borderRadius: 12, padding: '12px 10px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ fontSize: 20, fontWeight: 900, color: s.color }}>{s.val}</div>
                        <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Check-in list */}
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                  {filteredCheckIns.length} Check-in{filteredCheckIns.length !== 1 ? 's' : ''}
                </div>

                {filteredCheckIns.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 32, color: '#475569' }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
                    <div style={{ fontWeight: 700 }}>No check-ins for this filter</div>
                  </div>
                ) : filteredCheckIns.map(ci => (
                  <div key={ci.id} style={{ background: '#161b22', borderRadius: 14, padding: 14, border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <div style={{ width: 40, height: 40, background: 'linear-gradient(135deg,#0891b2,#0e7490)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16, flexShrink: 0 }}>
                        {ci.name[0]}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 800, fontSize: 14 }}>{ci.name}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{ci.date}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <div style={{ textAlign: 'center', background: 'rgba(8,145,178,0.1)', borderRadius: 8, padding: '6px 10px' }}>
                          <div style={{ fontWeight: 900, fontSize: 16, color: '#0891b2' }}>{ci.shops}</div>
                          <div style={{ fontSize: 9, color: '#64748b' }}>shops</div>
                        </div>
                        <div style={{ textAlign: 'center', background: 'rgba(22,163,74,0.1)', borderRadius: 8, padding: '6px 10px' }}>
                          <div style={{ fontWeight: 900, fontSize: 16, color: '#16a34a' }}>{ci.orders}</div>
                          <div style={{ fontSize: 9, color: '#64748b' }}>orders</div>
                        </div>
                      </div>
                    </div>
                    {[
                      { emoji: '✅', label: 'Did', val: ci.did, color: '#16a34a' },
                      { emoji: '🔄', label: 'Tomorrow', val: ci.doing, color: '#0891b2' },
                      { emoji: '🚧', label: 'Blocker', val: ci.blocker, color: ci.blocker === 'None' ? '#475569' : '#dc2626' },
                    ].map(r => (
                      <div key={r.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
                        <div style={{ fontSize: 10, color: '#475569', marginBottom: 2 }}>{r.emoji} {r.label}</div>
                        <div style={{ fontSize: 12, color: r.color, lineHeight: 1.5 }}>{r.val}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ── MARKETING TAB ───────────────────────────────────────────────── */}
        {mainTab === 'marketing' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Offline | Online sub-tabs */}
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 4, gap: 4 }}>
              {([['offline', '📣 Offline Marketing'], ['online', '💻 Online Marketing']] as [MarketingTab, string][]).map(([val, label]) => (
                <button key={val} onClick={() => setMarketingTab(val)}
                  style={{ flex: 1, background: marketingTab === val ? '#161b22' : 'transparent', color: marketingTab === val ? '#fff' : '#64748b', border: marketingTab === val ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent', borderRadius: 8, padding: '9px', fontSize: 12, fontWeight: 700 }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Offline Marketing — Coming Soon */}
            {marketingTab === 'offline' && (
              <div style={{ background: '#161b22', borderRadius: 16, padding: 32, textAlign: 'center', border: '1px dashed rgba(217,119,6,0.3)' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📣</div>
                <div style={{ background: 'rgba(217,119,6,0.2)', color: '#d97706', fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 99, display: 'inline-block', marginBottom: 10 }}>COMING SOON</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Offline Marketing Dashboard</div>
                <div style={{ fontSize: 13, color: '#64748b' }}>On-ground campaigns, events, BTL activities and physical marketing will appear here.</div>
              </div>
            )}

            {/* Online Marketing — calendar tracker */}
            {marketingTab === 'online' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ background: '#161b22', borderRadius: 14, padding: 14, border: '1px solid rgba(22,163,74,0.2)' }}>
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>POSTED</div>
                    <div style={{ fontSize: 24, fontWeight: 900, color: '#16a34a' }}>{done}/{MAY_POSTS.length}</div>
                  </div>
                  <div style={{ background: '#161b22', borderRadius: 14, padding: 14, border: `1px solid ${missed > 0 ? 'rgba(220,38,38,0.2)' : 'rgba(255,255,255,0.06)'}` }}>
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>MISSED</div>
                    <div style={{ fontSize: 24, fontWeight: 900, color: missed > 0 ? '#dc2626' : '#16a34a' }}>{missed}</div>
                  </div>
                </div>

                {weekStats.map(w => {
                  const wp = Math.round((w.done / w.total) * 100)
                  return (
                    <div key={w.week} style={{ background: '#161b22', borderRadius: 12, padding: '12px 14px', border: `1px solid ${w.missed > 0 ? '#dc262222' : 'rgba(255,255,255,0.05)'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontWeight: 800, fontSize: 13 }}>Week {w.week}</span>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {w.missed > 0 && <span style={{ fontSize: 10, color: '#dc2626', background: '#dc262220', padding: '2px 8px', borderRadius: 99 }}>❌ {w.missed}</span>}
                          <span style={{ color: '#6ee7b7', fontWeight: 800, fontSize: 12 }}>{w.done}/{w.total}</span>
                        </div>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                        <div style={{ width: `${wp}%`, height: '100%', background: wp === 100 ? '#22c55e' : 'linear-gradient(90deg,#1a5c42,#6ee7b7)', borderRadius: 99 }} />
                      </div>
                    </div>
                  )
                })}

                {MAY_POSTS.map(post => {
                  const s = statuses[post.id] || 'pending'
                  const sc = STATUS_CONFIG[s]
                  const pc = PILLAR_COLORS[post.pillar] || '#1a5c42'
                  return (
                    <div key={post.id} style={{ background: '#161b22', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${s === 'missed' ? '#dc262630' : s === 'posted' ? '#16a34a20' : 'rgba(255,255,255,0.04)'}` }}>
                      <div style={{ fontSize: 14 }}>{FORMAT_EMOJI[post.format]}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.topic}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                          <span style={{ fontSize: 10, color: '#64748b' }}>{post.date}</span>
                          <span style={{ fontSize: 10, color: pc }}>{post.pillar}</span>
                        </div>
                      </div>
                      <div style={{ background: sc.bg, color: sc.color, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, border: `1px solid ${sc.color}44`, whiteSpace: 'nowrap' }}>
                        {sc.emoji} {sc.label}
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}
      </div>
      <div style={{ height: 40 }} />
    </div>
  )
}
