import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../context/ThemeContext'
import { localDateStr } from '../utils/date'
import { useHolidays } from '../data/useHolidays'

/**
 * A day, picked on a calendar that shows the days off.
 *
 * The field stays a date input you can type into; only the calendar it opens is
 * the app's own, because the browser's cannot colour a day. Sundays and the
 * declared holidays are red in it, a holiday's name is on hover, and a day off
 * picked is said under the field — so a report run for a holiday says so before
 * anybody reads an empty card as a bad day.
 */
interface Props {
  value: string
  onChange: (date: string) => void
  ariaLabel?: string
  min?: string
  max?: string
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const parse = (d: string) => new Date(d + 'T00:00:00')
const isSun = (d: string) => parse(d).getDay() === 0

/** What a day off is, in words — or null for a working day. */
export function dayOffLabel(date: string, holidays: Map<string, string>): string | null {
  if (!date) return null
  const h = holidays.get(date)
  if (h) return `Holiday — ${h}`
  return isSun(date) ? 'Sunday' : null
}

export default function DayPicker({ value, onChange, ariaLabel, min, max }: Props) {
  const { t, theme } = useTheme()
  const holidays = useHolidays()
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState((value || localDateStr()).slice(0, 7))
  const box = useRef<HTMLDivElement>(null)
  const today = localDateStr()
  const off = dayOffLabel(value, holidays)

  useEffect(() => { if (open) setMonth((value || localDateStr()).slice(0, 7)) }, [open, value])
  useEffect(() => {
    if (!open) return
    const out = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', out); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', esc) }
  }, [open])

  const cells = useMemo(() => {
    const first = `${month}-01`
    const lead = (parse(first).getDay() + 6) % 7
    const [y, m] = month.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    return [...Array(lead).fill(null), ...Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)]
  }, [month])
  const step = (n: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + n, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const nav: React.CSSProperties = {
    background: 'none', border: `0.5px solid ${t.border}`, borderRadius: 6, color: t.text,
    width: 32, height: 32, cursor: 'pointer', fontSize: 16, lineHeight: 1,
  }

  return (
    <div ref={box} style={{ position: 'relative', width: '100%' }}>
      <input type="date" className="oc-date-own" value={value} min={min} max={max}
        aria-label={ariaLabel}
        onChange={e => onChange(e.target.value)}
        // A press opens this calendar rather than the browser's; the keyboard
        // can still tab in and type a date.
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
        onTouchStart={e => { e.preventDefault(); setOpen(o => !o) }}
        style={{
          width: '100%', background: 'transparent', border: `0.5px solid ${off ? t.off : t.border2}`,
          borderRadius: 6, padding: '12px 13px', fontSize: 16, minHeight: 44, boxSizing: 'border-box',
          color: off ? t.off : value ? t.text : t.text3, outline: 'none', cursor: 'pointer',
          colorScheme: theme === 'dark' ? 'dark' : 'light',
        }} />
      {off && (
        <div data-testid="day-off-note" style={{ fontSize: 12, color: t.off, marginTop: 4 }}>{off} · a day off</div>
      )}

      {open && (
        <div role="dialog" aria-label="Choose a day" style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
          width: 'min(320px, calc(100vw - 32px))', boxSizing: 'border-box',
          background: t.bg2, border: `0.5px solid ${t.border2}`, borderRadius: 8,
          padding: 12, boxShadow: '0 8px 24px rgba(0,0,0,.25)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button type="button" style={nav} onClick={() => step(-1)} aria-label="Previous month">‹</button>
            <span style={{ fontSize: 14, fontWeight: 500, color: t.text }}>
              {parse(`${month}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </span>
            <button type="button" style={nav} onClick={() => step(1)} aria-label="Next month">›</button>
          </div>
          <div role="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 2 }}>
            {WEEKDAYS.map((w, i) => (
              <div key={w} role="columnheader" style={{
                fontSize: 11, textAlign: 'center', padding: '2px 0 6px', color: i === 6 ? t.off : t.text2,
              }}>{w}</div>
            ))}
            {cells.map((d, i) => {
              if (!d) return <div key={`b${i}`} aria-hidden />
              const h = holidays.get(d)
              const red = !!h || isSun(d)
              const chosen = d === value
              const blocked = (min && d < min) || (max && d > max)
              return (
                <button key={d} type="button" role="gridcell" aria-selected={chosen}
                  aria-label={`${d}${h ? `, holiday: ${h}` : isSun(d) ? ', Sunday' : ''}`}
                  title={h ?? (isSun(d) ? 'Sunday' : undefined)}
                  disabled={!!blocked}
                  onClick={() => { onChange(d); setOpen(false) }}
                  style={{
                    height: 36, border: 'none', borderRadius: 6, cursor: blocked ? 'default' : 'pointer',
                    fontSize: 13, fontVariantNumeric: 'tabular-nums', opacity: blocked ? 0.35 : 1,
                    background: chosen ? `${t.mark}40` : 'transparent',
                    color: red ? t.off : t.text, fontWeight: chosen || d === today ? 600 : 400,
                    textDecoration: d === today ? 'underline' : undefined,
                  }}>
                  {Number(d.slice(8))}
                  {h && <span aria-hidden style={{ display: 'block', height: 3, width: 3, borderRadius: 2,
                                                   background: t.off, margin: '1px auto 0' }} />}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12, color: t.text3 }}>
            <span><span style={{ color: t.off }}>Red</span> — Sunday or holiday</span>
            <button type="button" onClick={() => { onChange(today); setOpen(false) }}
              style={{ background: 'none', border: 'none', color: t.accent, cursor: 'pointer', fontSize: 12, padding: 4 }}>
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The days off inside a window, said in red under a month or range filter —
 * where no calendar is open to show them.
 */
export function HolidayNote({ from, to }: { from: string; to: string }) {
  const { t } = useTheme()
  const holidays = useHolidays()
  if (!from || !to) return null
  const [a, b] = from <= to ? [from, to] : [to, from]
  const inside = [...holidays.entries()].filter(([d]) => d >= a && d <= b).sort(([x], [y]) => x.localeCompare(y))
  if (inside.length === 0) return null
  const day = (d: string) => parse(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
  return (
    <div data-testid="holiday-note" style={{ fontSize: 12, color: t.off, marginTop: 6, lineHeight: 1.5 }}>
      Includes {inside.length === 1 ? 'a holiday' : `${inside.length} holidays`}:{' '}
      {inside.map(([d, n]) => `${n} (${day(d)})`).join(', ')}
    </div>
  )
}

