import { useState, useEffect, useRef } from 'react'
import { collection, onSnapshot, updateDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { Alert } from '../types'
import { useAuth } from '../context/AuthContext'
import { isManagement } from '../auth/permissions'
import { useTheme } from '../context/ThemeContext'

export default function NotificationBell() {
  const { appUser } = useAuth()
  const { t } = useTheme()
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

  const timeAgo = (ts: number) => {
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    const hrs  = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 1)  return 'Just now'
    if (mins < 60) return `${mins}m ago`
    if (hrs < 24)  return `${hrs}h ago`
    return `${days}d ago`
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="oc-action"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{
          background: 'none', border: 'none', padding: 0,
          fontSize: 13, fontWeight: 400, color: t.text2,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        Notifications
        {unread > 0 && (
          <span style={{ color: t.warn, marginLeft: 5 }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 12px)', right: 0, width: 320,
          background: t.bg2, border: `0.5px solid ${t.border}`, borderRadius: 8,
          overflow: 'hidden', zIndex: 1000,
        }}>
          <div style={{
            padding: '12px 16px', borderBottom: `0.5px solid ${t.border}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontWeight: 500, fontSize: 13, color: t.text }}>
              Notifications
              {unread > 0 && <span style={{ color: t.text3, fontWeight: 400 }}> · {unread} unread</span>}
            </span>
            {unread > 0 && (
              <button className="oc-action" onClick={markAllRead}
                style={{ background: 'none', border: 'none', padding: 0, color: t.accent, fontSize: 12, cursor: 'pointer' }}>
                Mark all as read
              </button>
            )}
          </div>

          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {alerts.length === 0 ? (
              <div style={{ padding: '28px 20px' }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: t.text, marginBottom: 4 }}>
                  Nothing new
                </div>
                <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.5 }}>
                  Alerts about stock, credit and approvals will land here.
                </div>
              </div>
            ) : alerts.map(a => (
              <button
                key={a.id}
                className="oc-row"
                onClick={() => !a.read && markRead(a.id!)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '12px 16px', border: 'none',
                  borderTop: `0.5px solid ${t.border}`,
                  background: a.read ? 'transparent' : t.tint,
                  cursor: a.read ? 'default' : 'pointer',
                }}
              >
                <div style={{ fontSize: 13, color: a.read ? t.text3 : t.text, lineHeight: 1.5 }}>
                  {a.message}
                </div>
                <div style={{ fontSize: 11, color: t.text3, marginTop: 3 }}>{timeAgo(a.createdAt)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
