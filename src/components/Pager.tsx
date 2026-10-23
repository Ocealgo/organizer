import { ReactNode, useEffect, useState } from 'react'
import { useTheme } from '../context/ThemeContext'

/**
 * A long list a page at a time — ten rows, then "Next".
 *
 * For the report screens, where a list is read on a phone as often as on a
 * desk. A scroll box inside a scrolling page is two scrolls fighting under one
 * thumb; a page of ten with a count says how much there is and where you are.
 *
 * Back to the first page whenever the list itself changes length — a filter
 * changed — so nobody is left on page four of a list that now has one page.
 */
export function usePaged<T>(items: T[], size = 10): {
  shown: T[]
  pager: ReactNode
  /** Where the page starts in the whole list, for anything numbered. */
  offset: number
} {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(items.length / size))
  useEffect(() => { setPage(0) }, [items.length])
  const at = Math.min(page, pages - 1)
  const offset = at * size
  return {
    shown: items.slice(offset, offset + size),
    offset,
    pager: items.length > size
      ? <Pager from={offset + 1} to={Math.min(items.length, offset + size)} of={items.length}
          onPrev={at > 0 ? () => setPage(at - 1) : undefined}
          onNext={at < pages - 1 ? () => setPage(at + 1) : undefined} />
      : null,
  }
}

function Pager({ from, to, of, onPrev, onNext }: {
  from: number; to: number; of: number; onPrev?: () => void; onNext?: () => void
}) {
  const { t } = useTheme()
  const btn = (enabled: boolean) => ({
    background: 'none', border: `0.5px solid ${enabled ? t.border2 : t.border}`, borderRadius: 6,
    padding: '8px 14px', fontSize: 13, color: enabled ? t.text : t.text3,
    cursor: enabled ? 'pointer' : 'default', minWidth: 44,
  })
  return (
    <nav aria-label="Pages" data-testid="pager"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
               flexWrap: 'wrap', marginTop: 12 }}>
      <button className="oc-action" onClick={onPrev} disabled={!onPrev} aria-label="Previous page" style={btn(!!onPrev)}>
        ‹ Previous
      </button>
      <span style={{ fontSize: 13, color: t.text2 }}>{from}–{to} of {of}</span>
      <button className="oc-action" onClick={onNext} disabled={!onNext} aria-label="Next page" style={btn(!!onNext)}>
        Next ›
      </button>
    </nav>
  )
}
