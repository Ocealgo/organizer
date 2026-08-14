import { ReactNode, CSSProperties } from 'react'
import { useTheme } from '../context/ThemeContext'

/**
 * Shared minimal UI primitives.
 *
 * House rules these encode so every screen does not have to remember them:
 *   · two font weights only — 400 and 500
 *   · hairlines at 0.5px, small radii, no shadows, no gradients
 *   · sentence case everywhere except the small uppercase eyebrow
 *   · colour only carries meaning: accent for links, warn for needs-action
 *   · whitespace separates, not boxes
 */

// ── Eyebrow ──────────────────────────────────────────────────────────────────
export function Eyebrow({ children }: { children: ReactNode }) {
  const { t } = useTheme()
  return (
    <div style={{
      fontSize: 11, letterSpacing: '0.09em', textTransform: 'uppercase',
      color: t.text3, fontWeight: 400,
    }}>
      {children}
    </div>
  )
}

// ── Page header ──────────────────────────────────────────────────────────────
export function PageHeader({ eyebrow, title, subtitle, onBack, right }: {
  eyebrow?: string
  title: string
  subtitle?: ReactNode
  onBack?: () => void
  right?: ReactNode
}) {
  const { t } = useTheme()
  return (
    <div style={{ padding: '22px 20px 20px', borderBottom: `0.5px solid ${t.border}` }}>
      {onBack && (
        <button className="oc-action" onClick={onBack}
          style={{ background: 'none', border: 'none', padding: 0, marginBottom: 16,
                   fontSize: 13, fontWeight: 400, color: t.text2, cursor: 'pointer' }}>
          ← Back
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          {eyebrow && <div style={{ marginBottom: 6 }}><Eyebrow>{eyebrow}</Eyebrow></div>}
          <h1 style={{ fontSize: 21, fontWeight: 500, color: t.text, margin: 0, lineHeight: 1.3 }}>
            {title}
          </h1>
          {subtitle && (
            <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 5, lineHeight: 1.5 }}>
              {subtitle}
            </div>
          )}
        </div>
        {right && <div style={{ flexShrink: 0 }}>{right}</div>}
      </div>
    </div>
  )
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
export function TabBar<T extends string>({ tabs, value, onChange }: {
  tabs: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  const { t } = useTheme()
  return (
    <div style={{ padding: '0 20px', borderBottom: `0.5px solid ${t.border}` }}>
      <div style={{ display: 'flex', gap: 24, overflowX: 'auto' }}>
        {tabs.map(tab => (
          <button key={tab.id} className="oc-action" onClick={() => onChange(tab.id)}
            style={{
              background: 'none', border: 'none', padding: '0 0 12px',
              fontSize: 14, fontWeight: value === tab.id ? 500 : 400,
              color: value === tab.id ? t.text : t.text2,
              borderBottom: `2px solid ${value === tab.id ? t.text : 'transparent'}`,
              marginBottom: '-0.5px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Stats ────────────────────────────────────────────────────────────────────
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="oc-stats">{children}</div>
}

export function StatCard({ value, label, context }: {
  value: ReactNode; label: string; context?: string
}) {
  const { t } = useTheme()
  return (
    <div style={{ background: t.tint, borderRadius: 6, padding: '16px 16px 14px' }}>
      <div style={{ fontSize: 26, fontWeight: 500, color: t.text, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 400, color: t.text, marginTop: 6 }}>{label}</div>
      {context && <div style={{ fontSize: 12, color: t.text3, marginTop: 2 }}>{context}</div>}
    </div>
  )
}

// ── Rows ─────────────────────────────────────────────────────────────────────
export function RowGroup({ children, columns = 1 }: { children: ReactNode; columns?: 1 | 2 }) {
  const { t } = useTheme()
  return (
    <div className={columns === 2 ? 'oc-modules' : undefined}
      style={{ borderBottom: `0.5px solid ${t.border}` }}>
      {children}
    </div>
  )
}

export function ListRow({ title, desc, value, warn, onClick, disabled }: {
  title: string
  desc?: string
  value?: ReactNode
  warn?: boolean
  onClick?: () => void
  disabled?: boolean
}) {
  const { t } = useTheme()
  return (
    <button className={disabled ? undefined : 'oc-row'} onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'baseline', gap: 16, width: '100%', textAlign: 'left',
        background: 'none', border: 'none', borderTop: `0.5px solid ${t.border}`,
        padding: '16px 14px', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 500, color: t.text }}>{title}</span>
        {desc && (
          <span style={{ display: 'block', fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
            {desc}
          </span>
        )}
      </span>
      {value !== undefined && (
        <span style={{ fontSize: 14, fontWeight: 400, color: warn ? t.warn : t.text2, whiteSpace: 'nowrap' }}>
          {value}
        </span>
      )}
    </button>
  )
}

// ── Section ──────────────────────────────────────────────────────────────────
export function Section({ label, children, right }: {
  label?: string; children: ReactNode; right?: ReactNode
}) {
  return (
    <div>
      {(label || right) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 12, marginBottom: 12 }}>
          {label ? <Eyebrow>{label}</Eyebrow> : <span />}
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────────
export function EmptyState({ title, body, actionLabel, onAction }: {
  title: string; body: string; actionLabel?: string; onAction?: () => void
}) {
  const { t } = useTheme()
  return (
    <div style={{ padding: '40px 0', maxWidth: 420 }}>
      <div style={{ fontSize: 17, fontWeight: 500, color: t.text, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 14, fontWeight: 400, color: t.text3, lineHeight: 1.6 }}>{body}</div>
      {actionLabel && onAction && (
        <div style={{ marginTop: 18 }}>
          <GhostButton onClick={onAction}>{actionLabel}</GhostButton>
        </div>
      )}
    </div>
  )
}

// ── Buttons ──────────────────────────────────────────────────────────────────
export function GhostButton({ onClick, children, disabled, style }: {
  onClick?: () => void; children: ReactNode; disabled?: boolean; style?: CSSProperties
}) {
  const { t } = useTheme()
  return (
    <button className="oc-action" onClick={onClick} disabled={disabled}
      style={{
        background: 'none', border: `0.5px solid ${t.border2}`, borderRadius: 6,
        padding: '9px 14px', fontSize: 13, fontWeight: 400, color: t.text,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, ...style,
      }}>
      {children}
    </button>
  )
}

export function PrimaryButton({ onClick, children, disabled, style }: {
  onClick?: () => void; children: ReactNode; disabled?: boolean; style?: CSSProperties
}) {
  const { t } = useTheme()
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        background: t.text, border: 'none', borderRadius: 6,
        padding: '11px 16px', fontSize: 13, fontWeight: 500, color: t.bg,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, ...style,
      }}>
      {children}
    </button>
  )
}

// ── Text input ───────────────────────────────────────────────────────────────
export function inputStyle(t: ReturnType<typeof useTheme>['t']): CSSProperties {
  return {
    width: '100%', boxSizing: 'border-box',
    background: 'transparent', border: `0.5px solid ${t.border2}`,
    borderRadius: 6, padding: '11px 13px',
    fontSize: 14, fontWeight: 400, color: t.text, outline: 'none',
  }
}
