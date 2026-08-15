import { useState, useSyncExternalStore } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import {
  subscribeToListenerFailures,
  getListenerFailures,
  clearListenerFailures,
} from '../data/live'

/**
 * Surfaces the listener failures collected in data/live.ts.
 *
 * Only a super admin sees this. Everyone else gets the console entry, which
 * is enough for a developer looking at a report but does not put a Firestore
 * error code in front of a salesperson who can do nothing about it. The point
 * is that somebody who *can* fix the rules finds out on the spot, instead of
 * a screen quietly rendering its empty state.
 */
export default function ListenerErrors() {
  const { appUser } = useAuth()
  const { t } = useTheme()
  const [open, setOpen] = useState(false)

  const failures = useSyncExternalStore(
    subscribeToListenerFailures,
    getListenerFailures,
    getListenerFailures,
  )

  if (appUser?.role !== 'super_admin') return null
  if (failures.length === 0) return null

  const denied = failures.filter(f => f.code === 'permission-denied').length
  const headline = denied === failures.length
    ? `${failures.length} listener${failures.length > 1 ? 's were' : ' was'} refused by the security rules`
    : `${failures.length} listener${failures.length > 1 ? 's' : ''} failed`

  return (
    <div
      role="status"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 3000,
        background: t.bg2, borderTop: `0.5px solid ${t.border2}`,
        padding: '12px 20px',
      }}
    >
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: t.warn }}>{headline}</div>
            <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3 }}>
              Those screens will look empty rather than broken. Only you can see this.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14, flexShrink: 0 }}>
            <button className="oc-action" onClick={() => setOpen(o => !o)}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: 13,
                       fontWeight: 400, color: t.text2, cursor: 'pointer' }}>
              {open ? 'Hide' : 'Details'}
            </button>
            <button className="oc-action" onClick={clearListenerFailures}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: 13,
                       fontWeight: 400, color: t.text3, cursor: 'pointer' }}>
              Dismiss
            </button>
          </div>
        </div>

        {open && (
          <div style={{ marginTop: 12, maxHeight: '40vh', overflowY: 'auto' }}>
            {failures.map(f => (
              <div key={`${f.source}|${f.code}`}
                style={{ borderTop: `0.5px solid ${t.border}`, padding: '11px 0' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 400,
                                 color: t.text, fontFamily: 'monospace' }}>
                    {f.source}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 400, color: t.warn, whiteSpace: 'nowrap' }}>
                    {f.code}{f.count > 1 ? ` · ${f.count} times` : ''}
                  </span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, marginTop: 3, lineHeight: 1.5 }}>
                  {f.message}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
