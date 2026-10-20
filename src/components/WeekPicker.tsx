import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../context/ThemeContext'
import { localDateStr } from '../utils/date'
import { useHolidays } from '../data/useHolidays'

/**
 * Pick a week, and see it.
 *
 * The native date input highlights one day, so choosing "a week" with it meant
 * picking a day and trusting the app to work out the rest — nothing on screen
 * said which six days were in the report. This draws the month Monday first,
 * shades the chosen week, and previews whichever week the pointer is over.
 * Any day picks the week it belongs to.
 *
 * `days` is how many days from Monday the week covers: 6 for the report's
 * Monday-to-Saturday, where Sunday is shown but left unshaded.
 */
interface Props {
  /** The Monday of the chosen week, YYYY-MM-DD. */
  value: string
  onChange: (monday: string) => void
  days?: number
  ariaLabel?: string
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const parse = (d: string) => new Date(d + 'T00:00:00')
const plus = (d: string, n: number) => { const x = parse(d); x.setDate(x.getDate() + n); return localDateStr(x) }
const mondayOf = (d: string) => { const x = parse(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return localDateStr(x) }
const short = (d: string) => parse(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

export default function WeekPicker({ value, onChange, days = 6, ariaLabel = 'Week' }: Props) {
  const { t } = useTheme()
  const holidays = useHolidays()
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(value.slice(0, 7))   // the month on show
  const [hover, setHover] = useState<string | null>(null)  // Monday under the pointer
  const box = useRef<HTMLDivElement>(null)
  const today = localDateStr()

  // Opening always shows the chosen week's month, not wherever it was left.
  useEffect(() => { if (open) setMonth(value.slice(0, 7)) }, [open, value])

  // Closes on a tap outside, or Escape.
  useEffect(() => {
    if (!open) return
    const out = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', out)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', esc) }
  }, [open])

  /** Whole weeks covering the month on show, each starting on its Monday. */
  const weeks = useMemo(() => {
    const first = `${month}-01`
    const [y, m] = month.split('-').map(Number)
    const last = localDateStr(new Date(y, m, 0))
    const out: string[][] = []
    for (let mon = mondayOf(first); mon <= last; mon = plus(mon, 7)) {
      out.push(Array.from({ length: 7 }, (_, i) => plus(mon, i)))
    }
    return out
  }, [month])

  const stepMonth = (n: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + n, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const pick = (day: string) => { onChange(mondayOf(day)); setOpen(false) }

  const end = plus(value, days - 1)
  const monthName = parse(`${month}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  const nav: React.CSSProperties = {
    background: 'none', border: `0.5px solid ${t.border}`, borderRadius: 6, color: t.text,
    width: 32, height: 32, cursor: 'pointer', fontSize: 16, lineHeight: 1,
  }

  return (
    <div ref={box} style={{ position: 'relative', width: '100%' }}>
      <button type="button" className="oc-action" onClick={() => setOpen(o => !o)}
        aria-label={`${ariaLabel}: ${short(value)} to ${short(end)}`}
        aria-expanded={open} aria-haspopup="dialog"
        style={{
          width: '100%', textAlign: 'left', background: 'transparent', cursor: 'pointer',
          border: `0.5px solid ${t.border2}`, borderRadius: 6, padding: '12px 13px',
          minHeight: 44, fontSize: 16, color: t.text, boxSizing: 'border-box',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        }}>
        <span>
          {short(value)} – {short(end)}
          {/* A holiday inside the week, said on the field before anyone reads the report. */}
          {(() => {
            const inWeek = [...holidays.entries()].filter(([d]) => d >= value && d <= end)
            return inWeek.length > 0 && (
              <span data-testid="week-holiday" style={{ color: t.off, fontSize: 13 }}>
                {' '}· includes {inWeek.map(([, n]) => n).join(', ')}
              </span>
            )
          })()}
        </span>
        <span aria-hidden style={{ color: t.text3, fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div role="dialog" aria-label={`Choose a ${ariaLabel.toLowerCase()}`} style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
          width: 'min(320px, calc(100vw - 32px))', boxSizing: 'border-box',
          background: t.bg2, border: `0.5px solid ${t.border2}`, borderRadius: 8,
          padding: 12, boxShadow: '0 8px 24px rgba(0,0,0,.25)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button type="button" style={nav} onClick={() => stepMonth(-1)} aria-label="Previous month">‹</button>
            <span style={{ fontSize: 14, fontWeight: 500, color: t.text }}>{monthName}</span>
            <button type="button" style={nav} onClick={() => stepMonth(1)} aria-label="Next month">›</button>
          </div>

          <div role="grid" onPointerLeave={() => setHover(null)}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 2 }}>
            {WEEKDAYS.map((w, i) => (
              <div key={w} role="columnheader" style={{
                fontSize: 11, textAlign: 'center', padding: '2px 0 6px',
                color: i >= days ? t.text3 : t.text2, letterSpacing: '0.04em',
              }}>{w}</div>
            ))}
            {weeks.flatMap(week => week.map((day, i) => {
              const mon = week[0]
              const inWeek = i < days
              const chosen = mon === value && inWeek
              const previewed = mon === hover && mon !== value && inWeek
              const otherMonth = day.slice(0, 7) !== month
              const holidayName = holidays.get(day)
              const dayOff = !!holidayName || i === 6
              // The shaded run is one bar across the week: rounded only at its two ends.
              const first = i === 0, lastIn = i === days - 1
              return (
                <button key={day} type="button" role="gridcell"
                  aria-selected={chosen}
                  aria-label={`${short(day)}${holidayName ? `, holiday: ${holidayName}` : ''}${chosen ? ', in the chosen week' : ''}`}
                  title={holidayName ?? (i === 6 ? 'Sunday' : undefined)}
                  onClick={() => pick(day)}
                  onPointerEnter={() => setHover(mon)}
                  onFocus={() => setHover(mon)}
                  style={{
                    height: 36, border: 'none', cursor: 'pointer', fontSize: 13,
                    fontVariantNumeric: 'tabular-nums',
                    // A tint of the bar colour rather than the solid bar: white on the
                    // solid blue misses 4.5:1 in the dark theme, text on a tint does not.
                    background: chosen ? `${t.mark}40` : previewed ? t.hover : 'transparent',
                    // Sundays and holidays are red, in the week or out of it.
                    color: dayOff ? t.off : otherMonth || !inWeek ? t.text3 : t.text,
                    fontWeight: chosen || day === today ? 600 : 400,
                    textDecoration: day === today ? 'underline' : undefined,
                    borderRadius: chosen || previewed
                      ? `${first ? 6 : 0}px ${lastIn ? 6 : 0}px ${lastIn ? 6 : 0}px ${first ? 6 : 0}px`
                      : 6,
                  }}>
                  {Number(day.slice(8))}
                </button>
              )
            }))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        marginTop: 10, fontSize: 12, color: t.text3 }}>
            <span>Tap any day to pick its week · <span style={{ color: t.off }}>red</span> is a day off</span>
            <button type="button" className="oc-action" onClick={() => pick(today)}
              style={{ background: 'none', border: 'none', color: t.accent, cursor: 'pointer', fontSize: 12, padding: 4 }}>
              This week
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
