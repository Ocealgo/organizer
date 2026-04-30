import React, { useState, useRef, useEffect } from 'react'

export interface SelectOption {
  value: string
  label: string
  sub?: string
  group?: string
}

interface Props {
  value: string
  onChange: (val: string) => void
  options: SelectOption[]
  placeholder?: string
  error?: boolean
}

export default function CustomSelect({ value, onChange, options, placeholder = 'Choose...', error }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selected = options.find(o => o.value === value)

  // Group options
  const groups: Record<string, SelectOption[]> = {}
  const ungrouped: SelectOption[] = []
  options.forEach(o => {
    if (o.group) {
      if (!groups[o.group]) groups[o.group] = []
      groups[o.group].push(o)
    } else {
      ungrouped.push(o)
    }
  })

  const renderOptions = (opts: SelectOption[]) =>
    opts.map(o => (
      <div key={o.value}
        onClick={() => { onChange(o.value); setOpen(false) }}
        style={{
          padding: '12px 16px', cursor: 'pointer',
          background: value === o.value ? 'rgba(8,145,178,0.2)' : 'transparent',
          color: value === o.value ? '#0891b2' : '#e2e8f0',
          borderLeft: value === o.value ? '3px solid #0891b2' : '3px solid transparent',
          transition: 'all 0.1s',
        }}
        onMouseEnter={e => { if (value !== o.value) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)' }}
        onMouseLeave={e => { if (value !== o.value) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
        <div style={{ fontSize: 14, fontWeight: value === o.value ? 700 : 500 }}>{o.label}</div>
        {o.sub && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{o.sub}</div>}
      </div>
    ))

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger */}
      <div onClick={() => setOpen(!open)}
        style={{
          width: '100%', background: 'rgba(255,255,255,0.06)',
          border: `1.5px solid ${error ? '#dc2626' : open ? '#0891b2' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: 12, padding: '13px 16px', fontSize: 14,
          color: selected ? '#fff' : '#64748b', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          boxSizing: 'border-box', transition: 'border-color 0.2s',
        }}>
        <span>{selected ? selected.label : placeholder}</span>
        <span style={{ color: '#64748b', fontSize: 12, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}>▼</span>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 1000,
          background: '#1e2530', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 12, overflow: 'hidden',
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          maxHeight: 280, overflowY: 'auto',
        }}>
          {ungrouped.length > 0 && renderOptions(ungrouped)}
          {Object.entries(groups).map(([group, opts]) => (
            <div key={group}>
              <div style={{ padding: '8px 16px 4px', fontSize: 10, color: '#475569', letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, borderTop: ungrouped.length > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                {group}
              </div>
              {renderOptions(opts)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
