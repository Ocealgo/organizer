import { useState, useEffect, useRef } from 'react'
import { collection, onSnapshot, updateDoc, doc, query, orderBy, limit } from 'firebase/firestore'
import { db } from '../firebase'
import { Alert } from '../types'

export default function NotificationBell() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = query(collection(db, 'alerts'), orderBy('createdAt', 'desc'), limit(20))
    return onSnapshot(q, snap => {
      setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Alert)))
    })
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const unread = alerts.filter(a => !a.read).length

  const markRead = async (id: string) => {
    await updateDoc(doc(db, 'alerts', id), { read: true })
  }

  const markAllRead = async () => {
    alerts.filter(a => !a.read).forEach(a => updateDoc(doc(db, 'alerts', a.id!), { read: true }))
  }

  const TYPE_EMOJI: Record<string, string> = {
    new_party: '🤝',
    low_stock: '⚠️',
    credit_settlement: '💜',
    stock_dispatched: '📦',
  }

  const timeAgo = (ts: number) => {
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    const hrs = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    if (hrs < 24) return `${hrs}h ago`
    return `${days}d ago`
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)}
        style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '6px 10px', cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 16 }}>🔔</span>
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -4, right: -4, background: '#dc2626', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #0d1117' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 300, background: '#1e2530', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.5)', zIndex: 1000 }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead}
                style={{ background: 'none', border: 'none', color: '#6ee7b7', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>
                Mark all read
              </button>
            )}
          </div>

          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {alerts.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#475569' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔔</div>
                <div style={{ fontSize: 13 }}>No notifications yet</div>
              </div>
            ) : alerts.map(a => (
              <div key={a.id}
                onClick={() => markRead(a.id!)}
                style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', background: a.read ? 'transparent' : 'rgba(110,231,183,0.05)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{TYPE_EMOJI[a.type] || '🔔'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: a.read ? '#64748b' : '#e2e8f0', lineHeight: 1.5 }}>{a.message}</div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>{timeAgo(a.createdAt)}</div>
                </div>
                {!a.read && <div style={{ width: 7, height: 7, background: '#6ee7b7', borderRadius: '50%', flexShrink: 0, marginTop: 4 }} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
