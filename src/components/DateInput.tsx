import { useRef } from 'react'
import { useTheme } from '../context/ThemeContext'

interface Props {
  type: 'date' | 'month'
  value: string
  onChange: (val: string) => void
  style?: React.CSSProperties
  placeholder?: string
  /** Earliest selectable value, in the same format as `value`. */
  min?: string
  /** Latest selectable value. */
  max?: string
}

// Makes entire field clickable — not just the icon
export default function DateInput({ type, value, onChange, style, placeholder, min, max }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const { theme, t } = useTheme()

  const handleClick = () => {
    try { ref.current?.showPicker() } catch { ref.current?.focus() }
  }

  const base: React.CSSProperties = {
    width: '100%',
    background: 'transparent',
    border: `0.5px solid ${t.border2}`,
    borderRadius: 6,
    padding: '11px 13px',
    fontSize: 14,
    fontWeight: 400,
    color: value ? t.text : t.text3,
    outline: 'none',
    boxSizing: 'border-box',
    cursor: 'pointer',
    // Drives the native picker chrome and the calendar glyph. Hardcoding this
    // to dark left an invisible icon on the light theme.
    colorScheme: theme === 'dark' ? 'dark' : 'light',
    ...style,
  }

  return (
    <div style={{ position: 'relative', width: '100%' }} onClick={handleClick}>
      <input
        ref={ref}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        max={max}
        style={base}
      />
    </div>
  )
}
