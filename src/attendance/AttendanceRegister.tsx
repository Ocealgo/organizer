import { useEffect, useMemo, useState } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { onSnapshot } from '../data/live'
import { db } from '../firebase'
import type { AppUser, DutySession, Holiday, LeaveRecord } from '../types'
import { useTheme } from '../context/ThemeContext'
import { localDateStr, localMonthStr } from '../utils/date'
import { GhostButton } from '../components/ui'
import AttendanceCalendar from './AttendanceCalendar'
import { Day, MARK_LETTER, MARK_LABEL, datesOfMonth, describe, monthOf, summaryOf } from './attendance'

/**
 * The team's month: a row per rep, a column per day, one letter in each cell.
 *
 * The same reading of each day as the rep's own calendar (attendance.ts), so
 * a manager and a rep looking at the same day see the same mark. Tapping a rep
 * opens that calendar — their view, read-only — for the times and the reasons.
 */
interface Props {
  reps: AppUser[]
  leaves: LeaveRecord[]
  holidays: Holiday[]
}

export default function AttendanceRegister({ reps, leaves, holidays }: Props) {
  const { t } = useTheme()
  const today = localDateStr()
  const [month, setMonth] = useState(localMonthStr())
  const [sessions, setSessions] = useState<DutySession[]>([])
  const [loaded, setLoaded] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [openRep, setOpenRep] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setLoaded(false); setReadError(null)
    const dates = datesOfMonth(month)
    return onSnapshot(
      query(collection(db, 'duty_sessions'),
        where('date', '>=', dates[0]), where('date', '<=', dates[dates.length - 1])),
      s => { setSessions(s.docs.map(d => ({ id: d.id, ...d.data() } as DutySession))); setLoaded(true) },
      err => {
        setLoaded(true)
        setReadError(err?.code === 'permission-denied'
          ? 'Firestore turned down the read. The deployed rules may be older than this build.'
          : 'Could not load the duty days.')
      },
    )
  }, [month])

  const people = useMemo(() => [...reps].sort((a, b) => a.name.localeCompare(b.name)), [reps])
  const rows = useMemo(() => people.map(r => {
    const days = monthOf(r.uid, month, today, sessions, leaves, holidays)
    return { rep: r, days, sum: summaryOf(days) }
  }), [people, month, today, sessions, leaves, holidays])
  const dates = datesOfMonth(month)

  // Today, across the team, for the month that contains it.
  const todayLine = useMemo(() => {
    if (!today.startsWith(month)) return null
    const marks = rows.map(r => r.days.find(d => d.date === today)?.mark)
    const n = (m: string[]) => marks.filter(x => x && m.includes(x)).length
    return { in: n(['present', 'auto_closed']), notYet: n(['not_yet']),
             half: n(['half']), out: n(['absent', 'leave']) }
  }, [rows, today, month])

  const step = (n: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + n, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const monthName = new Date(month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  /** The register as a spreadsheet: one sheet, a row per rep, the letters and the totals. */
  const download = async () => {
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const head = ['Rep', ...dates.map(d => Number(d.slice(8))), 'Working days', 'Present', 'Half', 'Absent', 'Leave', 'Not ended', 'No record']
      const body = rows.map(r => [
        r.rep.name, ...r.days.map(d => MARK_LETTER[d.mark] || (d.mark === 'off' ? 'Sun' : '')),
        r.sum.working, r.sum.present, r.sum.half, r.sum.absent, r.sum.leave, r.sum.autoClosed, r.sum.none,
      ])
      const sheet = XLSX.utils.aoa_to_sheet([
        ['Ocealgo — Attendance, as the app recorded it'],
        ['Month', monthName],
        ['Generated', new Date().toLocaleString('en-IN')],
        ['Key', 'P present · ½ half day · A absent · L leave · H holiday · – no record'],
        [], head, ...body,
      ])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, sheet, 'Attendance')
      XLSX.writeFile(wb, `ocealgo-attendance_${month}.xlsx`)
    } finally { setBusy(false) }
  }

  // ── one rep, opened ────────────────────────────────────────────────────────
  const opened = rows.find(r => r.rep.uid === openRep)
  if (opened) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
        <button className="oc-action" onClick={() => setOpenRep(null)}
          style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0,
                   fontSize: 13, color: t.text3, cursor: 'pointer' }}>
          ← The whole team
        </button>
        <div>
          <div style={{ fontSize: 16, fontWeight: 500, color: t.text }}>{opened.rep.name}</div>
          <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{monthName} · the same calendar they see</div>
        </div>
        <AttendanceCalendar days={opened.days} />
      </div>
    )
  }

  // ── the whole team ─────────────────────────────────────────────────────────
  const cellColour = (d: Day) =>
    d.mark === 'present' ? t.good
      : d.mark === 'auto_closed' || d.mark === 'half' || d.mark === 'absent' ? t.warn
      : d.mark === 'holiday' || d.mark === 'off' ? t.off
      : d.mark === 'leave' || d.mark === 'requested' ? t.text2 : t.text3
  const th = {
    padding: '7px 4px', fontSize: 11, fontWeight: 400, color: t.text3, textAlign: 'center' as const,
    borderBottom: `0.5px solid ${t.border}`, whiteSpace: 'nowrap' as const, background: t.bg2,
    position: 'sticky' as const, top: 0, zIndex: 1,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="oc-action" aria-label="Previous month" onClick={() => step(-1)} style={arrow(t)}>‹</button>
        <span style={{ fontSize: 15, fontWeight: 500, color: t.text, minWidth: 140 }}>{monthName}</span>
        <button className="oc-action" aria-label="Next month" onClick={() => step(1)} style={arrow(t)}>›</button>
        <span style={{ flex: 1 }} />
        <GhostButton onClick={download} disabled={busy || !loaded || rows.length === 0}>
          {busy ? 'Making the file…' : !loaded ? 'Loading…' : 'Download Excel'}
        </GhostButton>
      </div>

      {todayLine && (
        <div data-testid="attendance-today" style={{ fontSize: 13, color: t.text }}>
          Today: <b>{todayLine.in}</b> in · <b>{todayLine.notYet}</b> not started yet
          {todayLine.half > 0 && <> · <b>{todayLine.half}</b> half day</>}
          {todayLine.out > 0 && <> · <b>{todayLine.out}</b> absent or on leave</>}
        </div>
      )}
      {readError && <div style={{ fontSize: 13, color: t.warn }}>{readError}</div>}

      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: t.text3 }}>No reps whose attendance is tracked.</div>
      ) : (
        // Wide by nature — a column a day — so it scrolls sideways inside its
        // box, with the names pinned on the left so a row is never lost.
        <div style={{ overflow: 'auto', maxHeight: 520, border: `0.5px solid ${t.border}`, borderRadius: 6 }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left', left: 0, zIndex: 2, padding: '7px 10px', minWidth: 140 }}>Rep</th>
                {dates.map(d => {
                  const sun = new Date(d + 'T00:00:00').getDay() === 0
                  const hol = holidays.some(h => h.date === d)
                  return (
                    <th key={d} style={{ ...th, minWidth: 26, color: sun || hol ? t.off : d === today ? t.text : t.text3,
                                         fontWeight: d === today ? 600 : 400 }}>
                      {Number(d.slice(8))}
                    </th>
                  )
                })}
                {['P', '½', 'A', 'L', 'Not ended'].map(h => (
                  <th key={h} style={{ ...th, padding: '7px 8px', minWidth: 34 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.rep.uid} data-testid={`register-row-${r.rep.uid}`}>
                  <td style={{ position: 'sticky', left: 0, background: t.bg2, zIndex: 1, padding: '6px 10px',
                               borderBottom: `0.5px solid ${t.border}`, whiteSpace: 'nowrap' }}>
                    <button className="oc-action" onClick={() => setOpenRep(r.rep.uid)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                               color: t.text, fontSize: 13, fontWeight: 500, textAlign: 'left' }}>
                      {r.rep.name}
                    </button>
                    <div style={{ fontSize: 11, color: t.text3 }}>{r.sum.present} of {r.sum.working} present</div>
                  </td>
                  {r.days.map(d => (
                    <td key={d.date} title={`${d.date}: ${describe(d) || MARK_LABEL[d.mark]}`}
                      data-mark={d.mark}
                      style={{ textAlign: 'center', padding: '6px 2px', borderBottom: `0.5px solid ${t.border}`,
                               color: cellColour(d), fontWeight: 600,
                               background: d.mark === 'off' || d.mark === 'holiday' ? t.tint : undefined }}>
                      {MARK_LETTER[d.mark]}
                      {d.mark === 'auto_closed' && '·'}
                    </td>
                  ))}
                  {[r.sum.present, r.sum.half, r.sum.absent, r.sum.leave, r.sum.autoClosed].map((n, i) => (
                    <td key={i} style={{ textAlign: 'center', padding: '6px 8px', borderBottom: `0.5px solid ${t.border}`,
                                         color: n ? t.text : t.text3, fontVariantNumeric: 'tabular-nums' }}>{n}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 12, color: t.text3, lineHeight: 1.7 }}>
        <b style={{ color: t.good }}>P</b> present · <b style={{ color: t.warn }}>P·</b> present, day not ended
        {' · '}<b style={{ color: t.warn }}>½</b> half day · <b style={{ color: t.warn }}>A</b> absent
        {' · '}<b style={{ color: t.text2 }}>L</b> leave · <b style={{ color: t.off }}>H</b> holiday · <b>–</b> no record.
        {' '}Attendance as the app recorded it. Tap a name for that rep's own calendar, with times and reasons.
      </div>
    </div>
  )
}

const arrow = (t: any) => ({
  background: 'none', border: `0.5px solid ${t.border}`, borderRadius: 6, color: t.text,
  width: 32, height: 32, cursor: 'pointer', fontSize: 16, lineHeight: 1,
})
