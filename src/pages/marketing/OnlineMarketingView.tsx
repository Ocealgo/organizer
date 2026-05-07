import { useState } from 'react'
import { usePostStatuses, updatePostStatus } from '../../hooks/useFirebase'
import { MAY_POSTS, PILLAR_COLORS, STATUS_CONFIG } from '../../data'
import { PostStatus } from '../../types'
import { useTheme } from '../../context/ThemeContext'

const MONTH = '2026-05'

export default function OnlineMarketingView() {
  const { t } = useTheme()
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
    <div style={{ minHeight: '100vh', background: t.bg }}>
      <div style={{ background: '#000000', padding: '20px 20px 16px' }}>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Online Marketing</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', marginBottom: 2 }}>May 2026 Calendar</div>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 14 }}>Social Media Content</div>
        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>{done} of {MAY_POSTS.length} posts done</span>
            <span style={{ fontWeight: 800, color: '#fff' }}>{loading ? '...' : `${pct}%`}</span>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 99, height: 4, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: '#22c55e', borderRadius: 99, transition: 'width 0.5s' }} />
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 14px 6px', display: 'flex', gap: 6, overflowX: 'auto' }}>
        {(['all', '1', '2', '3', '4'] as const).map(w => (
          <button key={w} onClick={() => setWeek(w)}
            style={{ background: week === w ? t.primary : t.bg3, color: week === w ? t.primaryText : t.text3, border: `1px solid ${week === w ? t.primary : t.border}`, borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {w === 'all' ? 'All Posts' : `Week ${w}`}
          </button>
        ))}
      </div>

      <div style={{ padding: '8px 14px 40px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(post => {
          const s = statuses[post.id] || 'pending'
          const sc = STATUS_CONFIG[s]
          const isExp = expanded === post.id
          const pc = PILLAR_COLORS[post.pillar] || '#6b7280'
          return (
            <div key={post.id} style={{ background: t.card, borderRadius: 12, overflow: 'hidden', border: `1px solid ${t.border}` }}>
              <div onClick={() => setExpanded(isExp ? null : post.id)}
                style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <div style={{ background: t.bg3, border: `1px solid ${t.border}`, borderRadius: 8, padding: '7px 9px', textAlign: 'center', minWidth: 38 }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: t.text, lineHeight: 1 }}>{post.date.split(' ')[1]}</div>
                  <div style={{ fontSize: 9, color: t.text3, marginTop: 1 }}>May</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: pc, background: `${pc}18`, border: `1px solid ${pc}30`, padding: '2px 7px', borderRadius: 99 }}>{post.pillar}</span>
                    <span style={{ fontSize: 10, color: t.text3 }}>{post.format}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isExp ? 'normal' : 'nowrap' }}>{post.topic}</div>
                </div>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: sc.color, flexShrink: 0 }} />
              </div>
              {isExp && (
                <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${t.border}` }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingTop: 12 }}>
                    {(Object.entries(STATUS_CONFIG) as [PostStatus['status'], typeof STATUS_CONFIG[keyof typeof STATUS_CONFIG]][]).map(([key, cfg]) => (
                      <button key={key} onClick={() => handleStatus(post.id, key)} disabled={updating === post.id}
                        style={{ background: s === key ? cfg.bg : t.bg3, color: s === key ? cfg.color : t.text3, border: `1px solid ${s === key ? cfg.color + '44' : t.border}`, borderRadius: 8, padding: '9px 6px', fontSize: 12, fontWeight: s === key ? 700 : 400, opacity: updating === post.id ? 0.5 : 1 }}>
                        {cfg.label}
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
