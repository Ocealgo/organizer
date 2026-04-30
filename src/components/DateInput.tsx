import { useRef } from 'react'

interface Props {
  type: 'date' | 'month'
  value: string
  onChange: (val: string) => void
  style?: React.CSSProperties
  placeholder?: string
}

// Makes entire field clickable — not just the icon
export default function DateInput({ type, value, onChange, style, placeholder }: Props) {
  const ref = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    try { ref.current?.showPicker() } catch { ref.current?.focus() }
  }

  const base: React.CSSProperties = {
    width: '100%',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10,
    padding: '10px 14px',
    fontSize: 14,
    color: value ? '#fff' : '#64748b',
    outline: 'none',
    boxSizing: 'border-box',
    cursor: 'pointer',
    colorScheme: 'dark',
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
