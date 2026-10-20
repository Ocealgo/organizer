import { useState } from 'react'
import { useTheme } from '../context/ThemeContext'
import { Day, MARK_LABEL, MARK_LETTER, describe, summaryOf } from './attendance'

/**
 * A month of attendance, Monday first — the same calendar the rep sees and an
 * admin opens for that rep, so both are looking at one picture.
 *
 * Each day carries a letter as well as a colour (P, ½, A, L, H), so a mark
 * never rests on colour alone. Tapping a day says what it was in a sentence,
 * and on the rep's own calendar offers the appeal where one is allowed.
 */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Props {
  days: Day[]
  /** The rep's own calendar offers an appeal on an automatic mark; an admin's does not. */
  onAppeal?: (d: Day) => void
}

export default function AttendanceCalendar({ days, onAppeal }: Props) {
  const { t } = useTheme()
  const [picked, setPicked] = useState<string | null>(null)
  const sum = summaryOf(days)
  const lead = days.length ? (new Date(days[0].date + 'T00:00:00').getDay() + 6) % 7 : 0
  const pickedDay = days.find(d => d.date === picked) ?? null

  const tone = (d: Day) =>
    d.mark === 'present' ? t.good
      : d.mark === 'auto_closed' ? t.good
      : d.mark === 'half' || d.mark === 'absent' ? t.warn
      : d.mark === 'off' || d.mark === 'holiday' ? t.off
      : d.mark === 'leave' || d.mark === 'requested' ? t.text2
      : t.text3

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* The month in one line, the way a person would say it. */}
      <div data-testid="attendance-summary" style={{ fontSize: 13, color: t.text, lineHeight: 1.6 }}>
        <b>{sum.present}</b> of {sum.working} working {sum.working === 1 ? 'day' : 'days'} present
        {sum.half > 0 && <> · <b>{sum.half}</b> half {sum.half === 1 ? 'day' : 'days'}</>}
        {sum.absent > 0 && <> · <b>{sum.absent}</b> absent</>}
        {sum.leave > 0 && <> · <b>{sum.leave}</b> on leave</>}
        {sum.autoClosed > 0 && <span style={{ color: t.warn }}> · {sum.autoClosed} not ended</span>}
        {sum.offWorked > 0 && <span style={{ color: t.off }}> · {sum.offWorked} worked on a day off</span>}
        {sum.appealsPending > 0 && <span style={{ color: t.warn }}> · {sum.appealsPending} appeal pending</span>}
      </div>

      <div className="oc-scroll-x">
        <div role="grid" aria-label="Attendance" style={{
          display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 5, minWidth: 300,
        }}>
          {WEEKDAYS.map((w, i) => (
            <div key={w} role="columnheader" style={{
              fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '0 2px 2px',
              color: i === 6 ? t.off : t.text3,
            }}>{w}</div>
          ))}
          {Array.from({ length: lead }, (_, i) => <div key={`blank_${i}`} aria-hidden />)}
          {days.map(d => {
            const c = tone(d)
            const on = picked === d.date
            const quiet = d.mark === 'future' || d.mark === 'off' || d.mark === 'not_yet'
            return (
              <button key={d.date} role="gridcell" className="oc-action"
                aria-label={`${d.date}: ${MARK_LABEL[d.mark] || 'nothing yet'}`}
                aria-pressed={on}
                data-mark={d.mark}
                onClick={() => setPicked(on ? null : d.date)}
                style={{
                  height: 46, borderRadius: 6, cursor: 'pointer', padding: '4px 6px',
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  alignItems: 'flex-start', textAlign: 'left',
                  background: on ? t.hover : quiet ? 'transparent' : t.card,
                  border: `${on ? 1 : 0.5}px solid ${d.dayOff ? t.off : on ? t.text2 : t.border}`,
                }}>
                <span style={{ fontSize: 11, color: d.dayOff ? t.off : t.text3 }}>
                  {Number(d.date.slice(8))}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: c, lineHeight: 1 }}>
                  {MARK_LETTER[d.mark]}
                  {d.mark === 'auto_closed' && <span style={{ color: t.warn }}>·</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* The key, so a letter is never a puzzle. */}
      <div style={{ fontSize: 11, color: t.text3, lineHeight: 1.7 }}>
        <b style={{ color: t.good }}>P</b> present · <b style={{ color: t.warn }}>P·</b> present, day not ended
        {' · '}<b style={{ color: t.warn }}>½</b> half day · <b style={{ color: t.warn }}>A</b> absent
        {' · '}<b style={{ color: t.text2 }}>L</b> leave · <b style={{ color: t.off }}>H</b> holiday
        {' · '}<b>–</b> no record · <span style={{ color: t.off }}>red border</span> a day off, <b style={{ color: t.good }}>P</b> inside if worked
      </div>

      {pickedDay && (
        <div data-testid="attendance-detail" style={{
          border: `0.5px solid ${t.border2}`, borderRadius: 6, padding: '12px 14px', background: t.card,
        }}>
          <div style={{ fontSize: 12, color: t.text3, marginBottom: 4 }}>
            {new Date(pickedDay.date + 'T00:00:00').toLocaleDateString('en-IN',
              { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <div style={{ fontSize: 14, color: t.text, lineHeight: 1.5 }}>{describe(pickedDay) || 'Nothing yet.'}</div>
          {onAppeal && pickedDay.automatic && pickedDay.leave && !pickedDay.appealPending && (
            <button className="oc-action" onClick={() => onAppeal(pickedDay)}
              style={{ marginTop: 10, background: 'none', border: `0.5px solid ${t.border2}`, borderRadius: 6,
                       padding: '8px 12px', fontSize: 13, color: t.text, cursor: 'pointer' }}>
              This is wrong — appeal it
            </button>
          )}
        </div>
      )}
    </div>
  )
}
