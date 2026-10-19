/**
 * Emulator seeding.
 *
 * Every spec starts from the same known world, built through the Admin SDK so
 * security rules are bypassed here and only here. Nothing in the app is allowed
 * to depend on seed order, and no spec may reach for the Admin SDK itself — a
 * test that writes past the rules stops testing the thing it is there to test.
 */
import { testNow, testDate } from './clock.ts'
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import type { PermissionMap } from '../../../src/types'
// With the extension, because this file is loaded two ways: Playwright bundles
// it, and `scripts/sandbox.mjs` imports it straight into Node. A bundler
// resolves an extensionless path and Node does not, so leaving it off broke the
// sandbox while every test went on passing.
import { DEFAULT_SALES_MANAGER_PERMISSIONS } from '../../../src/auth/permissions.ts'

export const PROJECT_ID = 'demo-ocealgo'
export const PASSWORD = 'Passw0rd!'

/**
 * The shipped manager defaults, imported rather than copied.
 *
 * The copy here had drifted — `assign_work` was added to the real default and
 * never added here, so the seeded manager could not plan a week and no spec
 * could have noticed. Importing it means the world the specs run in is the
 * world the app ships.
 */
const MGR_DEFAULT: PermissionMap = DEFAULT_SALES_MANAGER_PERMISSIONS

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
async function clearOnce(): Promise<void> {
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
 * Collections a spec writes to and the next spec must not inherit.
 *
 * A leftover duty session is the one that bites: the next spec opens on a day
 * that is already running, types its opening reading into what is actually the
 * closing field, and fails looking for a button that was never going to be
 * there. Nothing in the message points at the previous spec.
 */
const VOLATILE = ['duty_sessions', 'visit_logs', 'revisit_logs', 'expense_reports', 'leave_records']

async function leftovers(): Promise<string | null> {
  const db = getFirestore(admin())
  for (const name of VOLATILE) {
    const snap = await db.collection(name).limit(1).get()
    if (!snap.empty) return name
  }
  return null
}

/**
 * Guarantee nobody is on duty, right now.
 *
 * The wipe between specs is not enough on its own. A write issued by a spec
 * that has already finished can arrive seconds later — after the wipe, after
 * the reseed, in the middle of the next spec's sign-in — and the next spec
 * then opens on a day it never started. It fails typing its opening reading
 * into a closing field, three steps and one screen away from anything that
 * points at the cause.
 *
 * So a spec that needs an unstarted day says so, here, immediately before it
 * needs it, rather than inheriting the assumption from a hook that ran a page
 * load ago. Preconditions a test depends on are worth stating out loud.
 */
export async function noOneOnDuty(): Promise<void> {
  await emptyNow('duty_sessions')
}

/**
 * No week already filed, and nothing logged against one.
 *
 * Same reasoning as noOneOnDuty. A spec that declares a nil week has to start
 * from a week nobody has touched — inherit one that is already submitted and
 * the button it is looking for is not drawn, which reads as the feature being
 * broken rather than the world being dirty.
 */
export async function noWeeksFiled(): Promise<void> {
  await emptyNow('expense_reports')
  await emptyNow('expense_entries')
}

/**
 * Stock in the company's hands, for a spec that needs a dispatch to succeed.
 *
 * Separate from the standard world, which starts at zero on purpose: most
 * specs are about who may do a thing, and a world with stock in it would let
 * one of them move some by accident and leave the next one wondering.
 */
export async function companyStock(productId: string, total: number): Promise<void> {
  // Nested, not `productStock.${id}`. `update()` reads a dotted key as a path
  // and `set()` reads it as a field name with dots in it, so the dotted form
  // here wrote a field nothing looks at and the screen went on seeing zero.
  await getFirestore(admin()).doc('config/stock').set(
    { productStock: { [productId]: { total, locked: 0 } }, updatedAt: testNow() },
    { merge: true },
  )
}

/**
 * A day already worked and closed, with a distance on the meter.
 *
 * The end-of-day expenses start from exactly this, and producing it by
 * clicking means an opening reading, a photo, a closing reading and another
 * photo — four steps of setup for an assertion about a fifth.
 */
export async function closedDay(
  who: UserKey,
  date: string,
  opts: { km?: number | null; autoClosed?: boolean } = {},
): Promise<string> {
  const u = USERS[who]
  const km = opts.km === undefined ? 47 : opts.km
  const id = `eod_${u.uid}_${date}`
  await getFirestore(admin()).doc(`duty_sessions/${id}`).set({
    uid: u.uid, name: u.name, date,
    startAt: testNow() - 8 * 3600_000,
    endAt: testNow(),
    status: 'closed',
    ...(km === null
      // No reading at all: the meter was broken, so there is no distance and
      // nothing to work fuel or an allowance band out from.
      ? { odometerStatus: 'broken', odometerIssueNote: 'Needle stuck at zero' }
      : {
          odometerStatus: 'recorded',
          startOdometerKm: 41000, endOdometerKm: 41000 + km,
          startOdometerPhoto: 'demo/odometer.jpg', endOdometerPhoto: 'demo/odometer.jpg',
          claimedDistanceKm: km,
        }),
    ...(opts.autoClosed ? { autoClosed: true } : {}),
  })
  return id
}

/** A day started and not yet ended — "still out". */
export async function openDay(who: UserKey, date: string): Promise<string> {
  const u = USERS[who]
  const id = `open_${u.uid}_${date}`
  await getFirestore(admin()).doc(`duty_sessions/${id}`).set({
    uid: u.uid, name: u.name, date,
    startAt: testNow() - 2 * 3600_000,
    status: 'active', odometerStatus: 'recorded',
    startOdometerKm: 41000, startOdometerPhoto: 'demo/odometer.jpg',
  })
  return id
}

/**
 * A claim already on somebody's week, for a spec about what the day shows
 * rather than about how the claim was made.
 */
export async function claimedExpense(
  who: UserKey,
  date: string,
  lines: { allowance?: number; fuel?: number },
): Promise<void> {
  const u = USERS[who]
  const db = getFirestore(admin())
  const report = db.collection('expense_reports').doc()
  const total = (lines.allowance ?? 0) + (lines.fuel ?? 0)
  await report.set({
    userId: u.uid, userName: u.name, userRole: u.role,
    weekStart: date, weekEnd: date, status: 'draft', totalAmount: total, createdAt: testNow(),
  })
  if (lines.allowance) {
    await db.collection('expense_entries').add({
      reportId: report.id, userId: u.uid, date, type: 'allowance',
      allowanceType: 'EX', amount: lines.allowance, createdAt: testNow(),
    })
  }
  if (lines.fuel) {
    await db.collection('expense_entries').add({
      reportId: report.id, userId: u.uid, date, type: 'variable', category: 'fuel',
      amount: lines.fuel, createdAt: testNow(),
    })
  }
}

/** The ₹ per km rate, which the standard world leaves unset on purpose. */
export async function fuelRate(rate: number): Promise<void> {
  await getFirestore(admin()).doc('expense_config/main').set({ ratePerKm: rate }, { merge: true })
}

/**
 * A product nobody had when the world was built.
 *
 * For the thing that is easy to claim and hard to be sure of: that a product
 * added later needs no code to follow it. Asserting it requires adding one
 * after the screens already exist, which is what this is for.
 */
export async function addProduct(id: string, name: string): Promise<void> {
  await getFirestore(admin()).doc(`products/${id}`).set({
    name, active: true,
    defaultPricePerUnit: 75, unitsPerCarton: 12,
    createdAt: testNow(),
  })
}

/**
 * A monthly packet target, with whatever daily breakdown the spec needs.
 *
 * Both live in one document: the month figure and its per-day split are one
 * decision at two grains, and dividing the first is how the second is usually
 * arrived at.
 */
export async function packetTarget(
  who: UserKey,
  month: string,
  units: number,
  days?: Record<string, number>,
  /**
   * The per-product split. Omitted where a spec is not about products, which
   * is the same shape every target set before products existed has — so these
   * specs also cover that the old shape still works.
   */
  byProduct?: Record<string, number>,
  /**
   * Each product's own days. When given, these are what the app reads and
   * `days` becomes the stored sum — which is why a spec passing both is
   * passing the same fact twice and only one of them decides.
   */
  daysByProduct?: Record<string, Record<string, number>>,
): Promise<void> {
  const u = USERS[who]
  await getFirestore(admin()).doc(`sales_targets/${u.uid}_${month}`).set({
    uid: u.uid, name: u.name, month, units,
    ...(days ? { days } : {}),
    ...(byProduct ? { byProduct } : {}),
    ...(daysByProduct ? { daysByProduct } : {}),
    setBy: USERS.manager.uid, setByName: USERS.manager.name, setAt: testNow(),
  })
}

/**
 * A day assigned to somebody, with the beat's own targets on it.
 *
 * Visits and order value only — the packet figure is not a beat's to carry,
 * because a rep sent off their round still owes the day's packets. That one
 * lives on the rep's month, in `packetTarget` above.
 */
export async function assignedDay(
  who: UserKey,
  date: string,
  targets: { visits?: number; orderValue?: number; units?: number },
): Promise<void> {
  const u = USERS[who]
  await getFirestore(admin()).doc(`work_plans/${u.uid}_${date}`).set({
    uid: u.uid,
    name: u.name,
    date,
    routeId: 'route_test',
    routeName: 'Beach Road',
    targets,
    assignedBy: USERS.manager.uid,
    assignedByName: USERS.manager.name,
    createdAt: testNow(),
  })
}

/**
 * A shop visit, closed, with or without an order — the one fact a strike rate
 * is made of. Seeded rather than clicked: the visit form is covered by its own
 * spec, and what is under test here is the counting.
 */
export async function outletVisit(
  who: UserKey, date: string, partyId: string, orderPlaced: boolean,
): Promise<void> {
  const u = USERS[who]
  const at = new Date(`${date}T11:00:00`).getTime()
  await getFirestore(admin()).collection('outlet_visits').add({
    sessionId: `seed_${u.uid}_${date}`, uid: u.uid, name: u.name, role: u.role, date,
    partyId, partyName: partyId, outletType: 'general',
    punchInAt: at, punchOutAt: at + 20 * 60_000, durationMinutes: 20,
    stock: [], competitors: [], photos: [],
    orderPlaced,
    remarksCategory: orderPlaced ? 'order_booked' : 'no_order_stock_available',
    remarksText: '', status: 'closed',
  })
}

/** A rep given a beat for a day — the plan that coverage's person filter reads. */
export async function beatDay(who: UserKey, date: string, routeId: string, routeName = routeId): Promise<void> {
  const u = USERS[who]
  await getFirestore(admin()).doc(`work_plans/${u.uid}_${date}`).set({
    uid: u.uid, name: u.name, date, routeId, routeName,
    targets: { visits: 10, orderValue: 40000 },
    assignedBy: USERS.manager.uid, assignedByName: USERS.manager.name, createdAt: testNow(),
  })
}

/** A beat and the shops it is meant to cover. */
export async function beat(id: string, name: string, outletIds: string[]): Promise<void> {
  await getFirestore(admin()).doc(`sales_routes/${id}`).set({
    name, places: ['Kochi'], outletIds, active: true,
    defaultTargets: { visits: 10, orderValue: 40000 },
    createdBy: USERS.manager.uid, createdByName: USERS.manager.name, createdAt: testNow(),
  })
}

/**
 * Something a manager logged — a meeting, a day out with a rep, an office day.
 * Written as the app writes it: `withUids` always present, empty included,
 * because the rules read it on every entry.
 */
export async function managerActivity(
  who: UserKey, date: string,
  over: Record<string, unknown> = {},
): Promise<void> {
  const u = USERS[who]
  await getFirestore(admin()).collection('manager_activities').add({
    uid: u.uid, name: u.name, date, kind: 'meeting', title: 'Team review',
    withUids: [], withNames: [], minutes: 45, createdAt: testNow(),
    ...over,
  })
}

/** Local date today, the way the app means it. */
export const todayLocal = (): string => {
  const d = testDate()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const tomorrow = (): string => {
  const d = testDate()
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * An order on the books, at whatever stage the spec needs.
 *
 * Seeded rather than clicked because what is being tested is who may act on
 * one, not who may raise one — and raising one through the UI drags in stock
 * config, a product, a price and a planned date, none of which the assertion
 * is about.
 *
 * The receiving party is the distributor: `party_shop` sits under one, and a
 * company order to a retailer with a distributor above it is a different flow
 * with a different screen.
 */
export async function companyAllocation(
  over: Record<string, unknown> = {},
): Promise<string> {
  const ref = await getFirestore(admin()).collection('allocations_v2').add({
    fromType: 'company', fromId: 'company', fromName: 'Ocealgo',
    partyId: 'party_dist', partyName: 'Rajan Distributors', partyType: 'distributor',
    productId: 'prod_wipes', productName: 'Baby Wet Wipes 72s',
    packets: 24, cartons: 1, pricePerPacket: 60, totalAmount: 1440,
    paymentType: 'credit',
    // Tomorrow, so it stays `pending` rather than ageing into `overdue` — and
    // so the screen reads "Due tomorrow" rather than "Due in 26377 days",
    // which is what a far-future placeholder looked like to anyone watching.
    plannedDate: tomorrow(),
    status: 'pending', notes: '',
    createdBy: USERS.rep.uid, createdByName: USERS.rep.name,
    createdAt: testNow(), month: tomorrow().slice(0, 7), lockedAtCreation: false,
    channel: 'desk',
    ...over,
  })
  return ref.id
}

/**
 * Leave the missed-punch-in sweep wrote, on a day that has already passed.
 *
 * Written through the Admin SDK because that is what the sweep itself is — a
 * server job running with admin credentials, past the rules. A spec cannot
 * produce one by clicking: the sweep fires at a configured hour, on a day it
 * has not already claimed, against somebody who did not punch in. Waiting for
 * that is not a test, so the record it would have written is seeded instead and
 * the spec starts where the officer does: looking at an absence somebody else
 * decided on.
 *
 * `date` is deliberately a parameter. The interesting case is a day in the
 * past, because that is the one the officer sees when they finally pick their
 * phone up.
 */
export async function autoMarkedLeave(
  who: UserKey,
  date: string,
  leaveType: 'full_day' | 'half_day' = 'half_day',
): Promise<string> {
  const u = USERS[who]
  const ref = await getFirestore(admin()).collection('leave_records').add({
    uid: u.uid,
    name: u.name,
    role: u.role,
    date,
    leaveType,
    note: 'No punch-in by 10:00.',
    markedAt: testNow(),
    markedBy: 'system',
    markedByName: 'Automatic',
    status: 'active',
    autoMarked: true,
    auditLog: [{ action: 'admin_marked', by: 'system', byName: 'Automatic', at: testNow() }],
  })
  return ref.id
}

/**
 * Leave a manager marked and approved, as against one the sweep concluded.
 *
 * The distinction is the whole of the appeal rule: an automatic record is the
 * app's guess and stays arguable, while one a person asked for and a manager
 * approved is settled once the day has gone.
 */
export async function approvedLeave(
  who: UserKey,
  date: string,
  leaveType: 'full_day' | 'half_day' = 'full_day',
): Promise<string> {
  const u = USERS[who]
  const by = USERS.admin
  const ref = await getFirestore(admin()).collection('leave_records').add({
    uid: u.uid,
    name: u.name,
    role: u.role,
    date,
    leaveType,
    reason: 'Personal',
    markedAt: testNow(),
    markedBy: by.uid,
    markedByName: by.name,
    status: 'active',
    auditLog: [{ action: 'admin_marked', by: by.uid, byName: by.name, at: testNow() }],
  })
  return ref.id
}

/**
 * Promote a seeded account to super admin.
 *
 * The standard world has no super admin on purpose — it is a bootstrap role
 * granted by hand in the console, and seeding one would make every spec run as
 * though that had already happened. A spec that needs the Settings screen says
 * so here instead, and only for itself.
 */
export async function makeSuperAdmin(who: UserKey): Promise<void> {
  await getFirestore(admin()).doc(`users/${USERS[who].uid}`).update({ role: 'super_admin' })
}

/**
 * No leave on anybody's record, right now.
 *
 * Same reasoning as noOneOnDuty, and the same failure: a spec that asserts an
 * appeal has *not* been sent has to start from a book with no appeal in it.
 * Inherit the previous spec's `unmark_requested` record — which the wipe can
 * miss, because a write already in flight lands after it — and the screen says
 * "Cancellation requested" for a reason that has nothing to do with the test.
 */
export async function noLeaveRecorded(): Promise<void> {
  await emptyNow('leave_records')
}

/**
 * No orders on the books, right now.
 *
 * Same reasoning as noOneOnDuty. A spec that seeds one allocation and asserts
 * on what the row says cannot inherit the previous spec's — two identical rows
 * make a `getByText` ambiguous, and the failure reads as the screen being
 * wrong rather than the world being dirty.
 */
export async function noAllocations(): Promise<void> {
  await emptyNow('allocations_v2')
}

/**
 * No targets set for anybody, right now.
 *
 * The one that bites: a leftover target turns the button from "Set" into
 * "Update", so a spec looking for Set waits ten seconds for a control that is
 * on the screen under another name.
 */
export async function noTargetsSet(): Promise<void> {
  await emptyNow('sales_targets')
}

async function emptyNow(collectionName: string): Promise<void> {
  const snap = await getFirestore(admin()).collection(collectionName).get()
  await Promise.all(snap.docs.map(d => d.ref.delete()))
}

/**
 * Wipe the emulator between specs, and make sure it took.
 *
 * The clear endpoint drops everything in one call, but it cannot drop a write
 * that has not landed yet. A page from the spec that just finished can still
 * have one in flight, and it arrives moments later into what is supposed to be
 * a clean world — rare when a file runs alone, reliable once a long run has
 * put enough latency between the click and the write.
 *
 * So the wipe is checked rather than trusted. Clearing twice costs
 * milliseconds; a spec inheriting another spec's open duty day costs an
 * afternoon, because the failure surfaces nowhere near the cause.
 */
const settle = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function resetWorld(): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    await clearOnce()
    // The pause is the point. Checking immediately after the wipe asks whether
    // the straggler has landed, and the answer is usually "not yet" — which
    // reads as clean and is not. Giving it a moment to arrive is what turns
    // this from a check into a check that catches anything.
    await settle(200)
    const stale = await leftovers()
    if (!stale) return
    if (attempt === 5) {
      throw new Error(`Emulator would not come clean — ${stale} still has documents`)
    }
  }
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
      createdAt: testNow(),
      ...(permissions ? { permissions } : {}),
    })
  }

  await db.doc('config/settings').set({ mapperLink: '' })
  await db.doc('expense_config/main').set({ hq: 200, ex: 300, os: 450 })
  /**
   * `config/stock`, not `stock_config/main`.
   *
   * The seed wrote the second one, which nothing reads — the app and the rules
   * both use `config/stock`. So the carton size never arrived and every screen
   * fell back to its built-in 12, and company stock was zero no matter what
   * was seeded here, which made a successful dispatch untestable.
   */
  await db.doc('config/stock').set({
    packetsPerCarton: 24, total: 0, locked: 0,
    defaultPricePerPacket: 60, updatedAt: testNow(),
  })

  await db.doc('products/prod_wipes').set({
    name: 'Baby Wet Wipes 72s', active: true,
    defaultPricePerUnit: 60, unitsPerCarton: 24, createdAt: testNow(),
  })
  await db.doc('products/prod_mini').set({
    name: 'Baby Wet Wipes 30s', active: true,
    defaultPricePerUnit: 30, unitsPerCarton: 48, createdAt: testNow(),
  })

  const party = (id: string, over: Record<string, unknown>) =>
    db.doc(`parties/${id}`).set({
      name: 'Unnamed', type: 'retailer', category: 'General Store', outletType: 'general',
      phone: '9000000000', address: 'MG Road', place: 'Kochi',
      district: 'Ernakulam', state: 'Kerala', pincode: '682001',
      pricePerPacket: 0, packetsAllocated: 0, cartonsAllocated: 0, lowStockThreshold: 0,
      status: 'active',
      addedBy: USERS.admin.uid, addedByName: USERS.admin.name, createdAt: testNow(),
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
