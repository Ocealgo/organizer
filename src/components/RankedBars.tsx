import { useState } from 'react'
import { useTheme } from '../context/ThemeContext'

/**
 * Who did most, and by how much.
 *
 * A bar rather than a pie, deliberately. A pie shows share, and share moves
 * when somebody *else* moves — a rep whose own visits were flat all month
 * appears to decline because a colleague improved, which is the one thing a
 * performance view must never do. Slices of similar size are also the hardest
 * comparison in the whole subject, and with five to eight reps most slices are
 * similar.
 *
 * One hue, magnitude by length, sorted. Every bar carries its own number at the
 * end of it, so nothing here depends on reading a colour or measuring against a
 * gridline — which is also what makes it survive a printout and a screenshot in
 * a group chat.
 *
 * No chart library: this is a div with a width, and Recharts would be a hundred
 * kilobytes to draw a rectangle.
 */

export interface RankedRow {
  id: string
  label: string
  value: number
  /**
   * What sits behind the number, for the readout on hover and focus.
   *
   * Never the only place a figure lives — the bar carries its own value and
   * the table beside it carries the rest. This is the detail a reader wants
   * once they have found the bar they care about.
   */
  detail?: string
}

interface Props {
  rows: RankedRow[]
  /** Renders the number at the end of each bar. */
  format?: (n: number) => string
  /** Shown when nothing has happened yet. */
  emptyText?: string
}

export default function RankedBars({ rows, format, emptyText }: Props) {
  const { t } = useTheme()
  const fmt = format ?? ((n: number) => n.toLocaleString('en-IN'))
  /** The bar being read — by pointer or by keyboard, the same readout either way. */
  const [active, setActive] = useState<string | null>(null)

  const sorted = [...rows].sort((a, b) => b.value - a.value)
  const max = Math.max(...sorted.map(r => r.value), 0)

  if (sorted.length === 0 || max === 0) {
    return (
      <div style={{ fontSize: 13, color: t.text3 }}>
        {emptyText ?? 'Nothing recorded in this period.'}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {sorted.map(r => {
        const on = active === r.id
        // A true zero draws no bar at all. The track still shows, so it reads
        // as "none" — where the old 2% floor drew a sliver that said a rep who
        // sold nothing had sold something.
        const width = r.value > 0 ? Math.max(1.5, (r.value / max) * 100) : 0
        return (
          // The row is the hit target, not the six pixels of bar inside it:
          // nobody aims at a line that thin, and a keyboard has to be able to
          // land on it too.
          <div key={r.id}
            tabIndex={0}
            role="group"
            aria-label={`${r.label}: ${fmt(r.value)}${r.detail ? `. ${r.detail}` : ''}`}
            onPointerEnter={() => setActive(r.id)}
            onPointerLeave={() => setActive(a => (a === r.id ? null : a))}
            onFocus={() => setActive(r.id)}
            onBlur={() => setActive(a => (a === r.id ? null : a))}
            style={{
              padding: '6px 8px', margin: '0 -8px', borderRadius: 6, outline: 'none',
              background: on ? t.hover : 'transparent', cursor: r.detail ? 'default' : undefined,
            }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 5 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: t.text,
                             overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.label}
              </span>
              {/* The number, always, in text ink rather than the bar's colour.
                  Never make anybody measure a bar. */}
              <span style={{ fontSize: 14, color: on ? t.text : t.text2, whiteSpace: 'nowrap',
                             fontWeight: on ? 500 : 400, fontVariantNumeric: 'tabular-nums' }}>
                {fmt(r.value)}
              </span>
            </div>
            {/* A track so a short bar still reads as a short bar rather than as
                a missing one. Square where it starts, rounded only at the data
                end — the end that means something. */}
            <div style={{ height: 6, background: t.tint, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                width: `${width}%`, height: '100%', background: t.mark,
                borderRadius: '0 3px 3px 0',
                // The hovered bar lifts, so the reader sees it respond.
                filter: on ? 'brightness(1.15)' : undefined,
              }} />
            </div>
            {/* The readout. Detail only — the value is already on the row. */}
            {on && r.detail && (
              <div style={{ fontSize: 12, color: t.text3, marginTop: 6, lineHeight: 1.45 }}>
                {r.detail}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
