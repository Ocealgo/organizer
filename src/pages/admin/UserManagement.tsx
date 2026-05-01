import { useState, useEffect } from 'react'
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { AppUser, UserRole } from '../../types'
import { useAuth } from '../../context/AuthContext'

const SUPER_ADMIN_EMAIL = 'amalau14113@gmail.com'
const ROLES: UserRole[] = ['admin', 'offline_sales', 'online_sales', 'offline_marketing', 'online_marketing']
const ROLE_LABELS: Record<string, string> = {
  super_admin:        '👑 Super Admin',
  admin:              '🛡️ Admin',
  offline_sales:      '🏪 Offline Sales',
  online_sales:       '🌐 Online Sales',
  offline_marketing:  '📣 Offline Marketing',
  online_marketing:   '💻 Online Marketing',
}

interface Props { onBack: () => void }

export default function UserManagement({ onBack }: Props) {
  const { appUser } = useAuth()
  const [users, setUsers] = useState<AppUser[]>([])
  const [tab, setTab] = useState<'pending' | 'active' | 'deactivated'>('pending')
  const [updating, setUpdating] = useState<string | null>(null)

  useEffect(() => {
    return onSnapshot(collection(db, 'users'), snap => {
      setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser)))
    })
  }, [])

  const pending     = users.filter(u => u.status === 'pending')
  const active      = users.filter(u => u.status === 'approved' || u.status === 'rejected')
  const deactivated = users.filter(u => (u as any).status === 'deactivated')

  const approveUser = async (uid: string, role: UserRole) => {
    setUpdating(uid)
    await updateDoc(doc(db, 'users', uid), {
      status: 'approved', role,
      approvedAt: Date.now(),
      approvedBy: appUser?.name || 'Admin',
    })
    setUpdating(null)
  }

  const rejectUser = async (uid: string) => {
    setUpdating(uid)
    await updateDoc(doc(db, 'users', uid), { status: 'rejected' })
    setUpdating(null)
  }

  // ✅ Deactivate instead of delete — keeps Firebase Auth account intact
  const deactivateUser = async (uid: string, name: string) => {
    if (!confirm(`Deactivate ${name}? They won't be able to log in. You can reactivate them anytime.`)) return
    setUpdating(uid)
    await updateDoc(doc(db, 'users', uid), { status: 'deactivated' })
    setUpdating(null)
  }

  const reactivateUser = async (uid: string, role: UserRole) => {
    setUpdating(uid)
    await updateDoc(doc(db, 'users', uid), { status: 'approved', role })
    setUpdating(null)
  }

  const changeRole = async (uid: string, role: UserRole) => {
    setUpdating(uid)
    await updateDoc(doc(db, 'users', uid), { role })
    setUpdating(null)
  }

  const TAB_COUNTS = {
    pending: pending.length,
    active: active.length,
    deactivated: deactivated.length,
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#78350f,#d97706)', padding: '24px 20px 16px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fde68a', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 16 }}>← Back</button>
        <div style={{ color: '#fde68a', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Admin Panel 👑</div>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 16 }}>User Management</div>

        {/* Why no delete info */}
        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '8px 12px', marginBottom: 14, fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
          ℹ️ Users are deactivated instead of deleted. This allows the same email to be re-added by reactivating their account.
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {(['pending', 'active', 'deactivated'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ flex: 1, background: tab === t ? 'rgba(255,255,255,0.2)' : 'transparent', color: tab === t ? '#fff' : 'rgba(255,255,255,0.5)', border: tab === t ? '1px solid rgba(255,255,255,0.3)' : '1px solid transparent', borderRadius: 20, padding: '7px 6px', fontSize: 11, fontWeight: 700 }}>
              {t === 'pending' ? `⏳ Pending (${TAB_COUNTS.pending})` : t === 'active' ? `👥 Active (${TAB_COUNTS.active})` : `🚫 Deactivated (${TAB_COUNTS.deactivated})`}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* PENDING */}
        {tab === 'pending' && (
          pending.length === 0 ? (
            <EmptyState emoji="✅" title="No pending requests" />
          ) : pending.map(u => (
            <PendingCard key={u.uid} user={u} updating={updating}
              onApprove={approveUser} onReject={rejectUser} />
          ))
        )}

        {/* ACTIVE */}
        {tab === 'active' && (
          active.length === 0 ? (
            <EmptyState emoji="👥" title="No active users yet" />
          ) : active.map(u => (
            <UserCard key={u.uid} user={u} updating={updating}
              currentUser={appUser!}
              onDeactivate={deactivateUser}
              onRoleChange={changeRole} />
          ))
        )}

        {/* DEACTIVATED */}
        {tab === 'deactivated' && (
          deactivated.length === 0 ? (
            <EmptyState emoji="🚫" title="No deactivated users" />
          ) : deactivated.map(u => (
            <DeactivatedCard key={u.uid} user={u} updating={updating}
              onReactivate={reactivateUser} />
          ))
        )}
      </div>
    </div>
  )
}

// ── EMPTY STATE ───────────────────────────────────────────────────────────────
function EmptyState({ emoji, title }: { emoji: string; title: string }) {
  return (
    <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{emoji}</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
    </div>
  )
}

// ── PENDING CARD ──────────────────────────────────────────────────────────────
function PendingCard({ user, updating, onApprove, onReject }: {
  user: AppUser; updating: string | null
  onApprove: (uid: string, role: UserRole) => void
  onReject: (uid: string) => void
}) {
  const [role, setRole] = useState<UserRole>('offline_sales')
  const isUpdating = updating === user.uid

  return (
    <div style={{ background: '#161b22', borderRadius: 16, padding: 16, border: '1px solid #d97706aa' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, background: 'linear-gradient(135deg,#d97706,#f59e0b)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 18 }}>
          {user.name[0].toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{user.name}</div>
          <div style={{ color: '#64748b', fontSize: 12 }}>{user.email}</div>
          <div style={{ color: '#d97706', fontSize: 11, marginTop: 2 }}>⏳ Awaiting approval</div>
        </div>
      </div>

      {/* Role selector */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1 }}>ASSIGN ROLE</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ROLES.map(r => (
            <button key={r} onClick={() => setRole(r)}
              style={{ background: role === r ? 'rgba(22,163,74,0.15)' : 'rgba(255,255,255,0.04)', color: role === r ? '#16a34a' : '#64748b', border: `1.5px solid ${role === r ? '#16a34a' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, padding: '9px 12px', fontSize: 12, fontWeight: 700, textAlign: 'left' }}>
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onApprove(user.uid, role)} disabled={isUpdating}
          style={{ flex: 1, background: 'rgba(22,163,74,0.15)', color: '#16a34a', border: '1.5px solid rgba(22,163,74,0.3)', borderRadius: 10, padding: '11px', fontSize: 13, fontWeight: 800, opacity: isUpdating ? 0.5 : 1 }}>
          ✅ Approve
        </button>
        <button onClick={() => onReject(user.uid)} disabled={isUpdating}
          style={{ flex: 1, background: 'rgba(220,38,38,0.1)', color: '#dc2626', border: '1.5px solid rgba(220,38,38,0.2)', borderRadius: 10, padding: '11px', fontSize: 13, fontWeight: 800, opacity: isUpdating ? 0.5 : 1 }}>
          ❌ Reject
        </button>
      </div>
    </div>
  )
}

// ── ACTIVE USER CARD ──────────────────────────────────────────────────────────
function UserCard({ user, updating, currentUser, onDeactivate, onRoleChange }: {
  user: AppUser; updating: string | null; currentUser: AppUser
  onDeactivate: (uid: string, name: string) => void
  onRoleChange: (uid: string, role: UserRole) => void
}) {
  const isSuperAdmin = user.email === SUPER_ADMIN_EMAIL
  const isUpdating   = updating === user.uid
  const canDeactivate = !isSuperAdmin && currentUser.email !== user.email

  return (
    <div style={{ background: '#161b22', borderRadius: 16, padding: 16, border: `1px solid ${user.status === 'rejected' ? 'rgba(220,38,38,0.2)' : 'rgba(255,255,255,0.06)'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 44, height: 44, background: isSuperAdmin ? 'linear-gradient(135deg,#d97706,#f59e0b)' : 'linear-gradient(135deg,#1a5c42,#22c55e)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 18 }}>
          {user.name[0].toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{user.name} {isSuperAdmin ? '👑' : ''}</div>
          <div style={{ color: '#64748b', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
          <div style={{ marginTop: 4 }}>
            {user.status === 'rejected'
              ? <span style={{ fontSize: 11, color: '#dc2626', background: 'rgba(220,38,38,0.1)', padding: '2px 8px', borderRadius: 99 }}>❌ Rejected</span>
              : <span style={{ fontSize: 11, color: '#16a34a', background: 'rgba(22,163,74,0.1)', padding: '2px 8px', borderRadius: 99 }}>✅ Active</span>
            }
          </div>
        </div>
        {canDeactivate && (
          <button onClick={() => onDeactivate(user.uid, user.name)} disabled={isUpdating}
            style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.2)', color: '#dc2626', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 700, opacity: isUpdating ? 0.5 : 1 }}>
            🚫 Deactivate
          </button>
        )}
      </div>

      {/* Role change */}
      {!isSuperAdmin && user.status === 'approved' && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1 }}>ROLE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {ROLES.map(r => (
              <button key={r} onClick={() => onRoleChange(user.uid, r)} disabled={isUpdating}
                style={{ background: user.role === r ? 'rgba(8,145,178,0.15)' : 'rgba(255,255,255,0.04)', color: user.role === r ? '#0891b2' : '#64748b', border: `1px solid ${user.role === r ? 'rgba(8,145,178,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 8, padding: '7px 12px', fontSize: 11, fontWeight: 700, textAlign: 'left', opacity: isUpdating ? 0.5 : 1 }}>
                {user.role === r ? '✓ ' : ''}{ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── DEACTIVATED CARD ──────────────────────────────────────────────────────────
function DeactivatedCard({ user, updating, onReactivate }: {
  user: AppUser; updating: string | null
  onReactivate: (uid: string, role: UserRole) => void
}) {
  const [role, setRole] = useState<UserRole>(user.role || 'offline_sales')
  const isUpdating = updating === user.uid

  return (
    <div style={{ background: '#161b22', borderRadius: 16, padding: 16, border: '1px solid rgba(255,255,255,0.04)', opacity: 0.75 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ width: 44, height: 44, background: 'rgba(100,116,139,0.3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 18, color: '#64748b' }}>
          {user.name[0].toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#64748b' }}>{user.name}</div>
          <div style={{ color: '#475569', fontSize: 12 }}>{user.email}</div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>🚫 Deactivated</div>
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1 }}>REACTIVATE WITH ROLE</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ROLES.map(r => (
            <button key={r} onClick={() => setRole(r)}
              style={{ background: role === r ? 'rgba(22,163,74,0.15)' : 'rgba(255,255,255,0.04)', color: role === r ? '#16a34a' : '#64748b', border: `1px solid ${role === r ? '#16a34a' : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700 }}>
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <button onClick={() => onReactivate(user.uid, role)} disabled={isUpdating}
        style={{ width: '100%', background: 'rgba(22,163,74,0.15)', color: '#16a34a', border: '1.5px solid rgba(22,163,74,0.3)', borderRadius: 10, padding: '11px', fontSize: 13, fontWeight: 800, opacity: isUpdating ? 0.5 : 1 }}>
        {isUpdating ? 'Reactivating...' : '✅ Reactivate User'}
      </button>
    </div>
  )
}
