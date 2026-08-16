/**
 * Emulator seeding.
 *
 * Every spec starts from the same known world, built through the Admin SDK so
 * security rules are bypassed here and only here. Nothing in the app is allowed
 * to depend on seed order, and no spec may reach for the Admin SDK itself — a
 * test that writes past the rules stops testing the thing it is there to test.
 */
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import type { PermissionMap } from '../../../src/types'

export const PROJECT_ID = 'demo-ocealgo'
export const PASSWORD = 'Passw0rd!'

/** Mirrors DEFAULT_SALES_MANAGER_PERMISSIONS in src/auth/permissions.ts. */
const MGR_DEFAULT: PermissionMap = {
  view_parties: true, view_allocations: true, view_stock: true, view_products: true,
  view_credit: true, view_expenses: true, view_leave: true, view_reports: true,
  view_users: true, view_workspace: false,
  edit_parties: true, approve_leave: true, approve_sales_users: true,
  manage_products: false, edit_stock: false,
  dispatch_allocations: false, mark_paid: false, approve_payments: false,
  clear_expenses: false, delete_parties: false,
}

const MGR_FULL: PermissionMap = Object.fromEntries(
  Object.keys(MGR_DEFAULT).map(k => [k, true]),
) as PermissionMap

/**
 * The cast every spec draws from. Either the email or the mobile number signs
 * them in — the number is a real linked auth provider here, not just a field,
 * because that is the whole difference between phone sign-in landing on your
 * own account and it minting a stranger with no role.
 */
export const USERS = {
  rep:     { uid: 'e2e_rep',      email: 'rep@ocealgo.test',      phone: '9800000001', name: 'Ravi Rep',      role: 'offline_sales' },
  rep2:    { uid: 'e2e_rep2',     email: 'rep2@ocealgo.test',     phone: '9800000002', name: 'Priya Rep',     role: 'offline_sales' },
  admin:   { uid: 'e2e_admin',    email: 'admin@ocealgo.test',    phone: '9800000003', name: 'Asha Admin',    role: 'admin' },
  manager: { uid: 'e2e_manager',  email: 'manager@ocealgo.test',  phone: '9800000004', name: 'Manoj Manager', role: 'sales_manager' },
  /** A manager with every permission, including the money actions. */
  managerPlus: { uid: 'e2e_manager2', email: 'manager2@ocealgo.test', phone: '9800000005', name: 'Meena Manager', role: 'sales_manager' },
  pending: { uid: 'e2e_pending',  email: 'pending@ocealgo.test',  phone: '9800000006', name: 'Pending Person', role: 'offline_sales' },
} as const

/** No account uses this one. For proving the unknown-number path. */
export const UNKNOWN_PHONE = '9899999999'

export type UserKey = keyof typeof USERS

function admin() {
  // The emulator accepts any credential; these env vars are what route the SDK
  // to it rather than to Google.
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9199'
  const existing = getApps()[0]
  return existing ?? initializeApp({ projectId: PROJECT_ID })
}

/**
 * Wipe the emulator between specs.
 *
 * The emulators expose a dedicated clear endpoint that drops everything in one
 * atomic call. Listing collections and deleting document by document looked
 * equivalent and was not: a write still in flight from the previous spec could
 * land after the sweep had already passed that collection, and the next spec
 * would start with a stray expense on the books.
 */
export async function resetWorld(): Promise<void> {
  const firestore = `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`
  const accounts = `http://127.0.0.1:9099/emulator/v1/projects/${PROJECT_ID}/accounts`
  const res = await Promise.all([
    fetch(firestore, { method: 'DELETE' }),
    fetch(accounts, { method: 'DELETE' }),
  ])
  const bad = res.find(r => !r.ok)
  if (bad) throw new Error(`Could not clear the emulator: ${bad.status} ${bad.statusText}`)
}

/**
 * The code the emulator "texted", for a number.
 *
 * No SMS leaves the machine in a test run — the Auth emulator keeps every code
 * it would have sent on an endpoint and hands them back newest last. Reading it
 * here is what lets the OTP flows be tested end to end instead of mocked, which
 * matters because the bugs in this area live in the wiring, not the arithmetic.
 */
export async function latestSmsCode(tenDigits: string): Promise<string> {
  const url = `http://127.0.0.1:9099/emulator/v1/projects/${PROJECT_ID}/verificationCodes`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not read verification codes: ${res.status}`)
  const { verificationCodes = [] } = await res.json() as {
    verificationCodes?: { phoneNumber: string; code: string }[]
  }
  const mine = verificationCodes.filter(c => c.phoneNumber === `+91${tenDigits}`)
  if (!mine.length) throw new Error(`No code was sent to +91${tenDigits}`)
  return mine[mine.length - 1].code
}

/** Build the standard world: six accounts, two products, three outlets. */
export async function seedWorld(): Promise<void> {
  const app = admin()
  const db = getFirestore(app)
  const auth = getAuth(app)

  for (const [key, u] of Object.entries(USERS)) {
    await auth.createUser({
      uid: u.uid, email: u.email, password: PASSWORD, displayName: u.name,
      phoneNumber: `+91${u.phone}`,
    })
    const permissions =
      key === 'manager' ? MGR_DEFAULT :
      key === 'managerPlus' ? MGR_FULL : undefined
    await db.doc(`users/${u.uid}`).set({
      email: u.email,
      name: u.name,
      phone: `+91${u.phone}`,
      role: u.role,
      status: key === 'pending' ? 'pending' : 'approved',
      createdAt: Date.now(),
      ...(permissions ? { permissions } : {}),
    })
  }

  await db.doc('config/settings').set({ mapperLink: '' })
  await db.doc('expense_config/main').set({ hq: 200, ex: 300, os: 450 })
  await db.doc('stock_config/main').set({
    packetsPerCarton: 24, total: 0, locked: 0, updatedAt: Date.now(),
  })

  await db.doc('products/prod_wipes').set({
    name: 'Baby Wet Wipes 72s', active: true,
    defaultPricePerUnit: 60, unitsPerCarton: 24, createdAt: Date.now(),
  })
  await db.doc('products/prod_mini').set({
    name: 'Baby Wet Wipes 30s', active: true,
    defaultPricePerUnit: 30, unitsPerCarton: 48, createdAt: Date.now(),
  })

  const party = (id: string, over: Record<string, unknown>) =>
    db.doc(`parties/${id}`).set({
      name: 'Unnamed', type: 'retailer', category: 'General Store', outletType: 'general',
      phone: '9000000000', address: 'MG Road', place: 'Kochi',
      district: 'Ernakulam', state: 'Kerala', pincode: '682001',
      pricePerPacket: 0, packetsAllocated: 0, cartonsAllocated: 0, lowStockThreshold: 0,
      status: 'active',
      addedBy: USERS.admin.uid, addedByName: USERS.admin.name, createdAt: Date.now(),
      ...over,
    })

  await party('party_dist', {
    name: 'Rajan Distributors', type: 'distributor', category: 'FMCG',
    outletType: 'distributor', phone: '9000000001',
  })
  await party('party_shop', {
    name: 'Anand Stores', phone: '9000000002',
    underDistributorId: 'party_dist', underDistributorName: 'Rajan Distributors',
  })
  await party('party_pharmacy', {
    name: 'Guardian Pharmacy', category: 'Pharma', outletType: 'pharmacy',
    phone: '9000000003', status: 'prospect',
  })
}

export async function closeAdmin(): Promise<void> {
  const app = getApps()[0]
  if (app) await deleteApp(app)
}
