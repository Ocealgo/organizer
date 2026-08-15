import { useState, useEffect } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import { DailyVisitLog, LeaveRecord } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { localDateStr, localMonthStr } from '../../utils/date'
import DateInput from '../../components/DateInput'
import {
  PageHeader, StatGrid, StatCard, Section, EmptyState, ChipGroup,
} from '../../components/ui'

interface Props { onBack: () => void }

type FilterMode = 'day' | 'month' | 'period'

const today = localDateStr()
const thisMonth = localMonthStr()

const OUTCOME_LABEL: Record<string, string> = {
  interested: 'Interested',
  follow_up: 'Follow up',
  not_interested: 'Not interested',
}

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

    const ownQuery = query(
      collection(db, 'visit_logs'),
      where('salesPersonId', '==', appUser.uid),
      where('date', '>=', start),
      where('date', '<=', end)
    )

    const unsubOwn = onSnapshot(ownQuery, snap => {
      const logs = snap.docs.map(d => ({ id: d.id, ...d.data() } as DailyVisitLog))
      setLogs(
        logs
          .filter(log => log.visits.length > 0)
          .sort((a, b) => b.date.localeCompare(a.date))
      )
      setLoading(false)
    })

    return () => {
      unsubOwn();
    }
  }, [appUser, filterMode, selectedDay, selectedMonth, periodFrom, periodTo])

  const totalVisits = logs.reduce((s, l) => s + l.totalVisited, 0)
  const totalInterested = logs.reduce((s, l) => s + (l.totalInterested ?? 0), 0)

  const emptyBody =
    filterMode === 'day' ? 'Nothing was logged on that day. Try another date.' :
    filterMode === 'month' ? 'Nothing was logged in that month. Try another one.' :
    'Nothing was logged in that range. Try widening it.'

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow="Visit history"
        title="My logs"
        subtitle={loading ? undefined
          : `${logs.length} day${logs.length === 1 ? '' : 's'} · ${totalVisits} visit${totalVisits === 1 ? '' : 's'}`}
        onBack={onBack}
      />

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <Section label="Period">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ChipGroup
              value={filterMode}
              onChange={setFilterMode}
              options={[
                { id: 'day' as const, label: 'A day' },
                { id: 'month' as const, label: 'A month' },
                { id: 'period' as const, label: 'Custom range' },
              ]}
            />
            {filterMode === 'day' && (
              <div style={{ maxWidth: 220 }}>
                <DateInput type="date" value={selectedDay} onChange={setSelectedDay} />
              </div>
            )}
            {filterMode === 'month' && (
              <div style={{ maxWidth: 220 }}>
                <DateInput type="month" value={selectedMonth} onChange={setSelectedMonth} />
              </div>
            )}
            {filterMode === 'period' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 460 }}>
                <DateInput type="date" value={periodFrom} onChange={setPeriodFrom} />
                <span style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>to</span>
                <DateInput type="date" value={periodTo} onChange={setPeriodTo} />
              </div>
            )}
          </div>
        </Section>

        {loading ? (
          <div style={{ fontSize: 14, fontWeight: 400, color: t.text3 }}>Loading</div>
        ) : logs.length === 0 ? (
          <EmptyState title="No logs here" body={emptyBody} />
        ) : (
          <>
            {filterMode !== 'day' && (
              <StatGrid>
                <StatCard value={logs.length} label="Days logged" />
                <StatCard value={totalVisits} label="Outlets visited" />
                <StatCard value={totalInterested} label="Interested" context="Said yes or asked for a follow-up" />
              </StatGrid>
            )}

            <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
              {logs.map(log => {
                const lr = leaveRecords.find(l => l.date === log.date && l.status !== 'removed')
                const isOpen = expandedDay === log.id || (filterMode === 'day' && logs.length === 1)
                const noEntry = (log as any).isNoEntry
                return (
                  <div key={log.id} style={{ borderTop: `0.5px solid ${t.border}`, padding: '16px 0' }}>
                    <button className="oc-action"
                      onClick={() => setExpandedDay(expandedDay === log.id ? null : log.id!)}
                      style={{ width: '100%', display: 'flex', alignItems: 'baseline', gap: 16,
                               textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 15, fontWeight: 500,
                                       color: noEntry ? t.text3 : t.text }}>
                          {new Date(log.date + 'T00:00:00')
                            .toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
                        </span>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                          {noEntry
                            ? 'Nothing logged for this day'
                            : `${log.totalVisited} visited · ${log.totalInterested} interested · ${log.totalNotInterested} declined`}
                          {lr && ` · ${lr.leaveType === 'half_day' ? 'half day leave' : 'full day leave'}`}
                        </span>
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 400, color: t.text3, whiteSpace: 'nowrap' }}>
                        {isOpen ? 'Hide' : 'Show'}
                      </span>
                    </button>

                    {isOpen && (
                      <div style={{ marginTop: 12 }}>
                        {log.visits.map((v, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 16, padding: '9px 0' }}>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ display: 'block', fontSize: 14, fontWeight: 400, color: t.text }}>
                                {v.partyName}
                              </span>
                              {(v.productName || v.notInterestedReason) && (
                                <span style={{ display: 'block', fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
                                  {v.outcome === 'interested' ? v.productName : v.notInterestedReason}
                                </span>
                              )}
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 400, whiteSpace: 'nowrap',
                                           color: v.outcome === 'interested' ? t.text2 : t.text3 }}>
                              {OUTCOME_LABEL[v.outcome ?? ''] ?? v.outcome}
                            </span>
                          </div>
                        ))}
                        {log.endOfDayNote?.trim() && (
                          <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 10, lineHeight: 1.5 }}>
                            {log.endOfDayNote}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
