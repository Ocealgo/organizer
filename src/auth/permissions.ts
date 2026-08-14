import { AppUser, Permission, PermissionMap } from '../types'

/**
 * Single source of truth for "is this user allowed to do X".
 *
 * Replaces the scattered `role === 'admin' || role === 'super_admin'` checks.
 * Mirrored in firestore.rules — if you add a permission here, add it there too,
 * otherwise it is cosmetic and a determined user can bypass it.
 */

// ── Grouped for the User Management editor ───────────────────────────────────
export const PERMISSION_GROUPS: {
  title: string
  items: { key: Permission; label: string; hint?: string }[]
}[] = [
  {
    title: 'Screens they can open',
    items: [
      { key: 'view_parties',     label: 'Network (distributors & retailers)' },
      { key: 'view_allocations', label: 'Allocations' },
      { key: 'view_stock',       label: 'Stock' },
      { key: 'view_products',    label: 'Products' },
      { key: 'view_credit',      label: 'Credit Book' },
      { key: 'view_expenses',    label: 'Expenses (whole team)' },
      { key: 'view_leave',       label: 'Leave Tracker' },
      { key: 'view_reports',     label: 'Sales Reports' },
      { key: 'view_users',       label: 'User Management' },
      { key: 'view_workspace',   label: 'Workspace (reminders, notes)' },
    ],
  },
  {
    title: 'Actions they can take',
    items: [
      { key: 'edit_parties',         label: 'Add & edit parties' },
      { key: 'approve_leave',        label: 'Approve leave requests' },
      { key: 'approve_sales_users',  label: 'Approve offline sales signups', hint: 'Cannot create admins or managers' },
      { key: 'manage_products',      label: 'Create & edit products' },
      { key: 'edit_stock',           label: 'Edit company stock levels' },
      { key: 'dispatch_allocations', label: 'Dispatch stock & fulfil indents', hint: 'Moves real inventory' },
      { key: 'mark_paid',            label: 'Mark allocations paid', hint: 'Money action' },
      { key: 'approve_payments',     label: 'Confirm collected payments', hint: 'Money action' },
      { key: 'clear_expenses',       label: 'Clear expense reports', hint: 'Money action' },
      { key: 'delete_parties',       label: 'Delete parties', hint: 'Destructive' },
    ],
  },
]

export const ALL_PERMISSIONS: Permission[] =
  PERMISSION_GROUPS.flatMap(g => g.items.map(i => i.key))

/**
 * What a brand-new sales manager gets before an admin adjusts anything:
 * full visibility, no money movement.
 */
export const DEFAULT_SALES_MANAGER_PERMISSIONS: PermissionMap = {
  view_parties: true,
  view_allocations: true,
  view_stock: true,
  view_products: true,
  view_credit: true,
  view_expenses: true,
  view_leave: true,
  view_reports: true,
  view_users: true,
  view_workspace: false,

  edit_parties: true,
  approve_leave: true,
  approve_sales_users: true,

  manage_products: false,
  edit_stock: false,
  dispatch_allocations: false,
  mark_paid: false,
  approve_payments: false,
  clear_expenses: false,
  delete_parties: false,
}

// ── Role predicates ──────────────────────────────────────────────────────────

/** Full, unrestricted access. Never gated by the permission map. */
export function isAdminRole(user?: AppUser | null): boolean {
  return user?.role === 'admin' || user?.role === 'super_admin'
}

export function isSuperAdmin(user?: AppUser | null): boolean {
  return user?.role === 'super_admin'
}

export function isSalesManager(user?: AppUser | null): boolean {
  return user?.role === 'sales_manager'
}

/** Anyone who lands on the AdminDashboard rather than a role-specific view. */
export function isManagement(user?: AppUser | null): boolean {
  return isAdminRole(user) || isSalesManager(user)
}

// ── The check ────────────────────────────────────────────────────────────────

export function can(user: AppUser | null | undefined, permission: Permission): boolean {
  if (!user || user.status !== 'approved') return false
  if (isAdminRole(user)) return true
  if (isSalesManager(user)) return user.permissions?.[permission] === true
  return false
}

/** True when the user holds at least one of the listed permissions. */
export function canAny(user: AppUser | null | undefined, permissions: Permission[]): boolean {
  return permissions.some(p => can(user, p))
}

// ── Labels ───────────────────────────────────────────────────────────────────

export const ROLE_LABELS: Record<UserRoleKey, string> = {
  super_admin: '👑 Super Admin',
  admin: '🛡️ Admin',
  sales_manager: '📊 Sales Manager',
  offline_sales: '🏪 Offline Sales',
  online_sales: '🌐 Online Sales',
  offline_marketing: '📣 Offline Marketing',
  online_marketing: '💻 Online Marketing',
}

type UserRoleKey = AppUser['role']

/** Roles an admin may assign. super_admin is deliberately absent — bootstrap only. */
export const ASSIGNABLE_ROLES: UserRoleKey[] = [
  'admin', 'sales_manager',
  'offline_sales', 'online_sales',
  'offline_marketing', 'online_marketing',
]

/** Roles a sales manager may assign when approving a signup. */
export const MANAGER_ASSIGNABLE_ROLES: UserRoleKey[] = ['offline_sales']
