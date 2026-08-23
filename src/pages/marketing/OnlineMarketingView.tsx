import { useState } from 'react'
import { usePostStatuses, updatePostStatus } from '../../hooks/useFirebase'
import { MAY_POSTS, STATUS_CONFIG } from '../../data'
import { PostStatus } from '../../types'
import { useTheme } from '../../context/ThemeContext'
import {
  PageHeader, Section, StatGrid, StatCard, ChipGroup,
} from '../../components/ui'

const MONTH = '2026-05'

/** Posted is the settled state; anything else still wants attention. */
const NEEDS_ATTENTION: PostStatus['status'][] = ['pending', 'in-progress', 'missed']

export default function OnlineMarketingView() {
  const { t } = useTheme()
  const { statuses, loading } = usePostStatuses(MONTH)
  const [week, setWeek] = useState<'all' | '1' | '2' | '3' | '4'>('all')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [updating, setUpdating] = useState<number | null>(null)

  const filtered = week === 'all' ? MAY_POSTS : MAY_POSTS.filter(p => p.week === parseInt(week))
  const done = MAY_POSTS.filter(p => statuses[p.id] === 'posted').length
  const missed = MAY_POSTS.filter(p => statuses[p.id] === 'missed').length
  const pct = Math.round((done / MAY_POSTS.length) * 100)

  const handleStatus = async (postId: number, status: PostStatus['status']) => {
    setUpdating(postId)
    try { await updatePostStatus(postId, status, 'marketing', MONTH) }
    finally { setUpdating(null) }
  }

  const statusKeys = Object.keys(STATUS_CONFIG) as PostStatus['status'][]

  return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow="Online marketing"
        title="May 2026 calendar"
        subtitle={loading
          ? 'Loading the schedule'
          : `${done} of ${MAY_POSTS.length} posts are out${missed > 0 ? `, ${missed} were missed` : ''}`}
      />

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <StatGrid>
          <StatCard value={loading ? '—' : `${pct}%`} label="Published" context={`${done} of ${MAY_POSTS.length}`} />
          <StatCard value={MAY_POSTS.length - done - missed} label="Still to go" />
          <StatCard value={missed} label="Missed" context={missed > 0 ? 'Reschedule or drop them' : undefined} />
        </StatGrid>

        <Section label="Week">
          <ChipGroup
            value={week}
            onChange={setWeek}
            options={[
              { id: 'all' as const, label: 'All posts' },
              { id: '1' as const, label: 'Week 1' },
              { id: '2' as const, label: 'Week 2' },
              { id: '3' as const, label: 'Week 3' },
              { id: '4' as const, label: 'Week 4' },
            ]}
          />
        </Section>

        <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
          {filtered.map(post => {
            const s = (statuses[post.id] || 'pending') as PostStatus['status']
            const isExp = expanded === post.id
            return (
              <div key={post.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '16px 0' }}>
                <button className="oc-action" onClick={() => setExpanded(isExp ? null : post.id)}
                  style={{ width: '100%', display: 'flex', alignItems: 'baseline', gap: 16,
                           textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      display: 'block', fontSize: 15, fontWeight: 500, color: t.text,
                      overflow: isExp ? 'visible' : 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: isExp ? 'normal' : 'nowrap',
                    }}>
                      {post.topic}
                    </span>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                      {post.date} · {post.pillar} · {post.format}
                    </span>
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 400, whiteSpace: 'nowrap',
                                 color: NEEDS_ATTENTION.includes(s) ? t.warn : t.text2 }}>
                    {STATUS_CONFIG[s].label}
                  </span>
                </button>

                {isExp && (
                  <div style={{ marginTop: 14 }}>
                    <ChipGroup
                      value={s}
                      onChange={key => { if (updating !== post.id) handleStatus(post.id, key) }}
                      options={statusKeys.map(key => ({ id: key, label: STATUS_CONFIG[key].label }))}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
