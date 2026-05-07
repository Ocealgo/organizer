import { useRef } from 'react'
import { useTheme } from '../context/ThemeContext'

interface Props {
  type: 'date' | 'month'
  value: string
  onChange: (val: string) => void
  style?: React.CSSProperties
  placeholder?: string
}

// Makes entire field clickable — not just the icon
export default function DateInput({ type, value, onChange, style, placeholder }: Props) {
  const { t, theme } = useRef<HTMLInputElement>(null) as any
  const ref = useRef<HTMLInputElement>(null)
  const { t: theme_t, theme: themeMode } = useTheme()

  const handleClick = () => {
    try { ref.current?.showPicker() } catch { ref.current?.focus() }
  }

  const base: React.CSSProperties = {
    width: '100%',
    background: theme_t.bg3,
    border: `1px solid ${theme_t.border2}`,
    borderRadius: 10,
    padding: '10px 14px',
    fontSize: 14,
    color: value ? theme_t.text : theme_t.text3,
    outline: 'none',
    boxSizing: 'border-box',
    cursor: 'pointer',
    colorScheme: themeMode === 'dark' ? 'dark' : 'light',
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
        style={base}
      />
    </div>
  )
}
