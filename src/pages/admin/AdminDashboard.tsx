import { useState } from 'react'
import { useCheckIns, usePostStatuses } from '../../hooks/useFirebase'
import { MAY_POSTS, FORMAT_EMOJI, PILLAR_COLORS, STATUS_CONFIG } from '../../data'
import StockManager from '../stock/StockManager'
import PartyManager from '../distributors/PartyManager'
import CreditBook from '../credit/CreditBook'
import ExpenseLogger from '../stock/ExpenseLogger'

interface Props { onBack: () => void }

const MONTH = '2026-05'
const today = () => new Date().toISOString().split('T')[0]

type SubScreen = 'dashboard' | 'stock' | 'parties' | 'credits' | 'expenses'

export default function AdminDashboard({ onBack }: Props) {
  const [subScreen, setSubScreen] = useState<SubScreen>('dashboard')
  const [tab, setTab] = useState<'overview' | 'sales' | 'marketing'>('overview')
  const { checkIns } = useCheckIns(today())
  const { statuses } = usePostStatuses(MONTH)

  if (subScreen === 'stock')    return <StockManager onBack={() => setSubScreen('dashboard')} />
  if (subScreen === 'parties')  return <PartyManager onBack={() => setSubScreen('dashboard')} />
  if (subScreen === 'credits')  return <CreditBook onBack={() => setSubScreen('dashboard')} />
  if (subScreen === 'expenses') return <ExpenseLogger onBack={() => setSubScreen('dashboard')} />

  const done   = MAY_POSTS.filter(p => statuses[p.id] === 'posted').length
  const missed = MAY_POSTS.filter(p => statuses[p.id] === 'missed').length
  const pct    = Math.round((done / MAY_POSTS.length) * 100)

  const weekStats = [1, 2, 3, 4].map(w => {
    const wp = MAY_POSTS.filter(p => p.week === w)
    return { week: w, total: wp.length, done: wp.filter(p => statuses[p.id] === 'posted').length, missed: wp.filter(p => statuses[p.id] === 'missed').length }
  })

  const quickLinks = [
    { emoji: '📦', label: 'Stock',          sub: 'Manage inventory',        screen: 'stock'    as SubScreen, color: '#16a34a' },
    { emoji: '🤝', label: 'Distributors',   sub: 'View & manage network',   screen: 'parties'  as SubScreen, color: '#0891b2' },
    { emoji: '💜', label: 'Credit Book',    sub: 'Outstanding payments',    screen: 'credits'  as SubScreen, color: '#7c3aed' },
    { emoji: '💸', label: 'Expenses',       sub: 'Team expenses log',       screen: 'expenses' as SubScreen, color: '#dc2626' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117' }}>
      <div style={{ background: 'linear-gradient(135deg,#78350f,#d97706)', padding: '24px 20px 0' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fde68a', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 16 }}>← Sign out</button>
        <div style={{ color: '#fde68a', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Founders 👑</div>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 2 }}>Admin Dashboard</div>
        <div style={{ color: '#fef3c7', fontSize: 13, marginBottom: 16 }}>Ocealgo — May 2026</div>
        <div style={{ display: 'flex', gap: 0 }}>
          {[{ id: 'overview', label: '📊 Overview' }, { id: 'sales', label: '🤝 Sales' }, { id: 'marketing', label: '📣 Marketing' }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
              style={{ flex: 1, background: tab === t.id ? 'rgba(255,255,255,0.15)' : 'transparent', color: tab === t.id ? '#fff' : 'rgba(255,255,255,0.45)', border: 'none', borderRadius: '12px 12px 0 0', padding: '10px 6px', fontSize: 11, fontWeight: 800 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} className="fade-in">

            {/* Quick links */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {quickLinks.map(q => (
                <button key={q.screen} onClick={() => setSubScreen(q.screen)}
                  style={{ background: '#161b22', border: `1px solid ${q.color}33`, borderRadius: 14, padding: '14px', textAlign: 'left', color: '#fff' }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>{q.emoji}</div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: q.color }}>{q.label}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{q.sub}</div>
                </button>
              ))}
            </div>

            {/* Marketing summary */}
            <div style={{ background: '#161b22', borderRadius: 16, padding: 16, border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
                <svg width="64" height="64" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
                  <circle cx="32" cy="32" r="26" fill="none" stroke="#22c55e" strokeWidth="5"
                    strokeDasharray={`${2 * Math.PI * 26}`}
                    strokeDashoffset={`${2 * Math.PI * 26 * (1 - pct / 100)}`}
                    strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.8s' }} />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900, color: '#6ee7b7' }}>{pct}%</div>
              </div>
              <div>
                <div style={{ color: '#6ee7b7', fontSize: 11, letterSpacing: 1 }}>MARKETING MAY</div>
                <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1 }}>{done}<span style={{ fontSize: 14, color: '#6ee7b7' }}>/{MAY_POSTS.length}</span></div>
                <div style={{ color: '#64748b', fontSize: 12 }}>posts {missed > 0 ? `• ❌ ${missed} missed` : 'on track ✅'}</div>
              </div>
            </div>

            {/* Today's sales */}
            <div style={{ background: '#161b22', borderRadius: 16, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Sales — Today</div>
              {checkIns.length === 0 ? (
                <div style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>No check-ins yet today</div>
              ) : checkIns.map(ci => (
                <div key={ci.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div style={{ width: 40, height: 40, background: 'linear-gradient(135deg,#0891b2,#0e7490)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16, flexShrink: 0 }}>
                    {ci.name[0]}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{ci.name}</div>
                    <div style={{ fontSize: 12, color: '#16a34a' }}>✅ {ci.shops} shops • 📦 {ci.orders} orders</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SALES TAB */}
        {tab === 'sales' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} className="fade-in">
            {checkIns.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>No check-ins yet today</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>Updates appear here once the team submits</div>
              </div>
            ) : checkIns.map(ci => (
              <div key={ci.id} style={{ background: '#161b22', borderRadius: 16, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div style={{ width: 44, height: 44, background: 'linear-gradient(135deg,#0891b2,#0e7490)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 18 }}>{ci.name[0]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{ci.name}</div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>Sales • Checked in ✅</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ textAlign: 'center', background: 'rgba(8,145,178,0.1)', borderRadius: 10, padding: '8px 12px', border: '1px solid rgba(8,145,178,0.2)' }}>
                      <div style={{ fontWeight: 900, fontSize: 18, color: '#0891b2' }}>{ci.shops}</div>
                      <div style={{ fontSize: 9, color: '#64748b' }}>shops</div>
                    </div>
                    <div style={{ textAlign: 'center', background: 'rgba(22,163,74,0.1)', borderRadius: 10, padding: '8px 12px', border: '1px solid rgba(22,163,74,0.2)' }}>
                      <div style={{ fontWeight: 900, fontSize: 18, color: '#16a34a' }}>{ci.orders}</div>
                      <div style={{ fontSize: 9, color: '#64748b' }}>orders</div>
                    </div>
                  </div>
                </div>
                {[
                  { emoji: '✅', label: 'Did today',  val: ci.did,     color: '#16a34a' },
                  { emoji: '🔄', label: 'Tomorrow',   val: ci.doing,   color: '#0891b2' },
                  { emoji: '🚧', label: 'Blocker',    val: ci.blocker, color: ci.blocker === 'None' ? '#64748b' : '#dc2626' },
                ].map(r => (
                  <div key={r.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: '#475569', marginBottom: 3 }}>{r.emoji} {r.label}</div>
                    <div style={{ fontSize: 13, color: r.color, lineHeight: 1.5 }}>{r.val}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* MARKETING TAB */}
        {tab === 'marketing' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} className="fade-in">
            {weekStats.map(w => {
              const wp = Math.round((w.done / w.total) * 100)
              return (
                <div key={w.week} style={{ background: '#161b22', borderRadius: 14, padding: '14px 16px', border: `1px solid ${w.missed > 0 ? '#dc262222' : 'rgba(255,255,255,0.05)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontWeight: 800, fontSize: 14 }}>Week {w.week}</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {w.missed > 0 && <span style={{ fontSize: 10, color: '#dc2626', background: '#dc262220', padding: '2px 8px', borderRadius: 99 }}>❌ {w.missed} missed</span>}
                      <span style={{ color: '#6ee7b7', fontWeight: 800, fontSize: 13 }}>{w.done}/{w.total}</span>
                    </div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${wp}%`, height: '100%', background: wp === 100 ? '#22c55e' : 'linear-gradient(90deg,#1a5c42,#6ee7b7)', borderRadius: 99, transition: 'width 0.5s' }} />
                  </div>
                </div>
              )
            })}
            {MAY_POSTS.map(post => {
              const s = statuses[post.id] || 'pending'
              const sc = STATUS_CONFIG[s]
              const pc = PILLAR_COLORS[post.pillar] || '#1a5c42'
              return (
                <div key={post.id} style={{ background: '#161b22', borderRadius: 12, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${s === 'missed' ? '#dc262630' : s === 'posted' ? '#16a34a20' : 'rgba(255,255,255,0.04)'}` }}>
                  <div style={{ fontSize: 16 }}>{FORMAT_EMOJI[post.format]}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.topic}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                      <span style={{ fontSize: 10, color: '#64748b' }}>{post.date}</span>
                      <span style={{ fontSize: 10, color: pc }}>{post.pillar}</span>
                    </div>
                  </div>
                  <div style={{ background: sc.bg, color: sc.color, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 99, border: `1px solid ${sc.color}44`, whiteSpace: 'nowrap' }}>
                    {sc.emoji} {sc.label}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div style={{ height: 40 }} />
    </div>
  )
}
