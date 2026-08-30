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
  /**
   * Turns this into a multi-select.
   *
   * Passing `values` switches the mode: options gain checkboxes, choosing one
   * toggles it instead of replacing the selection, and the menu stays open so
   * several can be picked in a row. `value`/`onChange` are ignored in that
   * mode and every existing caller is untouched, which is the point — this is
   * one component with two behaviours rather than two components that drift.
   */
  values?: string[]
  onToggle?: (val: string) => void
}

export default function CustomSelect({
  value, onChange, options, placeholder = "Choose...", error, searchable = true,
  values, onToggle,
}: Props) {
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

  const multi = Array.isArray(values)
  const chosen = new Set(values ?? [])
  const selected = options.find(o => o.value === value)
  /** What the closed control reads. Names, not a count — a count hides which. */
  const triggerLabel = multi
    ? (chosen.size === 0
        ? placeholder
        : options.filter(o => chosen.has(o.value)).map(o => o.label).join(', '))
    : (selected ? selected.label : placeholder)
  const hasValue = multi ? chosen.size > 0 : !!selected

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
    opts.map(o => {
      const on = multi ? chosen.has(o.value) : value === o.value
      return (
        <div key={o.value} className="oc-row"
          role={multi ? 'checkbox' : undefined}
          aria-checked={multi ? on : undefined}
          onClick={() => {
            if (multi) {
              // Stays open. Picking three areas should be three taps, not three
              // round trips through the menu.
              onToggle?.(o.value)
            } else {
              onChange(o.value); setOpen(false); setSearch('')
            }
          }}
          style={{
            padding: '12px 14px', minHeight: 44, display: 'flex',
            alignItems: 'center', gap: 11, cursor: 'pointer',
            background: on ? t.tint : 'transparent',
            color: t.text,
          }}>
          {multi && (
            <span style={{
              width: 18, height: 18, borderRadius: 4, flexShrink: 0,
              border: `0.5px solid ${on ? t.text2 : t.border2}`,
              background: on ? t.text2 : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, color: t.bg,
            }}>{on ? '✓' : ''}</span>
          )}
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: on ? 500 : 400 }}>{o.label}</span>
            {o.sub && (
              <span style={{ display: 'block', fontSize: 12, fontWeight: 400, color: t.text3, marginTop: 2 }}>
                {o.sub}
              </span>
            )}
          </span>
        </div>
      )
    })
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div onClick={() => { setOpen(!open); setSearch('') }}
        style={{
          width: '100%', background: 'transparent',
          border: `0.5px solid ${error ? t.warn : open ? t.text2 : t.border2}`,
          borderRadius: 6, padding: '12px 13px', fontSize: 16, minHeight: 44, fontWeight: 400,
          color: hasValue ? t.text : t.text3, cursor: "pointer",
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          boxSizing: 'border-box',
        }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {triggerLabel}
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
                  borderRadius: 6, padding: '11px',
                  // A real text input, so the 16px iOS rule applies here too —
                  // and a dropdown that zooms the page as you start typing is
                  // the worst place for it to happen.
                  fontSize: 16, minHeight: 44,
                  fontWeight: 400, color: t.text, outline: 'none', boxSizing: 'border-box',
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
