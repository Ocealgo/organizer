import { useState } from 'react'
import { usePostStatuses, updatePostStatus } from '../../hooks/useFirebase'
import { MAY_POSTS, PILLAR_COLORS, FORMAT_EMOJI, STATUS_CONFIG } from '../../data'
import { PostStatus } from '../../types'

const MONTH = '2026-05'

export default function OnlineMarketingView() {
  const { statuses, loading } = usePostStatuses(MONTH)
  const [week, setWeek] = useState<'all' | '1' | '2' | '3' | '4'>('all')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [updating, setUpdating] = useState<number | null>(null)

  const filtered = week === 'all' ? MAY_POSTS : MAY_POSTS.filter(p => p.week === parseInt(week))
  const done = MAY_POSTS.filter(p => statuses[p.id] === 'posted').length
  const pct = Math.round((done / MAY_POSTS.length) * 100)

  const handleStatus = async (postId: number, status: PostStatus['status']) => {
    setUpdating(postId)
    try { await updatePostStatus(postId, status, 'marketing', MONTH) }
    finally { setUpdating(null) }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117' }}>
      <div style={{ background: 'linear-gradient(135deg,#4c1d95,#6d28d9)', padding: '16px 20px 14px', borderRadius: '0 0 24px 24px' }}>
        <div style={{ color: '#c4b5fd', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>💻 Online Marketing</div>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 2 }}>May 2026 Calendar</div>
        <div style={{ color: '#ddd6fe', fontSize: 13, marginBottom: 14 }}>Social Media Content</div>
        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: '#c4b5fd' }}>{done} of {MAY_POSTS.length} posts done</span>
            <span style={{ fontWeight: 900, color: '#a78bfa' }}>{loading ? '...' : `${pct}%`}</span>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 99, height: 8, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#7c3aed,#a78bfa)', borderRadius: 99, transition: 'width 0.5s' }} />
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 14px 6px', display: 'flex', gap: 6, overflowX: 'auto' }}>
        {(['all', '1', '2', '3', '4'] as const).map(w => (
          <button key={w} onClick={() => setWeek(w)}
            style={{ background: week === w ? '#4c1d95' : 'rgba(255,255,255,0.05)', color: week === w ? '#c4b5fd' : '#64748b', border: `1px solid ${week === w ? '#7c3aed' : 'rgba(255,255,255,0.08)'}`, borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {w === 'all' ? 'All Posts' : `Week ${w}`}
          </button>
        ))}
      </div>

      <div style={{ padding: '8px 14px 40px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(post => {
          const s = statuses[post.id] || 'pending'
          const sc = STATUS_CONFIG[s]
          const isExp = expanded === post.id
          const pc = PILLAR_COLORS[post.pillar] || '#1a5c42'
          return (
            <div key={post.id} style={{ background: '#161b22', borderRadius: 14, overflow: 'hidden', border: `1px solid ${s === 'posted' ? '#16a34a33' : s === 'missed' ? '#dc262633' : 'rgba(255,255,255,0.05)'}` }}>
              <div onClick={() => setExpanded(isExp ? null : post.id)}
                style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '7px 9px', textAlign: 'center', minWidth: 38 }}>
                  <div style={{ fontSize: 14, fontWeight: 900, lineHeight: 1 }}>{post.date.split(' ')[1]}</div>
                  <div style={{ fontSize: 9, color: '#64748b', marginTop: 1 }}>May</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: pc, background: `${pc}22`, padding: '2px 7px', borderRadius: 99 }}>{post.pillar}</span>
                    <span style={{ fontSize: 10, color: '#475569' }}>{FORMAT_EMOJI[post.format]}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isExp ? 'normal' : 'nowrap' }}>{post.topic}</div>
                </div>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: sc.color, flexShrink: 0 }} />
              </div>
              {isExp && (
                <div style={{ padding: '0 14px 14px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {(Object.entries(STATUS_CONFIG) as [PostStatus['status'], typeof STATUS_CONFIG[keyof typeof STATUS_CONFIG]][]).map(([key, cfg]) => (
                      <button key={key} onClick={() => handleStatus(post.id, key)} disabled={updating === post.id}
                        style={{ background: s === key ? cfg.bg : 'rgba(255,255,255,0.03)', color: s === key ? cfg.color : '#475569', border: `1.5px solid ${s === key ? cfg.color : 'rgba(255,255,255,0.05)'}`, borderRadius: 10, padding: '9px 6px', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, opacity: updating === post.id ? 0.5 : 1 }}>
                        {cfg.emoji} {cfg.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
