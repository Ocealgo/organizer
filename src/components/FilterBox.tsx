import { ReactNode } from 'react'
import { useTheme } from '../context/ThemeContext'

/**
 * A box around a set of filters and everything they change.
 *
 * The filter goes inside the box with what it narrows, and nothing it does not
 * narrow goes in, so "which of this did the dates just change?" is answered by
 * the border. The note says it in words for the reader who is not looking at
 * borders.
 */
export function FilterBox({ title, note, children, testId }: {
  title?: string
  /** One line: what the filters in this box change. */
  note?: string
  children: ReactNode
  testId?: string
}) {
  const { t } = useTheme()
  return (
    <section data-testid={testId} style={{
      background: t.card, border: `0.5px solid ${t.border2}`, borderRadius: 8,
      padding: '16px 16px 18px', display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0,
    }}>
      {(title || note) && (
        <div style={{ marginBottom: -6 }}>
          {title && <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{title}</div>}
          {note && (
            <div style={{ fontSize: 12, color: t.text2, marginTop: title ? 3 : 0, lineHeight: 1.5 }}>{note}</div>
          )}
        </div>
      )}
      {children}
    </section>
  )
}

/**
 * A list that stops growing at about ten entries and scrolls inside its own
 * box after that, so a long list never pushes everything below it off the
 * screen. Short lists are left exactly as they were.
 *
 * `count` is how many entries there are. The cap is a height rather than a row
 * count, because rows are not all the same height; it is set to roughly ten
 * ordinary rows.
 */
export function ScrollList({ count, children, max = 10, height = 560, label = 'entries', testId }: {
  count: number
  children: ReactNode
  max?: number
  height?: number
  label?: string
  testId?: string
}) {
  const { t } = useTheme()
  if (count <= max) return <>{children}</>
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, color: t.text3, marginBottom: 6 }}>
        {count} {label} · scroll for more
      </div>
      <div data-testid={testId} data-scroll-list="" style={{
        maxHeight: height, overflowY: 'auto', overscrollBehavior: 'contain',
        border: `0.5px solid ${t.border}`, borderRadius: 6, padding: '0 10px',
      }}>
        {children}
      </div>
    </div>
  )
}
