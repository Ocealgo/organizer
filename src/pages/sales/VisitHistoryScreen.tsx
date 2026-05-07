import React, { useState, useEffect } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { DailyVisitLog, LeaveRecord } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { localDateStr, localMonthStr } from '../../utils/date'

interface Props { onBack: () => void }

type FilterMode = 'day' | 'month' | 'period'

const today = localDateStr()
const thisMonth = localMonthStr()

export default function VisitHistoryScreen({ onBack }: Props) {
  const { appUser } = useAuth()
  const { t } = useTheme()

  const [filterMode, setFilterMode] = useState<FilterMode>('month')
  const [selectedDay, setSelectedDay] = useState(today)
  const [selectedMonth, setSelectedMonth] = useState(thisMonth)
  const [periodFrom, setPeriodFrom] = useState(thisMonth + '-01')
  const [periodTo, setPeriodTo] = useState(today)

  const [logs, setLogs] = useState<DailyVisitLog[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([])

  useEffect(() => {
    if (!appUser) return
    const q = query(collection(db, 'leave_records'), where('uid', '==', appUser.uid))
    return onSnapshot(q, snap => {
      setLeaveRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRecord)))
    })
  }, [appUser])

  useEffect(() => {
    if (!appUser) return
    setLoading(true)
    setExpandedDay(null)

    let start: string, end: string
    if (filterMode === 'day') {
      start = selectedDay
      end = selectedDay
    } else if (filterMode === 'month') {
      start = selectedMonth + '-01'
      end = selectedMonth + '-31'
    } else {
      start = periodFrom
      end = periodTo
    }

    const q = query(
      collection(db, 'visit_logs'),
      where('salesPersonId', '==', appUser.uid),
      where('date', '>=', start),
      where('date', '<=', end)
    )
    return onSnapshot(q, snap => {
      setLogs(
        snap.docs.map(d => ({ id: d.id, ...d.data() } as DailyVisitLog))
          .sort((a, b) => b.date.localeCompare(a.date))
      )
      setLoading(false)
    })
  }, [appUser, filterMode, selectedDay, selectedMonth, periodFrom, periodTo])

  const totalVisits = logs.reduce((s, l) => s + l.totalVisited, 0)
  const totalInterested = logs.reduce((s, l) => s + l.totalInterested, 0)

  const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 10, padding: '10px 14px', fontSize: 16, color: '#fff',
    outline: 'none', colorScheme: 'dark' as any,
  }

  const emptyLabel =
    filterMode === 'day' ? 'No log for this day' :
    filterMode === 'month' ? 'No logs for this month' :
    'No logs for this period'

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ background: '#000000', padding: '20px 20px 16px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'rgba(255,255,255,0.7)', padding: '6px 14px', borderRadius: 20, fontSize: 13, marginBottom: 14 }}>← Back</button>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Visit History</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', marginBottom: 14 }}>My Logs</div>

        {/* Mode tabs */}
        <div style={{ display: 'flex', background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 4, gap: 4, marginBottom: 14 }}>
          {([['day', 'Day'], ['month', 'Month'], ['period', 'Period']] as [FilterMode, string][]).map(([mode, label]) => (
            <button key={mode} onClick={() => setFilterMode(mode)}
              style={{ flex: 1, background: filterMode === mode ? 'rgba(255,255,255,0.18)' : 'transparent', color: filterMode === mode ? '#fff' : 'rgba(255,255,255,0.5)', border: 'none', borderRadius: 8, padding: '8px 4px', fontSize: 13, fontWeight: 700 }}>
              {label}
            </button>
          ))}
        </div>

        {/* Date picker for each mode */}
        {filterMode === 'day' && (
          <input type="date" value={selectedDay} onChange={e => setSelectedDay(e.target.value)} style={inputStyle} />
        )}
        {filterMode === 'month' && (
          <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={inputStyle} />
        )}
        {filterMode === 'period' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>→</span>
            <input type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
          </div>
        )}
      </div>

      <div style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>Loading…</div>
        ) : logs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#475569' }}>
            <div style={{ fontSize: 36, marginBottom: 12, color: t.text3 }}>—</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: t.text2 }}>{emptyLabel}</div>
            <div style={{ fontSize: 13, marginTop: 6, color: t.text3 }}>Try a different date range</div>
          </div>
        ) : (
          <>
            {/* Summary strip — only for multi-day views */}
            {filterMode !== 'day' && (
              <div style={{ background: t.card, borderRadius: 14, padding: '14px 16px', border: `1px solid ${t.border}`, display: 'flex', gap: 8, marginBottom: 4 }}>
                {[
                  { label: 'Days', val: logs.length, color: '#fff' },
                  { label: 'Visits', val: totalVisits, color: t.text },
                  { label: 'Interested', val: totalInterested, color: '#22c55e' },
                ].map(s => (
                  <div key={s.label} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.val}</div>
                    <div style={{ fontSize: 11, color: t.text3, marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            {logs.map(log => (
              <div key={log.id} style={{ background: t.card, borderRadius: 14, border: `1px solid ${t.border}`, overflow: 'hidden' }}>
                {/* Day header — auto-expand for single-day view */}
                <button
                  onClick={() => setExpandedDay(expandedDay === log.id ? null : log.id!)}
                  style={{ width: '100%', background: 'none', border: 'none', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', textAlign: 'left' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ fontWeight: 800, fontSize: 15, color: (log as any).isNoEntry ? t.text3 : t.text }}>
                        {log.date}
                      </div>
                      {(() => {
                        const lr = leaveRecords.find(l => l.date === log.date && l.status !== 'removed')
                        if (!lr) return null
                        return (
                          <span style={{ fontSize: 10, fontWeight: 800, background: lr.leaveType === 'half_day' ? 'rgba(59,130,246,0.15)' : 'rgba(245,158,11,0.15)', color: lr.leaveType === 'half_day' ? '#3b82f6' : '#f59e0b', padding: '2px 7px', borderRadius: 99 }}>
                            {lr.leaveType === 'half_day' ? 'Half Day Leave' : 'Full Day Leave'}
                          </span>
                        )
                      })()}
                    </div>
                    {(log as any).isNoEntry ? (
                      <div style={{ fontSize: 13, color: t.text3, marginTop: 2, fontStyle: 'italic' }}>No entry for this day</div>
                    ) : (
                      <div style={{ fontSize: 13, color: t.text3, marginTop: 2 }}>
                        {log.totalVisited} visited ·{' '}
                        <span style={{ color: '#22c55e' }}>{log.totalInterested} interested</span> ·{' '}
                        {log.totalNotInterested} declined
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {log.totalInterested > 0 && (
                      <span style={{ fontSize: 11, background: 'rgba(34,197,94,0.12)', color: '#22c55e', padding: '3px 10px', borderRadius: 99, fontWeight: 700 }}>
                        {log.totalInterested}
                      </span>
                    )}
                    <span style={{ color: t.text3, fontSize: 14 }}>{expandedDay === log.id ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* Expanded visit list */}
                {(expandedDay === log.id || (filterMode === 'day' && logs.length === 1)) && (
                  <div style={{ borderTop: `1px solid ${t.border}`, padding: '8px 12px 12px' }}>
                    {log.visits.map((v, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px', borderRadius: 10, marginBottom: 4, background: 'rgba(255,255,255,0.02)' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: v.outcome === 'interested' ? '#22c55e' : v.outcome === 'follow_up' ? '#f59e0b' : '#ef4444', flexShrink: 0, marginTop: 4 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: t.text }}>{v.partyName}</div>
                          {v.outcome === 'interested' && v.productName && (
                            <div style={{ fontSize: 13, color: '#22c55e' }}>{v.productName}</div>
                          )}
                          {v.outcome === 'not_interested' && v.notInterestedReason && (
                            <div style={{ fontSize: 13, color: '#ef4444' }}>{v.notInterestedReason}</div>
                          )}
                          {v.outcome === 'follow_up' && (
                            <div style={{ fontSize: 13, color: '#f59e0b' }}>Follow up</div>
                          )}
                        </div>
                      </div>
                    ))}
                    {log.endOfDayNote?.trim() && (
                      <div style={{ fontSize: 13, color: t.text3, marginTop: 8, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                        {log.endOfDayNote}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
