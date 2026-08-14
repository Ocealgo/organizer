import { useState, useEffect, useRef } from 'react'
import { collection, onSnapshot, updateDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { Alert } from '../types'
import { useAuth } from '../context/AuthContext'
import { isManagement } from '../auth/permissions'

export default function NotificationBell() {
  const { appUser } = useAuth()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const isAdmin = isManagement(appUser)

  useEffect(() => {
    // No orderBy — sort client-side to avoid index requirement
    return onSnapshot(collection(db, 'alerts'), snap => {
      const all = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Alert))
        .filter(a => {
          if (a.toUid) return a.toUid === appUser?.uid
          if (a.toRole === 'admin_group') return isAdmin
          return true
        })
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 20)
      setAlerts(all)
    })
  }, [appUser?.uid, isAdmin])

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

  const markAllRead = () => {
    alerts.filter(a => !a.read).forEach(a => {
      updateDoc(doc(db, 'alerts', a.id!), { read: true })
    })
  }

  const TYPE_EMOJI: Record<string, string> = {
    new_party: '🤝', low_stock: '⚠️',
    credit_settlement: '💜', stock_dispatched: '📦',
  }

  const timeAgo = (ts: number) => {
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    const hrs  = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 1)  return 'just now'
    if (mins < 60) return `${mins}m ago`
    if (hrs < 24)  return `${hrs}h ago`
    return `${days}d ago`
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)}
        style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '6px 10px', cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center' }}>
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
            <span style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>Notifications {unread > 0 && <span style={{ color: '#6ee7b7' }}>({unread})</span>}</span>
            {unread > 0 && (
              <button onClick={markAllRead} style={{ background: 'none', border: 'none', color: '#6ee7b7', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>
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
              <div key={a.id} onClick={() => !a.read && markRead(a.id!)}
                style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: a.read ? 'default' : 'pointer', background: a.read ? 'transparent' : 'rgba(110,231,183,0.05)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{TYPE_EMOJI[a.type] || '🔔'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: a.read ? '#64748b' : '#e2e8f0', lineHeight: 1.5 }}>{a.message}</div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>{timeAgo(a.createdAt)}</div>
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
