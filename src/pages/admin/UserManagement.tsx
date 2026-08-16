import { useState, useEffect } from 'react'
import { collection, doc, updateDoc } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import { AppUser, UserRole, Permission, PermissionMap } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import { PageHeader, TabBar, EmptyState, GhostButton, Eyebrow } from '../../components/ui'
import {
  ROLE_LABELS_PLAIN, ASSIGNABLE_ROLES, MANAGER_ASSIGNABLE_ROLES,
  PERMISSION_GROUPS, DEFAULT_SALES_MANAGER_PERMISSIONS,
  isAdminRole,
} from '../../auth/permissions'

interface Props { onBack: () => void }
type Tab = 'pending' | 'active' | 'deactivated'

export default function UserManagement({ onBack }: Props) {
  const { appUser } = useAuth()
  const { t } = useTheme()
  const { modal, showDanger, showAlert } = useConfirm()
  const [users, setUsers] = useState<AppUser[]>([])
  const [tab, setTab] = useState<Tab>('pending')
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

  // Every write goes through here. Without it a rejected write fails silently
  // and the card just sits there, which is indistinguishable from "nothing
  // happened" — the failure has to be visible.
  const run = async (
    uid: string,
    what: string,
    payload: Record<string, unknown>,
    note?: string,
  ) => {
    setUpdating(uid)
    try {
      await updateDoc(doc(db, 'users', uid), payload)
    } catch (e: any) {
      const denied = e?.code === 'permission-denied'
      // Report what was actually attempted — guessing at the cause from a bare
      // "permission denied" wastes more time than printing the facts.
      const detail = denied
        ? [
            'Firestore rejected the write.',
            `You are signed in as ${ROLE_LABELS_PLAIN[appUser!.role]}, status ${appUser!.status}.`,
            `Fields sent: ${Object.keys(payload).join(', ')}.`,
            note,
            'If the deployed rules are older than this build, deploy them again with npm run rules:deploy:dev',
          ].filter(Boolean).join('\n\n')
        : e?.message || 'Something went wrong. Please try again.'

      console.error(`[UserManagement] ${what} failed`, { code: e?.code, payload, error: e })
      await showAlert(`Could not ${what}`, detail)
    } finally {
      setUpdating(null)
    }
  }

  const approveUser = async (uid: string, role: UserRole) => {
    if (!assignableRoles.includes(role)) {
      await showAlert('That role is not yours to assign', `You cannot approve someone as ${ROLE_LABELS_PLAIN[role]}.`)
      return
    }
    await run(uid, 'approve this account', {
      status: 'approved',
      role,
      approvedAt: Date.now(),
      approvedBy: appUser!.uid,
      approvedByName: appUser!.name,
      // A new sales manager starts with full visibility and no money actions.
      ...(role === 'sales_manager' ? { permissions: DEFAULT_SALES_MANAGER_PERMISSIONS } : {}),
    }, role === 'sales_manager'
      ? 'Approving as Sales manager also writes a permissions map. Rules deployed before the sales manager feature reject that field.'
      : undefined)
  }

  const rejectUser = async (uid: string) =>
    run(uid, 'turn down this request', { status: 'rejected' })

  // Deactivate instead of delete — keeps the Firebase Auth account intact
  const deactivateUser = async (uid: string, name: string) => {
    if (!await showDanger('Deactivate this account?', `${name} will not be able to log in. You can bring them back at any time.`, 'Deactivate')) return
    await run(uid, 'deactivate this account', { status: 'deactivated' })
  }

  const reactivateUser = async (uid: string, role: UserRole) =>
    run(uid, 'bring this account back', {
      status: 'approved',
      role,
      ...(role === 'sales_manager' ? { permissions: DEFAULT_SALES_MANAGER_PERMISSIONS } : {}),
    })

  const changeRole = async (uid: string, role: UserRole, current?: PermissionMap) =>
    run(uid, 'change this role', {
      role,
      // Seed defaults the first time someone becomes a manager; keep any
      // existing tuning if they already had a permission map.
      ...(role === 'sales_manager' && !current ? { permissions: DEFAULT_SALES_MANAGER_PERMISSIONS } : {}),
    })

  const setPermission = async (uid: string, current: PermissionMap, key: Permission, value: boolean) =>
    run(uid, 'change that permission', { permissions: { ...current, [key]: value } })

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 56 }}>
      <PageHeader
        eyebrow={viewerIsAdmin ? 'Admin' : 'Sales manager'}
        title="Team"
        subtitle={viewerIsAdmin
          ? 'Accounts are deactivated rather than deleted, so the same email can be brought back later.'
          : 'You can approve or reject new signups into offline sales. Role changes and deactivation stay with an admin.'}
        onBack={onBack}
        divider={false}
      />

      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'pending', label: `Pending (${pending.length})` },
          { id: 'active', label: `Active (${active.length})` },
          { id: 'deactivated', label: `Deactivated (${deactivated.length})` },
        ]}
      />

      {/* Rows carry their own top hairline, so the list has no gap — the
          rules run continuously the way they do on the dashboard. */}
      <div style={{ padding: '24px 20px 48px' }}>

        {tab === 'pending' && (
          pending.length === 0 ? (
            <EmptyState title="Nobody is waiting"
              body="New signups appear here for you to approve or turn down." />
          ) : (
            <div className="oc-list-flush" style={{ borderBottom: `0.5px solid ${t.border}` }}>
              {pending.map(u => (
                <PendingCard key={u.uid} user={u} updating={updating} roles={assignableRoles}
                  onApprove={approveUser} onReject={rejectUser} />
              ))}
            </div>
          )
        )}

        {tab === 'active' && (
          active.length === 0 ? (
            <EmptyState title="No active accounts yet"
              body="Once you approve a signup, the account shows up here." />
          ) : (
            <div className="oc-list-flush" style={{ borderBottom: `0.5px solid ${t.border}` }}>
              {active.map(u => (
                <UserCard key={u.uid} user={u} updating={updating}
                  currentUser={appUser!}
                  viewerIsAdmin={viewerIsAdmin}
                  roles={assignableRoles}
                  onDeactivate={deactivateUser}
                  onRoleChange={changeRole}
                  onPermissionChange={setPermission} />
              ))}
            </div>
          )
        )}

        {tab === 'deactivated' && (
          deactivated.length === 0 ? (
            <EmptyState title="Nobody has been deactivated"
              body="Accounts you switch off are kept here so you can bring them back." />
          ) : (
            <div className="oc-list-flush" style={{ borderBottom: `0.5px solid ${t.border}` }}>
              {deactivated.map(u => (
                <DeactivatedCard key={u.uid} user={u} updating={updating}
                  roles={assignableRoles} canReactivate={viewerIsAdmin}
                  onReactivate={reactivateUser} />
              ))}
            </div>
          )
        )}
      </div>
      {modal}
    </div>
  )
}

// ── shared bits ──────────────────────────────────────────────────────────────
function useChip() {
  const { t } = useTheme()
  return (active: boolean) => ({
    background: 'none',
    border: `0.5px solid ${active ? t.text2 : t.border}`,
    borderRadius: 99,
    padding: '6px 13px',
    fontSize: 12,
    fontWeight: 400 as const,
    color: active ? t.text : t.text3,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  })
}

function CardShell({ children }: { children: React.ReactNode }) {
  const { t } = useTheme()
  return (
    <div style={{ borderTop: `0.5px solid ${t.border}`, padding: '18px 0' }}>{children}</div>
  )
}

function Identity({ user, note }: { user: AppUser; note?: string }) {
  const { t } = useTheme()
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 15, fontWeight: 500, color: t.text }}>{user.name}</div>
      <div style={{ fontSize: 13, color: t.text3, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {user.email}
      </div>
      {note && <div style={{ fontSize: 13, color: t.text3, marginTop: 2 }}>{note}</div>}
    </div>
  )
}

// ── PENDING ──────────────────────────────────────────────────────────────────
function PendingCard({ user, updating, roles, onApprove, onReject }: {
  user: AppUser; updating: string | null; roles: UserRole[]
  onApprove: (uid: string, role: UserRole) => void
  onReject: (uid: string) => void
}) {
  const { t } = useTheme()
  const chip = useChip()
  const [role, setRole] = useState<UserRole>(roles.includes('offline_sales') ? 'offline_sales' : roles[0])
  const isUpdating = updating === user.uid

  return (
    <CardShell>
      <Identity user={user} note="Waiting for approval" />

      <div style={{ marginTop: 14 }}>
        <div style={{ marginBottom: 8 }}><Eyebrow>Give them the role of</Eyebrow></div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {roles.map(r => (
            <button key={r} className="oc-action" onClick={() => setRole(r)} style={chip(role === r)}>
              {ROLE_LABELS_PLAIN[r]}
            </button>
          ))}
        </div>
        {role === 'sales_manager' && (
          <div style={{ marginTop: 10, fontSize: 13, color: t.text3, lineHeight: 1.5 }}>
            Starts with full visibility and no money actions. Fine-tune their access
            on their card in the Active tab.
          </div>
        )}
      </div>

      <div className="oc-wrap" style={{ gap: 8, marginTop: 16 }}>
        <GhostButton onClick={() => onApprove(user.uid, role)} disabled={isUpdating}>
          Approve
        </GhostButton>
        <GhostButton onClick={() => onReject(user.uid)} disabled={isUpdating}>
          Turn down
        </GhostButton>
      </div>
    </CardShell>
  )
}

// ── PERMISSION EDITOR ────────────────────────────────────────────────────────
function PermissionEditor({ user, onChange }: {
  user: AppUser
  onChange: (uid: string, current: PermissionMap, key: Permission, value: boolean) => void
}) {
  const { t } = useTheme()
  const [open, setOpen] = useState(false)
  const perms = user.permissions ?? {}
  const all = PERMISSION_GROUPS.flatMap(g => g.items)
  const granted = all.filter(i => perms[i.key] === true).length

  return (
    <div style={{ marginTop: 14 }}>
      <button className="oc-action" onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, color: t.text2, cursor: 'pointer' }}>
        {open ? 'Hide' : 'Show'} permissions ({granted} of {all.length})
      </button>

      {open && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {PERMISSION_GROUPS.map(group => (
            <div key={group.title}>
              <div style={{ marginBottom: 8 }}><Eyebrow>{group.title}</Eyebrow></div>
              <div>
                {group.items.map(item => {
                  const on = perms[item.key] === true
                  return (
                    <button key={item.key} className="oc-row"
                      onClick={() => onChange(user.uid, perms, item.key, !on)}
                      aria-pressed={on}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%',
                        textAlign: 'left', background: 'none', border: 'none',
                        borderTop: `0.5px solid ${t.border}`, padding: '11px 6px', cursor: 'pointer',
                      }}>
                      <span style={{
                        width: 30, height: 18, borderRadius: 99, flexShrink: 0, marginTop: 1,
                        position: 'relative',
                        background: on ? t.text2 : 'transparent',
                        border: `0.5px solid ${on ? t.text2 : t.border2}`,
                      }}>
                        <span style={{
                          position: 'absolute', top: 2, left: on ? 13 : 2,
                          width: 12, height: 12, borderRadius: '50%',
                          background: on ? t.bg : t.text3,
                        }} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 14, fontWeight: 400, color: on ? t.text : t.text3 }}>
                          {item.label}
                        </span>
                        {item.hint && (
                          <span style={{ display: 'block', fontSize: 12, color: t.text3, marginTop: 2 }}>
                            {item.hint}
                          </span>
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

// ── ACTIVE ───────────────────────────────────────────────────────────────────
function UserCard({ user, updating, currentUser, viewerIsAdmin, roles, onDeactivate, onRoleChange, onPermissionChange }: {
  user: AppUser; updating: string | null; currentUser: AppUser
  viewerIsAdmin: boolean; roles: UserRole[]
  onDeactivate: (uid: string, name: string) => void
  onRoleChange: (uid: string, role: UserRole, current?: PermissionMap) => void
  onPermissionChange: (uid: string, current: PermissionMap, key: Permission, value: boolean) => void
}) {
  const { t } = useTheme()
  const chip = useChip()
  const isSuper = user.role === 'super_admin'
  const isUpdating = updating === user.uid
  const canDeactivate = viewerIsAdmin && !isSuper && currentUser.uid !== user.uid
  const canEditRole = viewerIsAdmin && !isSuper && user.status === 'approved'

  return (
    <CardShell>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <Identity user={user}
          note={`${ROLE_LABELS_PLAIN[user.role]}${user.status === 'rejected' ? ' · turned down' : ''}`} />
        {canDeactivate && (
          <GhostButton onClick={() => onDeactivate(user.uid, user.name)} disabled={isUpdating}
            style={{ flexShrink: 0 }}>
            Deactivate
          </GhostButton>
        )}
      </div>

      {canEditRole && (
        <div style={{ marginTop: 14 }}>
          <div style={{ marginBottom: 8 }}><Eyebrow>Role</Eyebrow></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {roles.map(r => (
              <button key={r} className="oc-action" disabled={isUpdating}
                onClick={() => onRoleChange(user.uid, r, user.permissions)}
                style={chip(user.role === r)}>
                {ROLE_LABELS_PLAIN[r]}
              </button>
            ))}
          </div>
        </div>
      )}

      {isSuper && (
        <div style={{ fontSize: 13, color: t.text3, marginTop: 10 }}>
          The super admin account cannot be changed from here.
        </div>
      )}

      {/* Only admins tune a manager's access — a manager cannot edit their own */}
      {viewerIsAdmin && user.role === 'sales_manager' && user.status === 'approved' && (
        <PermissionEditor user={user} onChange={onPermissionChange} />
      )}
    </CardShell>
  )
}

// ── DEACTIVATED ──────────────────────────────────────────────────────────────
function DeactivatedCard({ user, updating, roles, canReactivate, onReactivate }: {
  user: AppUser; updating: string | null; roles: UserRole[]; canReactivate: boolean
  onReactivate: (uid: string, role: UserRole) => void
}) {
  const { t } = useTheme()
  const chip = useChip()
  const [role, setRole] = useState<UserRole>(
    roles.includes(user.role) ? user.role : (roles.includes('offline_sales') ? 'offline_sales' : roles[0]),
  )
  const isUpdating = updating === user.uid

  return (
    <CardShell>
      <Identity user={user} note="Deactivated" />

      {canReactivate ? (
        <>
          <div style={{ marginTop: 14 }}>
            <div style={{ marginBottom: 8 }}><Eyebrow>Bring back as</Eyebrow></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {roles.map(r => (
                <button key={r} className="oc-action" onClick={() => setRole(r)} style={chip(role === r)}>
                  {ROLE_LABELS_PLAIN[r]}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <GhostButton onClick={() => onReactivate(user.uid, role)} disabled={isUpdating}>
              {isUpdating ? 'Bringing back…' : 'Bring this account back'}
            </GhostButton>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: t.text3, marginTop: 10 }}>
          Only an admin can bring an account back.
        </div>
      )}
    </CardShell>
  )
}
