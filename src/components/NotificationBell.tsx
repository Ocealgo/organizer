import { useState, useEffect, useRef } from 'react'
import { collection, onSnapshot, updateDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { Alert } from '../types'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

export default function NotificationBell() {
  const { appUser } = useAuth()
  const { t } = useTheme()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const isAdmin = appUser?.role === 'admin' || appUser?.role === 'super_admin'

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
        style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '7px 10px', cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 700, color: '#ffffff' }}>
        Alerts
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -4, right: -4, background: '#ef4444', color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: 9, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #000' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 300, background: t.card, border: `1px solid ${t.border2}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.5)', zIndex: 1000 }}>
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 800, fontSize: 14, color: t.text }}>Notifications {unread > 0 && <span style={{ color: '#22c55e' }}>({unread})</span>}</span>
            {unread > 0 && (
              <button onClick={markAllRead} style={{ background: 'none', border: 'none', color: '#22c55e', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>
                Mark all read
              </button>
            )}
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {alerts.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: t.text3 }}>
                <div style={{ fontSize: 13 }}>No notifications yet</div>
              </div>
            ) : alerts.map(a => (
              <div key={a.id} onClick={() => !a.read && markRead(a.id!)}
                style={{ padding: '12px 16px', borderBottom: `1px solid ${t.border}`, cursor: a.read ? 'default' : 'pointer', background: a.read ? 'transparent' : 'rgba(34,197,94,0.04)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: a.read ? t.text3 : t.text, lineHeight: 1.5 }}>{a.message}</div>
                  <div style={{ fontSize: 10, color: t.text3, marginTop: 3 }}>{timeAgo(a.createdAt)}</div>
                </div>
                {!a.read && <div style={{ width: 7, height: 7, background: '#22c55e', borderRadius: '50%', flexShrink: 0, marginTop: 4 }} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
