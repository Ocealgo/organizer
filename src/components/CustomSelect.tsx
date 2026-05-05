import React, { useState, useRef, useEffect } from 'react'
import { useTheme } from '../context/ThemeContext'

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
  searchable?: boolean
}

export default function CustomSelect({ value, onChange, options, placeholder = 'Choose...', error, searchable = true }: Props) {
  const { t, theme } = useTheme()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler as EventListener, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler as EventListener)
    }
  }, [])

  useEffect(() => {
    if (open && searchable) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open, searchable])

  const selected = options.find(o => o.value === value)

  const filtered = search.trim()
    ? options.filter(o =>
        o.label.toLowerCase().includes(search.toLowerCase()) ||
        (o.sub || '').toLowerCase().includes(search.toLowerCase())
      )
    : options

  const groups: Record<string, SelectOption[]> = {}
  const ungrouped: SelectOption[] = []
  filtered.forEach(o => {
    if (o.group) {
      if (!groups[o.group]) groups[o.group] = []
      groups[o.group].push(o)
    } else { ungrouped.push(o) }
  })

  const renderOptions = (opts: SelectOption[]) =>
    opts.map(o => (
      <div key={o.value}
        onClick={() => { onChange(o.value); setOpen(false); setSearch('') }}
        style={{
          padding: '12px 16px', cursor: 'pointer',
          background: value === o.value ? 'rgba(8,145,178,0.15)' : 'transparent',
          color: value === o.value ? '#0891b2' : t.text,
          borderLeft: value === o.value ? '3px solid #0891b2' : '3px solid transparent',
        }}
        onMouseEnter={e => { if (value !== o.value) (e.currentTarget as HTMLElement).style.background = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}
        onMouseLeave={e => { if (value !== o.value) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
        <div style={{ fontSize: 14, fontWeight: value === o.value ? 700 : 500 }}>{o.label}</div>
        {o.sub && <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{o.sub}</div>}
      </div>
    ))

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div onClick={() => { setOpen(!open); setSearch('') }}
        style={{
          width: '100%', background: t.bg3,
          border: `1.5px solid ${error ? '#dc2626' : open ? '#0891b2' : t.border2}`,
          borderRadius: 12, padding: '13px 16px', fontSize: 15,
          color: selected ? t.text : t.text3, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          boxSizing: 'border-box',
        }}>
        <span>{selected ? selected.label : placeholder}</span>
        <span style={{ color: t.text3, fontSize: 12, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}>▼</span>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 1000,
          background: t.bg3, border: `1px solid ${t.border2}`,
          borderRadius: 12, overflow: 'hidden',
          boxShadow: theme === 'dark' ? '0 12px 40px rgba(0,0,0,0.5)' : '0 8px 32px rgba(0,0,0,0.12)',
        }}>
          {searchable && (
            <div style={{ padding: '10px 12px', borderBottom: `1px solid ${t.border}` }}>
              <input
                ref={inputRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search..."
                onClick={e => e.stopPropagation()}
                style={{
                  width: '100%', background: t.bg2,
                  border: `1px solid ${t.border}`,
                  borderRadius: 8, padding: '8px 12px',
                  fontSize: 16, color: t.text, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          <div style={{ maxHeight: 'min(260px, 50vh)', overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', color: t.text3, fontSize: 13 }}>
                No results for "{search}"
              </div>
            ) : (
              <>
                {ungrouped.length > 0 && renderOptions(ungrouped)}
                {Object.entries(groups).map(([group, opts]) => (
                  <div key={group}>
                    <div style={{ padding: '8px 16px 4px', fontSize: 11, color: t.text3, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, borderTop: ungrouped.length > 0 ? `1px solid ${t.border}` : 'none' }}>
                      {group}
                    </div>
                    {renderOptions(opts)}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
