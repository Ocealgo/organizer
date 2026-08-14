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
  const { t } = useTheme()
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
      <div key={o.value} className="oc-row"
        onClick={() => { onChange(o.value); setOpen(false); setSearch('') }}
        style={{
          padding: '12px 14px', cursor: 'pointer',
          background: value === o.value ? t.tint : 'transparent',
          color: t.text,
        }}>
        <div style={{ fontSize: 14, fontWeight: value === o.value ? 500 : 400 }}>{o.label}</div>
        {o.sub && <div style={{ fontSize: 12, fontWeight: 400, color: t.text3, marginTop: 2 }}>{o.sub}</div>}
      </div>
    ))

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div onClick={() => { setOpen(!open); setSearch('') }}
        style={{
          width: '100%', background: 'transparent',
          border: `0.5px solid ${error ? t.warn : open ? t.text2 : t.border2}`,
          borderRadius: 6, padding: '11px 13px', fontSize: 14, fontWeight: 400,
          color: selected ? t.text : t.text3, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          boxSizing: 'border-box',
        }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
        </span>
        <span aria-hidden style={{
          color: t.text3, fontSize: 9, flexShrink: 0,
          transition: 'transform .12s ease', transform: open ? 'rotate(180deg)' : 'none',
        }}>▼</span>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 1000,
          background: t.bg2, border: `0.5px solid ${t.border2}`,
          borderRadius: 6, overflow: 'hidden',
        }}>
          {searchable && (
            <div style={{ padding: 10, borderBottom: `0.5px solid ${t.border}` }}>
              <input
                ref={inputRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search"
                onClick={e => e.stopPropagation()}
                style={{
                  width: '100%', background: 'transparent',
                  border: `0.5px solid ${t.border}`,
                  borderRadius: 6, padding: '9px 11px',
                  fontSize: 14, fontWeight: 400, color: t.text, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          <div style={{ maxHeight: 'min(260px, 50vh)', overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 16, color: t.text3, fontSize: 13, fontWeight: 400 }}>
                Nothing matches “{search}”.
              </div>
            ) : (
              <>
                {ungrouped.length > 0 && renderOptions(ungrouped)}
                {Object.entries(groups).map(([group, opts]) => (
                  <div key={group}>
                    <div style={{
                      padding: '10px 14px 5px', fontSize: 11, color: t.text3,
                      letterSpacing: '0.09em', textTransform: 'uppercase', fontWeight: 400,
                      borderTop: ungrouped.length > 0 ? `0.5px solid ${t.border}` : 'none',
                    }}>
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
