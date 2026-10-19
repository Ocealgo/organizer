import {
  Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useTheme } from '../context/ThemeContext'

/**
 * One measure over time, this period against the one before it.
 *
 * Emphasis rather than categorical: the current period wears the accent, the
 * previous one is de-emphasis gray. That is the honest form here — the reader's
 * job is "did this go up", not "tell six series apart" — and it is the only one
 * that fits an app whose whole design rule is that colour carries meaning.
 * Two teals would have put a second accent on screen competing with the first.
 *
 * Palette checked with the skill's validator against this app's own card
 * surfaces rather than assumed: accent vs gray measures CVD ΔE 14.9 and
 * normal-vision 19.1 on dark, 18.1 / 21.6 on light — clear of both floors. The
 * light gray sits at 2.56:1, under the 3:1 bar, so the relief rule applies and
 * the series are named in the header and repeated in the tooltip; identity is
 * never carried by colour alone.
 *
 * Recharts is a heavy dependency for a phone-first app, so it is never loaded
 * on one — see LazyChart. Reports are a manager's screen.
 */

export interface TrendPoint {
  /** Axis label — a date or a month. */
  label: string
  /** Null where there is nothing yet — the line stops rather than dropping to zero. */
  current: number | null
  previous?: number | null
  /** A projection, drawn dotted in the current series' colour. */
  projected?: number | null
}

interface Props {
  data: TrendPoint[]
  /** What one unit is, for the tooltip: "visits", "orders". */
  unit: string
  /** Renders a value for the tooltip and the axis. */
  format?: (n: number) => string
  currentLabel: string
  previousLabel: string
  height?: number
  /** Draw the comparison as a dashed line — for a target, which is a line to reach rather than a past. */
  previousDashed?: boolean
  /** Names the projection series when the data carries one. */
  projectedLabel?: string
}

export default function TrendChart({
  data, unit, format, currentLabel, previousLabel, height = 220,
  previousDashed, projectedLabel,
}: Props) {
  const { t, theme } = useTheme()
  const fmt = format ?? ((n: number) => String(n))

  // The accent as the app already defines it, per mode. A chart that invented
  // its own would drift the moment the theme moved.
  const accent = t.accent
  const muted = '#94a3b8'
  const hasPrevious = data.some(d => d.previous !== undefined)
  const hasProjected = data.some(d => d.projected !== undefined && d.projected !== null)

  return (
    <div>
      {/* The legend, always present for two series and never colour-alone —
          each name sits beside its own mark. */}
      {hasPrevious && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
          {([
            [currentLabel, accent, 'solid'],
            [previousLabel, muted, previousDashed ? 'dashed' : 'solid'],
            ...(hasProjected && projectedLabel ? [[projectedLabel, accent, 'dotted']] : []),
          ] as [string, string, string][]).map(([label, colour, style]) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6,
                                       fontSize: 12, color: t.text3 }}>
              {/* The legend mark draws the line the way the chart does, so a
                  dashed target and a dotted projection are told apart by shape,
                  not only by colour. */}
              <span style={{ width: 14, height: 0, borderTop: `2px ${style} ${colour}` }} />
              {label}
            </span>
          ))}
        </div>
      )}

      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
            <defs>
              {/* A wash under the current series only. The comparison line stays
                  a line so the two never read as competing areas. */}
              <linearGradient id="oc-trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={theme === 'dark' ? 0.22 : 0.16} />
                <stop offset="100%" stopColor={accent} stopOpacity={0} />
              </linearGradient>
            </defs>

            {/* Recessive chrome — hairlines, horizontal only, no vertical rules
                cutting the data into boxes. */}
            <CartesianGrid stroke={t.border} strokeWidth={0.5} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: t.text3, fontSize: 11 }}
              tickLine={false} axisLine={{ stroke: t.border }} minTickGap={18} />
            <YAxis tick={{ fill: t.text3, fontSize: 11 }} tickLine={false}
              axisLine={false} width={54} tickFormatter={fmt} allowDecimals={false} />

            <Tooltip
              cursor={{ stroke: t.border2, strokeWidth: 1 }}
              contentStyle={{
                background: t.bg2, border: `0.5px solid ${t.border2}`,
                borderRadius: 6, fontSize: 12, color: t.text, padding: '8px 10px',
              }}
              labelStyle={{ color: t.text3, marginBottom: 4 }}
              // Names, not just colours — the relief rule for the light-mode
              // gray, and the thing that makes the chart readable in print.
              formatter={(value: any, name: any) => [
                value === null || value === undefined ? '—' : `${fmt(Number(value))} ${unit}`,
                name === 'current' ? currentLabel
                  : name === 'projected' ? (projectedLabel ?? 'Projected') : previousLabel,
              ]}
            />

            {hasPrevious && (
              <Line type="monotone" dataKey="previous" stroke={muted} strokeWidth={2}
                strokeDasharray={previousDashed ? '6 4' : undefined}
                dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
            )}
            {hasProjected && (
              <Line type="monotone" dataKey="projected" stroke={accent} strokeWidth={2}
                strokeDasharray="2 4" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
            )}
            <Area type="monotone" dataKey="current" stroke={accent} strokeWidth={2}
              fill="url(#oc-trend-fill)" dot={false}
              // A 2px surface ring so the marker reads against whatever it
              // overlaps, including the comparison line.
              activeDot={{ r: 4, strokeWidth: 2, stroke: t.bg2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
