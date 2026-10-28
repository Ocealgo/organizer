import { useEffect, useMemo, useState } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { onSnapshot } from '../data/live'
import { db } from '../firebase'
import type { AppUser, DutySession, Holiday, LeaveRecord } from '../types'
import { useTheme } from '../context/ThemeContext'
import { localDateStr, localMonthStr } from '../utils/date'
import { GhostButton } from '../components/ui'
import { HolidayNote } from '../components/DayPicker'
import AttendanceCalendar from './AttendanceCalendar'
import { Day, MARK_LETTER, MARK_LABEL, REGISTER_TOTALS as TOTALS, datesOfMonth, describe, fmtDays, monthOf, summaryOf } from './attendance'


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
    const h = holidays.find(x => x.date === today)
    const off = h ? `Holiday — ${h.name}` : new Date(today + 'T00:00:00').getDay() === 0 ? 'Sunday' : null
    return { in: n(['present', 'auto_closed']), notYet: n(['not_yet']),
             half: n(['half']), out: n(['absent', 'leave']), off }
  }, [rows, today, month, holidays])

  const step = (n: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + n, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const monthName = new Date(month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  /** The register as a PDF: the month on one landscape page, a letter a day, the totals and the key. */
  const download = async () => {
    setBusy(true)
    try {
      const { downloadAttendancePdf } = await import('./attendancePdf')
      await downloadAttendancePdf(month, dates,
        rows.map(r => ({ name: r.rep.name, days: r.days, sum: r.sum })), holidays)
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
    d.mark === 'present' || d.mark === 'auto_closed' ? t.good
      : d.mark === 'half' || d.mark === 'absent' ? t.warn
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
          {busy ? 'Making the PDF…' : !loaded ? 'Loading…' : 'Download PDF'}
        </GhostButton>
      </div>

      {/* The month's holidays by name — the H in a column says which day, this says what. */}
      <HolidayNote from={dates[0]} to={dates[dates.length - 1]} />

      {todayLine && (
        todayLine.off ? (
        // A day off: nobody is expected, so "0 in · 0 not started" would only mislead.
        <div data-testid="attendance-today" style={{ fontSize: 13, color: t.off }}>
          Today: {todayLine.off} — a day off for everyone
          {todayLine.in > 0 && <span style={{ color: t.text }}> · <b>{todayLine.in}</b> working anyway</span>}
        </div>
        ) :
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
                <th style={{ ...th, textAlign: 'left', left: 0, zIndex: 2, padding: '7px 10px', minWidth: 140 }}>Name</th>
                {dates.map(d => {
                  const sun = new Date(d + 'T00:00:00').getDay() === 0
                  const hol = holidays.some(h => h.date === d)
                  return (
                    <th key={d} title={hol ? holidays.find(h => h.date === d)?.name : sun ? 'Sunday' : undefined}
                      style={{ ...th, minWidth: 26, color: sun || hol ? t.off : d === today ? t.text : t.text3,
                                         fontWeight: d === today ? 600 : 400 }}>
                      {Number(d.slice(8))}
                    </th>
                  )
                })}
                {TOTALS.map(c => (
                  <th key={c.head} title={c.title} style={{ ...th, padding: '7px 8px', minWidth: 52,
                    color: c.key ? t.text : t.text3, fontWeight: c.key ? 600 : 400 }}>{c.head}</th>
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
                               background: d.dayOff ? t.tint : undefined,
                               // Worked on a day off: a red underline beneath the P says so.
                               boxShadow: d.dayOff && (d.mark === 'present' || d.mark === 'auto_closed')
                                 ? `inset 0 -2px 0 ${t.off}` : undefined }}>
                      {MARK_LETTER[d.mark]}
                    </td>
                  ))}
                  {TOTALS.map(c => {
                    const n = c.of(r.sum)
                    return (
                      <td key={c.head} title={c.title} data-testid={`register-${c.head.toLowerCase().replace(/ /g, '-')}-${r.rep.uid}`}
                        style={{ textAlign: 'center', padding: '6px 8px', borderBottom: `0.5px solid ${t.border}`,
                                 color: n ? t.text : t.text3, fontWeight: c.key ? 600 : 400,
                                 fontVariantNumeric: 'tabular-nums' }}>{c.days ? fmtDays(n) : n}</td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 12, color: t.text3, lineHeight: 1.7 }}>
        <b style={{ color: t.good }}>P</b> present
        {' · '}<b style={{ color: t.warn }}>½</b> half day · <b style={{ color: t.warn }}>A</b> absent
        {' · '}<b style={{ color: t.text2 }}>L</b> leave · <b style={{ color: t.off }}>H</b> holiday · <b>–</b> no record
        {' · '}a shaded <b style={{ color: t.good }}>P</b> underlined in red was worked on a day off.
        {' '}<b>Leave taken</b> adds up the days off: a leave or an absence is one, a half day is half, so two half days make one —
        {' '}split into <b>Applied</b> (asked for and approved) and <b>Automatic</b> (no punch-in).
        {' '}Attendance as the app recorded it. Tap a name for that rep's own calendar, with times and reasons.
      </div>
    </div>
  )
}

const arrow = (t: any) => ({
  background: 'none', border: `0.5px solid ${t.border}`, borderRadius: 6, color: t.text,
  width: 32, height: 32, cursor: 'pointer', fontSize: 16, lineHeight: 1,
})
