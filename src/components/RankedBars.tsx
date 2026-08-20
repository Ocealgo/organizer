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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sorted.map(r => (
        <div key={r.id}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 5 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: t.text,
                           overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.label}
            </span>
            {/* The number, always. Never make anybody measure a bar. */}
            <span style={{ fontSize: 14, color: t.text2, whiteSpace: 'nowrap',
                           fontVariantNumeric: 'tabular-nums' }}>
              {fmt(r.value)}
            </span>
          </div>
          {/* A track so a short bar still reads as a short bar rather than as
              a missing one, and a 4px end on the data only. */}
          <div style={{ height: 6, background: t.tint, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.max(2, (r.value / max) * 100)}%`,
              height: '100%', background: t.accent, borderRadius: 3,
            }} />
          </div>
        </div>
      ))}
    </div>
  )
}
