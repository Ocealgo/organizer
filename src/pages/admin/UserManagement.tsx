import React, { useState, useEffect } from 'react'
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { AppUser, UserRole, Permission, PermissionMap } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useConfirm } from '../../hooks/useConfirm'
import {
  ROLE_LABELS, ASSIGNABLE_ROLES, MANAGER_ASSIGNABLE_ROLES,
  PERMISSION_GROUPS, DEFAULT_SALES_MANAGER_PERMISSIONS,
  isAdminRole,
} from '../../auth/permissions'

interface Props { onBack: () => void }

export default function UserManagement({ onBack }: Props) {
  const { appUser } = useAuth()
  const { modal, showDanger } = useConfirm()
  const [users, setUsers] = useState<AppUser[]>([])
  const [tab, setTab] = useState<'pending' | 'active' | 'deactivated'>('pending')
  const [updating, setUpdating] = useState<string | null>(null)

  // Admins manage everyone. A sales manager may only approve or reject a
  // pending signup, and only into the offline sales role — never create
  // admins, never change an existing user's role, never deactivate.
  const viewerIsAdmin = isAdminRole(appUser)
  const assignableRoles: UserRole[] = viewerIsAdmin ? ASSIGNABLE_ROLES : MANAGER_ASSIGNABLE_ROLES

  useEffect(() => {
    return onSnapshot(collection(db, 'users'), snap => {
      setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser)))
    })
  }, [])

  const pending     = users.filter(u => u.status === 'pending')
  const active      = users.filter(u => u.status === 'approved' || u.status === 'rejected')
  const deactivated = users.filter(u => u.status === 'deactivated')

  const approveUser = async (uid: string, role: UserRole) => {
    if (!assignableRoles.includes(role)) return
    setUpdating(uid)
    await updateDoc(doc(db, 'users', uid), {
      status: 'approved',
      role,
      approvedAt: Date.now(),
      approvedBy: appUser!.uid,
      approvedByName: appUser!.name,
      // A new sales manager starts with full visibility and no money actions.
      ...(role === 'sales_manager' ? { permissions: DEFAULT_SALES_MANAGER_PERMISSIONS } : {}),
    })
    setUpdating(null)
  }

  const rejectUser = async (uid: string) => {
    setUpdating(uid)
    await updateDoc(doc(db, 'users', uid), { status: 'rejected' })
    setUpdating(null)
  }

  // Deactivate instead of delete — keeps the Firebase Auth account intact
  const deactivateUser = async (uid: string, name: string) => {
    if (!await showDanger('Deactivate User?', `${name} won't be able to log in. You can reactivate them anytime.`, 'Deactivate')) return
    setUpdating(uid)
    await updateDoc(doc(db, 'users', uid), { status: 'deactivated' })
    setUpdating(null)
  }

  const reactivateUser = async (uid: string, role: UserRole) => {
    setUpdating(uid)
    await updateDoc(doc(db, 'users', uid), {
      status: 'approved',
      role,
      ...(role === 'sales_manager' ? { permissions: DEFAULT_SALES_MANAGER_PERMISSIONS } : {}),
    })
    setUpdating(null)
  }

  const changeRole = async (uid: string, role: UserRole, current?: PermissionMap) => {
    setUpdating(uid)
    await updateDoc(doc(db, 'users', uid), {
      role,
      // Seed defaults the first time someone becomes a manager; keep any
      // existing tuning if they already had a permission map.
      ...(role === 'sales_manager' && !current ? { permissions: DEFAULT_SALES_MANAGER_PERMISSIONS } : {}),
    })
    setUpdating(null)
  }

  const setPermission = async (uid: string, current: PermissionMap, key: Permission, value: boolean) => {
    await updateDoc(doc(db, 'users', uid), {
      permissions: { ...current, [key]: value },
    })
  }

  const TAB_COUNTS = { pending: pending.length, active: active.length, deactivated: deactivated.length }

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#78350f,#d97706)', padding: '24px 20px 16px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fde68a', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 16 }}>← Back</button>
        <div style={{ color: '#fde68a', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>
          {viewerIsAdmin ? 'Admin Panel 👑' : 'Sales Manager 📊'}
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 16 }}>User Management</div>

        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '8px 12px', marginBottom: 14, fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
          {viewerIsAdmin
            ? 'ℹ️ Users are deactivated instead of deleted. This allows the same email to be re-added by reactivating their account.'
            : 'ℹ️ You can approve or reject new signups into the Offline Sales role. Role changes and deactivation are admin-only.'}
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

        {tab === 'pending' && (
          pending.length === 0 ? (
            <EmptyState emoji="✅" title="No pending requests" />
          ) : pending.map(u => (
            <PendingCard key={u.uid} user={u} updating={updating} roles={assignableRoles}
              onApprove={approveUser} onReject={rejectUser} />
          ))
        )}

        {tab === 'active' && (
          active.length === 0 ? (
            <EmptyState emoji="👥" title="No active users yet" />
          ) : active.map(u => (
            <UserCard key={u.uid} user={u} updating={updating}
              currentUser={appUser!}
              viewerIsAdmin={viewerIsAdmin}
              roles={assignableRoles}
              onDeactivate={deactivateUser}
              onRoleChange={changeRole}
              onPermissionChange={setPermission} />
          ))
        )}

        {tab === 'deactivated' && (
          deactivated.length === 0 ? (
            <EmptyState emoji="🚫" title="No deactivated users" />
          ) : deactivated.map(u => (
            <DeactivatedCard key={u.uid} user={u} updating={updating}
              roles={assignableRoles} canReactivate={viewerIsAdmin}
              onReactivate={reactivateUser} />
          ))
        )}
      </div>
      {modal}
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
function PendingCard({ user, updating, roles, onApprove, onReject }: {
  user: AppUser; updating: string | null; roles: UserRole[]
  onApprove: (uid: string, role: UserRole) => void
  onReject: (uid: string) => void
}) {
  const [role, setRole] = useState<UserRole>(roles.includes('offline_sales') ? 'offline_sales' : roles[0])
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

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1 }}>ASSIGN ROLE</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {roles.map(r => (
            <button key={r} onClick={() => setRole(r)}
              style={{ background: role === r ? 'rgba(22,163,74,0.15)' : 'rgba(255,255,255,0.04)', color: role === r ? '#16a34a' : '#64748b', border: `1.5px solid ${role === r ? '#16a34a' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, padding: '9px 12px', fontSize: 12, fontWeight: 700, textAlign: 'left' }}>
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
        {role === 'sales_manager' && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#0891b2', background: 'rgba(8,145,178,0.08)', border: '1px solid rgba(8,145,178,0.2)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
            📊 Starts with full visibility and no money actions. Fine-tune their access on their card in the Active tab.
          </div>
        )}
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

// ── PERMISSION EDITOR ─────────────────────────────────────────────────────────
function PermissionEditor({ user, onChange }: {
  user: AppUser
  onChange: (uid: string, current: PermissionMap, key: Permission, value: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const perms = user.permissions ?? {}
  const granted = PERMISSION_GROUPS.flatMap(g => g.items).filter(i => perms[i.key] === true).length
  const total = PERMISSION_GROUPS.flatMap(g => g.items).length

  return (
    <div style={{ marginTop: 12, background: 'rgba(8,145,178,0.05)', border: '1px solid rgba(8,145,178,0.2)', borderRadius: 12, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: '100%', background: 'none', border: 'none', padding: '11px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#0891b2' }}>
          🔐 Permissions <span style={{ color: '#64748b', fontWeight: 600 }}>({granted}/{total})</span>
        </span>
        <span style={{ color: '#64748b', fontSize: 13 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          {PERMISSION_GROUPS.map(group => (
            <div key={group.title} style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, color: '#64748b', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                {group.title}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {group.items.map(item => {
                  const on = perms[item.key] === true
                  return (
                    <button key={item.key}
                      onClick={() => onChange(user.uid, perms, item.key, !on)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: '7px 0', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                      <span style={{
                        width: 34, height: 20, borderRadius: 99, flexShrink: 0, position: 'relative',
                        background: on ? '#16a34a' : 'rgba(255,255,255,0.12)',
                        transition: 'background 0.15s',
                      }}>
                        <span style={{
                          position: 'absolute', top: 2, left: on ? 16 : 2,
                          width: 16, height: 16, borderRadius: '50%', background: '#fff',
                          transition: 'left 0.15s',
                        }} />
                      </span>
                      <span style={{ flex: 1 }}>
                        <span style={{ fontSize: 12, color: on ? '#e2e8f0' : '#64748b', fontWeight: on ? 600 : 400 }}>
                          {item.label}
                        </span>
                        {item.hint && (
                          <span style={{ display: 'block', fontSize: 10, color: '#475569', marginTop: 1 }}>{item.hint}</span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── ACTIVE USER CARD ──────────────────────────────────────────────────────────
function UserCard({ user, updating, currentUser, viewerIsAdmin, roles, onDeactivate, onRoleChange, onPermissionChange }: {
  user: AppUser; updating: string | null; currentUser: AppUser
  viewerIsAdmin: boolean; roles: UserRole[]
  onDeactivate: (uid: string, name: string) => void
  onRoleChange: (uid: string, role: UserRole, current?: PermissionMap) => void
  onPermissionChange: (uid: string, current: PermissionMap, key: Permission, value: boolean) => void
}) {
  const isSuper = user.role === 'super_admin'
  const isUpdating = updating === user.uid
  const canDeactivate = viewerIsAdmin && !isSuper && currentUser.uid !== user.uid
  const canEditRole = viewerIsAdmin && !isSuper && user.status === 'approved'

  return (
    <div style={{ background: '#161b22', borderRadius: 16, padding: 16, border: `1px solid ${user.status === 'rejected' ? 'rgba(220,38,38,0.2)' : 'rgba(255,255,255,0.06)'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 44, height: 44, background: isSuper ? 'linear-gradient(135deg,#d97706,#f59e0b)' : 'linear-gradient(135deg,#1a5c42,#22c55e)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 18 }}>
          {user.name[0].toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{user.name} {isSuper ? '👑' : ''}</div>
          <div style={{ color: '#64748b', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
          <div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {user.status === 'rejected'
              ? <span style={{ fontSize: 11, color: '#dc2626', background: 'rgba(220,38,38,0.1)', padding: '2px 8px', borderRadius: 99 }}>❌ Rejected</span>
              : <span style={{ fontSize: 11, color: '#16a34a', background: 'rgba(22,163,74,0.1)', padding: '2px 8px', borderRadius: 99 }}>✅ Active</span>
            }
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{ROLE_LABELS[user.role]}</span>
          </div>
        </div>
        {canDeactivate && (
          <button onClick={() => onDeactivate(user.uid, user.name)} disabled={isUpdating}
            style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.2)', color: '#dc2626', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 700, opacity: isUpdating ? 0.5 : 1 }}>
            🚫 Deactivate
          </button>
        )}
      </div>

      {canEditRole && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1 }}>ROLE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {roles.map(r => (
              <button key={r} onClick={() => onRoleChange(user.uid, r, user.permissions)} disabled={isUpdating}
                style={{ background: user.role === r ? 'rgba(8,145,178,0.15)' : 'rgba(255,255,255,0.04)', color: user.role === r ? '#0891b2' : '#64748b', border: `1px solid ${user.role === r ? 'rgba(8,145,178,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 8, padding: '7px 12px', fontSize: 11, fontWeight: 700, textAlign: 'left', opacity: isUpdating ? 0.5 : 1 }}>
                {user.role === r ? '✓ ' : ''}{ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Only admins tune a manager's access — a manager cannot edit their own */}
      {viewerIsAdmin && user.role === 'sales_manager' && user.status === 'approved' && (
        <PermissionEditor user={user} onChange={onPermissionChange} />
      )}
    </div>
  )
}

// ── DEACTIVATED CARD ──────────────────────────────────────────────────────────
function DeactivatedCard({ user, updating, roles, canReactivate, onReactivate }: {
  user: AppUser; updating: string | null; roles: UserRole[]; canReactivate: boolean
  onReactivate: (uid: string, role: UserRole) => void
}) {
  const [role, setRole] = useState<UserRole>(
    roles.includes(user.role) ? user.role : (roles.includes('offline_sales') ? 'offline_sales' : roles[0]),
  )
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

      {canReactivate ? (
        <>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1 }}>REACTIVATE WITH ROLE</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {roles.map(r => (
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
        </>
      ) : (
        <div style={{ fontSize: 11, color: '#475569', textAlign: 'center', padding: '8px 0' }}>
          Only an admin can reactivate accounts.
        </div>
      )}
    </div>
  )
}
