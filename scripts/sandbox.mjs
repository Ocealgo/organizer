/**
 * A world you can click around in, that no real person is in.
 *
 * `npm run e2e` already builds a seeded emulator world, but it builds it inside
 * Playwright and tears it down again — there is no way to stand in it yourself
 * and use the app the way a rep does. This is that: the same seed, the same
 * accounts, left running on http://127.0.0.1:5174 for as long as you want it.
 *
 * Port 5174, not 5173, so it never fights `npm run dev` for the port — the
 * sandbox and a live-pointing dev server can sit side by side in two tabs.
 *
 * WHY IT CANNOT TOUCH LIVE DATA
 * `--mode test` loads `.env.test`, whose project id is `demo-ocealgo`. The
 * Firebase SDKs refuse to reach real infrastructure for a `demo-` project, so a
 * misconfigured run fails loudly rather than writing to somebody's live week.
 * There is no path from here to production short of editing that file.
 *
 * The seed itself is `tests/e2e/fixtures/seed.ts`, imported rather than copied.
 * A sandbox that drifts from what the specs assert is a sandbox that lies.
 *
 * NO DATA VIEWER HERE
 * firebase.json enables the Emulator UI, but `emulators:exec` is the CI entry
 * point and does not start it — it runs a command against the emulators and
 * leaves. `npm run emulators` is the one that opens the UI, and it takes no
 * command, so having both would mean two processes and two worlds to keep
 * straight. The app is the viewer: everything seeded here is reachable through
 * a screen, which is the point of a sandbox you click rather than query.
 */
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import {
  resetWorld, seedWorld, closeAdmin, USERS, PASSWORD, PROJECT_ID,
  companyStock, companyAllocation, assignedDay, todayLocal,
} from '../tests/e2e/fixtures/seed.ts'
import { divideByProductAcrossDays, dayTotalsFromProducts } from '../src/types.ts'

/**
 * Two public holidays, one gone and one ahead, so the planner's calendar shows
 * both kinds of day off — Sundays and a holiday the admin declared — and the
 * week and month reports have a day nobody was expected to work.
 */
const HOLIDAYS = [
  { date: '2026-10-02', name: 'Gandhi Jayanti' },
  { date: '2026-10-20', name: 'Vijayadashami' },
]
const isDayOff = (date) =>
  new Date(date + 'T00:00:00').getDay() === 0 || HOLIDAYS.some(h => h.date === date)

/**
 * Things the specs deliberately leave unset, and a person poking at the app
 * deliberately wants set.
 *
 * Applied after seedWorld rather than inside it. `expenses.spec.ts` asserts
 * that fuel falls back to a typed amount when no rate is configured, so
 * seeding a rate into the shared world would break the test that proves the
 * fallback exists.
 */
async function sandboxExtras() {
  const db = getFirestore()

  // Makes fuel-by-distance live: the rep enters kilometres and the amount is
  // worked out from this. Without it the fuel field asks for rupees instead.
  await db.doc('expense_config/main').set(
    { hq: 200, ex: 300, os: 450, ratePerKm: 4.5 },
    { merge: true },
  )

  // The seed writes `stock_config/main`, which nothing reads — the app and the
  // rules both use `config/stock`. Written here so the sandbox has a carton
  // size and the Allocations screen is usable.
  await db.doc('config/stock').set({
    total: 0, locked: 0, packetsPerCarton: 24,
    defaultPricePerPacket: 60, updatedAt: Date.now(),
  })

  // Something to send. The specs start from zero on purpose — a world with
  // stock in it lets one of them move some by accident — but a sandbox that
  // cannot dispatch an order is a sandbox with half its screens dead.
  await companyStock('prod_wipes', 2000)
  await companyStock('prod_mini', 2000)

  for (const h of HOLIDAYS) {
    await db.doc(`holidays/${h.date}`).set({
      ...h, createdBy: USERS.admin.uid, createdByName: USERS.admin.name, createdAt: Date.now(),
    })
  }

  /**
   * A beat, a day assigned from it, and a month with its days divided.
   *
   * Without them the planner works and shows nothing, which looks exactly like
   * it being broken: the Assign tab opens on "no beats to assign yet", which
   * is a dead end rather than an explanation, and the Targets tab has no month
   * to divide.
   *
   * The beat carries visits and order value, which are a round's own business.
   * The packet figures are not — they are the rep's, on their month, because a
   * day spent off the round still owes its packets.
   */
  await db.doc('sales_routes/route_demo').set({
    name: 'Beach Road',
    description: 'A short round, for looking at.',
    places: ['Kochi'],
    outletIds: ['party_shop', 'party_pharmacy'],
    defaultTargets: { visits: 12, orderValue: 50000 },
    active: true,
    createdBy: USERS.manager.uid,
    createdByName: USERS.manager.name,
    createdAt: Date.now(),
  })

  // Today, carrying the beat's own numbers the way the planner copies them.
  await assignedDay('rep', todayLocal(), { visits: 12, orderValue: 50000 })

  /**
   * A month, divided across the days that can be worked.
   *
   * Divided here with the same function the planner's button uses, so the
   * sandbox opens on exactly what a manager would get by pressing it — rather
   * than on a hand-picked number that happens to look plausible.
   */
  const month = todayLocal().slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  const workable = []
  for (let d = 1; d <= lastDay; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`
    if (isDayOff(date)) continue
    workable.push(date)
  }

  const ravi = divideByProductAcrossDays({ prod_wipes: 600, prod_mini: 400 }, workable)
  // Today carries a figure whatever weekday it is, for the same reason today
  // is seeded as worked: the rep's card leads with today, and on a Sunday the
  // division leaves it empty, so there would be nothing to look at. 23 and 14
  // against the 24-packet order below puts one product over and one under —
  // both states on one screen.
  ravi.prod_wipes = { ...(ravi.prod_wipes ?? {}), [todayLocal()]: 23 }
  ravi.prod_mini = { ...(ravi.prod_mini ?? {}), [todayLocal()]: 14 }
  const priya = divideByProductAcrossDays({ prod_wipes: 250, prod_mini: 350 }, workable)

  await db.doc(`sales_targets/${USERS.rep.uid}_${month}`).set({
    uid: USERS.rep.uid,
    name: USERS.rep.name,
    month,
    units: 1000,
    // Split across the two products, which is what makes the product filter
    // answer anything. 600 and 400 rather than 500 each, so a reader can tell
    // which column is which.
    byProduct: { prod_wipes: 600, prod_mini: 400 },
    // Each product divided over the month with the same function the planner's
    // button uses, so the sandbox opens on exactly what a manager would get by
    // pressing it. `days` is the sum, as the app writes it.
    daysByProduct: ravi,
    days: dayTotalsFromProducts(ravi),
    note: 'Onam push — the month to make it up in.',
    setBy: USERS.manager.uid,
    setByName: USERS.manager.name,
    setAt: Date.now(),
  })

  /**
   * The second officer gets one too, and a smaller one.
   *
   * Only one rep had a target, so half of every "Everybody" view read "No
   * target" — which reads as the feature being broken rather than as a gap in
   * the seed. Two different figures also make the monitor's columns worth
   * comparing rather than identical down the page.
   */
  await db.doc(`sales_targets/${USERS.rep2.uid}_${month}`).set({
    uid: USERS.rep2.uid,
    name: USERS.rep2.name,
    month,
    units: 600,
    byProduct: { prod_wipes: 250, prod_mini: 350 },
    daysByProduct: priya,
    days: dayTotalsFromProducts(priya),
    setBy: USERS.manager.uid,
    setByName: USERS.manager.name,
    setAt: Date.now(),
  })

  // One order already placed, so both lines open on something other than zero
  // and cancelling it is one tap from showing what that does.
  await companyAllocation()

  /**
   * Today, already worked and closed, for Ravi.
   *
   * The end-of-day expenses appear only once the day is over, so a world where
   * nobody has finished today is a world where that card cannot be looked at.
   * Seeded whatever weekday it is — including a Sunday, which is the one
   * exception to the rule the rest of this file keeps — because a sandbox
   * exists to put screens in front of somebody, and waiting until Monday to
   * see one is not that.
   *
   * 47 km: beyond 25, so the allowance opens on EX, and an odd number so the
   * fuel line shows paise rather than a round figure that hides the arithmetic.
   */
  const today = todayLocal()
  await db.doc(`duty_sessions/sandbox_today_${USERS.rep.uid}`).set({
    uid: USERS.rep.uid, name: USERS.rep.name, date: today,
    routeId: 'route_demo', routeName: 'Beach Road',
    startAt: new Date(`${today}T09:05:00`).getTime(),
    startOdometerKm: 42100, startOdometerPhoto: 'demo/odometer.jpg',
    odometerStatus: 'recorded',
    endAt: new Date(`${today}T17:50:00`).getTime(),
    endOdometerKm: 42147, endOdometerPhoto: 'demo/odometer.jpg',
    claimedDistanceKm: 47,
    status: 'closed',
  })

  /**
   * And Priya, still out today: started, three shops in, not ended. The day
   * Field activity calls "still out" and the end-of-day card has to call the
   * same thing — a running total, not an end of day.
   */
  const priyaStart = new Date(`${today}T09:20:00`).getTime()
  await db.doc(`duty_sessions/sandbox_today_${USERS.rep2.uid}`).set({
    uid: USERS.rep2.uid, name: USERS.rep2.name, date: today,
    routeId: 'route_market', routeName: 'Market Road',
    startAt: priyaStart, startOdometerKm: 23400, startOdometerPhoto: 'demo/odometer.jpg',
    startLocation: { lat: 9.9312, lng: 76.2673, accuracy: 18, capturedAt: priyaStart },
    odometerStatus: 'recorded', status: 'active',
  })
  await db.doc(`work_plans/${USERS.rep2.uid}_${today}`).set({
    uid: USERS.rep2.uid, name: USERS.rep2.name, date: today,
    routeId: 'route_market', routeName: 'Market Road',
    targets: { visits: 10, orderValue: 40000 },
    assignedBy: USERS.manager.uid, assignedByName: USERS.manager.name, createdAt: priyaStart,
  })
  const priyaShops = [['party_dist', 'Rajan Distributors', 'distributor'],
    ['sb_kaloor_1', 'Kaloor Baby Store', 'general'], ['sb_vytt_1', 'Vyttila Fresh', 'grocery']]
  for (const [i, [id, name, type]] of priyaShops.entries()) {
    const at = new Date(`${today}T${10 + i}:15:00`).getTime()
    await db.doc(`outlet_visits/sandbox_today_${USERS.rep2.uid}_${i}`).set({
      sessionId: `sandbox_today_${USERS.rep2.uid}`, uid: USERS.rep2.uid, name: USERS.rep2.name,
      role: USERS.rep2.role, date: today, partyId: id, partyName: name, outletType: type,
      punchInAt: at, punchInLocation: { lat: 9.96 + i * 0.01, lng: 76.29, accuracy: 18, capturedAt: at },
      punchOutAt: at + 20 * 60_000, durationMinutes: 20,
      stock: [], competitors: [], photos: [], orderPlaced: false,
      remarksCategory: 'no_order_stock_available', remarksText: '', status: 'closed',
    })
  }
}

/**
 * A month behind us, for every officer, with days that landed and days that did not.
 *
 * The sandbox was a world with one order in it, which is enough to see a
 * screen and not enough to see a report. A range only means something over
 * several days; a met/missed filter only means something when both exist; and
 * a per-person view only means something when more than one person has
 * anything in it.
 *
 * Shaped, not random. A fixed pattern per person per day means the same
 * sandbox comes back on every reseed, so a number somebody is puzzled by is
 * still there when they go back to look at it.
 */

/**
 * Where things are, so a day has positions to join.
 *
 * Without them every "between shops" figure is Nil, which is true of a day with
 * no fixes and useless for seeing what the figure is for. A few kilometres
 * apart, so the straight-line distance comes out well under the meter — which
 * is the honest relationship between the two, and the one worth seeing.
 */
const DEPOT = { lat: 9.9312, lng: 76.2673 }
const STOPS = [
  { lat: 9.9658, lng: 76.2421 },
  { lat: 9.9816, lng: 76.2999 },
  { lat: 10.0089, lng: 76.3110 },
]
const fix = (p, t) => ({ lat: p.lat, lng: p.lng, accuracy: 18, capturedAt: t })

/** Parties to visit, with the type each one reports as. */
const OUTLETS = [
  { id: 'party_shop', name: 'Anand Stores', type: 'general' },
  { id: 'party_pharmacy', name: 'Guardian Pharmacy', type: 'pharmacy' },
  { id: 'party_dist', name: 'Rajan Distributors', type: 'distributor' },
]

const dayAhead = (n) => dayBack(-n)
const dayBack = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A timestamp at an hour on a day, so the day it lands on is the day meant. */
const at = (date, hour, min = 0) =>
  new Date(`${date}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`).getTime()

/**
 * A third officer, who exists only here.
 *
 * Two people make a ranking that is a coin toss — one of them leads, the other
 * does not. Three is the smallest number where the order of the bars says
 * something. Kept out of the shared seed so no spec has to account for a rep
 * it never asked for.
 */
const ARJUN = {
  uid: 'sandbox_rep3', email: 'rep3@ocealgo.test', phone: '9800000007',
  name: 'Arjun Rep', role: 'offline_sales',
}

/**
 * A super admin, which the shared seed has none of. The app treats one
 * differently from an admin in a few places — only a super admin may touch an
 * admin's account, or make another super admin — so those are only testable
 * signed in as one. Emulator only, like everything here.
 */
const SUPER = {
  uid: 'sandbox_super', email: 'super@ocealgo.test', phone: '9800000008',
  name: 'Sara Superadmin', role: 'super_admin',
}

/** Shops on each beat, in their own areas, so the Area column has places to name. */
const SHOPS = [
  { id: 'sb_fort_1', name: 'Fort Supermart', place: 'Fort Kochi', type: 'grocery', category: 'Supermarket' },
  { id: 'sb_matt_1', name: 'Mattancherry Medicals', place: 'Mattancherry', type: 'pharmacy', category: 'Pharma' },
  { id: 'sb_kaloor_1', name: 'Kaloor Baby Store', place: 'Kaloor', type: 'general', category: 'General Store' },
  { id: 'sb_vytt_1', name: 'Vyttila Fresh', place: 'Vyttila', type: 'grocery', category: 'Supermarket' },
  { id: 'sb_vytt_2', name: 'Hub Pharmacy', place: 'Vyttila', type: 'pharmacy', category: 'Pharma' },
  { id: 'sb_kakk_1', name: 'Infopark Mart', place: 'Kakkanad', type: 'grocery', category: 'Supermarket' },
  { id: 'sb_edap_1', name: 'Lulu Kids Corner', place: 'Edappally', type: 'general', category: 'General Store' },
  { id: 'sb_edap_2', name: 'Edappally Care Pharmacy', place: 'Edappally', type: 'pharmacy', category: 'Pharma' },
  // On a beat, and never visited — so Beat coverage has gaps to show, the way a
  // real beat does. Nobody's outlet list below includes these.
  { id: 'sb_quiet_1', name: 'Seaside Provisions', place: 'Fort Kochi', type: 'general', category: 'General Store' },
  { id: 'sb_quiet_2', name: 'Kaloor Corner Mart', place: 'Kaloor', type: 'general', category: 'General Store' },
  { id: 'sb_quiet_3', name: 'Vyttila Junction Medicals', place: 'Vyttila', type: 'pharmacy', category: 'Pharma' },
  { id: 'sb_quiet_4', name: 'Kakkanad Daily Needs', place: 'Kakkanad', type: 'general', category: 'General Store' },
  { id: 'sb_quiet_5', name: 'Thrikkakara Stores', place: 'Kakkanad', type: 'general', category: 'General Store' },
]
/**
 * Three more beats each, across the rest of Kochi, so Beat coverage is a long
 * list worth filtering — by person, by area — the way a real network is.
 *
 * Each beat has six to nine shops; the last one to three are never visited, so
 * every beat has a gap of its own size. Names are made up from the area so they
 * read plausibly and never collide.
 */
const EXTRA_BEATS = {
  rep: [
    { id: 'route_x_thevara', name: 'Thevara Loop', places: ['Thevara'], shops: 7, quiet: 2 },
    { id: 'route_x_panampilly', name: 'Panampilly Nagar', places: ['Panampilly Nagar'], shops: 8, quiet: 1 },
    { id: 'route_x_vypin', name: 'Vypin Island', places: ['Vypin'], shops: 6, quiet: 3 },
  ],
  rep2: [
    { id: 'route_x_kadavanthra', name: 'Kadavanthra', places: ['Kadavanthra'], shops: 9, quiet: 2 },
    { id: 'route_x_maradu', name: 'Maradu & Kundannoor', places: ['Maradu'], shops: 7, quiet: 1 },
    { id: 'route_x_tripunithura', name: 'Tripunithura Town', places: ['Tripunithura'], shops: 8, quiet: 3 },
  ],
  rep3: [
    { id: 'route_x_aluva', name: 'Aluva Market', places: ['Aluva'], shops: 9, quiet: 2 },
    { id: 'route_x_kalamassery', name: 'Kalamassery', places: ['Kalamassery'], shops: 7, quiet: 2 },
    { id: 'route_x_palarivattom', name: 'Palarivattom', places: ['Palarivattom'], shops: 6, quiet: 1 },
  ],
}
const KINDS = [
  ['general', 'General Store', 'Stores'], ['pharmacy', 'Pharma', 'Medicals'],
  ['grocery', 'Supermarket', 'Mart'], ['general', 'General Store', 'Baby Shop'],
]
for (const beats of Object.values(EXTRA_BEATS)) {
  for (const b of beats) {
    b.all = []
    for (let k = 0; k < b.shops; k++) {
      const [type, category, word] = KINDS[k % KINDS.length]
      const id = `${b.id.replace('route_x_', 'sb_x_')}_${k + 1}`
      SHOPS.push({ id, name: `${b.places[0]} ${word} ${k + 1}`, place: b.places[0], type, category })
      b.all.push(id)
    }
    b.visit = b.all.slice(0, b.shops - b.quiet)
  }
}
// One place typed the way people type: lower case, a trailing space. The
// report must count it as the Kadavanthra it is, not as a second place.
SHOPS.find(x => x.id === 'sb_x_kadavanthra_2').place = 'kadavanthra '

const SEEDED = {
  party_shop: { name: 'Anand Stores', type: 'general' },
  party_pharmacy: { name: 'Guardian Pharmacy', type: 'pharmacy' },
  party_dist: { name: 'Rajan Distributors', type: 'distributor' },
}
const outlet = (id) => {
  const s = SHOPS.find(x => x.id === id)
  return s ? { id, name: s.name, type: s.type } : { id, ...SEEDED[id] }
}

const PRODUCTS = {
  prod_wipes: { name: 'Baby Wet Wipes 72s', price: 60, perCarton: 24, step: 12 },
  prod_mini: { name: 'Baby Wet Wipes 30s', price: 30, perCarton: 48, step: 16 },
}

/**
 * Three people, three beats, a month of each.
 *
 * Each has a shape rather than a script: Ravi sells big and unevenly, Priya
 * steadily and smaller, Arjun is newer and patchy. `pace` is roughly the
 * packets a good day brings, and `wipesShare` how much of it is the 72s —
 * different mixes are what make the product filter reorder the graph rather
 * than shrink every bar by the same amount.
 *
 * Generated from a fixed seed per person, so every reseed brings back the same
 * month: a figure somebody is puzzled by is still there when they look again.
 */
const PEOPLE = [
  {
    key: 'rep', user: USERS.rep, seed: 11, pace: 44, wipesShare: 0.65, odoFrom: 36500,
    route: { id: 'route_demo', name: 'Beach Road', places: ['Kochi', 'Fort Kochi', 'Mattancherry'] },
    outlets: ['party_shop', 'party_pharmacy', 'sb_fort_1', 'sb_matt_1'],
    quiet: ['sb_quiet_1'],
    // Kept from the hand-made week this replaced, so those states stay findable.
    force: { 2: 'absent', 4: 'nothing' },
  },
  {
    key: 'rep2', user: USERS.rep2, seed: 23, pace: 26, wipesShare: 0.4, odoFrom: 18000,
    route: { id: 'route_market', name: 'Market Road', places: ['Ernakulam', 'Kaloor', 'Vyttila'] },
    outlets: ['party_dist', 'sb_kaloor_1', 'sb_vytt_1', 'sb_vytt_2'],
    quiet: ['sb_quiet_2', 'sb_quiet_3'],
    force: { 1: 'absent' },
  },
  {
    key: 'rep3', user: ARJUN, seed: 37, pace: 32, wipesShare: 0.55, odoFrom: 7200,
    route: { id: 'route_hill', name: 'Hill Road', places: ['Kakkanad', 'Edappally'] },
    outlets: ['sb_kakk_1', 'sb_edap_1', 'sb_edap_2'],
    quiet: ['sb_quiet_4', 'sb_quiet_5'],
    force: { 3: 'absent', 6: 'nothing' },
  },
]
/**
 * Four months of history. A month against the one before needs both to be
 * whole, and a growth rate needs several months of them — thirty days made
 * every comparison read "up 1300%" because the earlier period was nearly empty.
 */
const DAYS_BACK = 120

/** Each person's beats: their own round first, then the three more. */
const beatsOf = (p) => [
  { id: p.route.id, name: p.route.name, visit: p.outlets },
  ...EXTRA_BEATS[p.key].map(b => ({ id: b.id, name: b.name, visit: b.visit })),
]

/**
 * Leave as the app writes it. `auto` is the missed-punch-in sweep's record —
 * marked by the system, appealable; otherwise a manager approved it.
 */
function leaveDoc(u, date, leaveType, { auto, status = 'active', reason, appeal } = {}) {
  const at0 = new Date(`${date}T${leaveType === 'half_day' ? '10:00' : '14:00'}:00`).getTime()
  return {
    uid: u.uid, name: u.name, role: u.role, date, leaveType,
    ...(reason ? { reason } : {}),
    markedAt: at0,
    markedBy: auto ? 'system' : USERS.manager.uid,
    markedByName: auto ? 'Automatic' : USERS.manager.name,
    status,
    ...(auto ? { autoMarked: true } : {}),
    ...(appeal ? { unmarkReason: appeal, unmarkRequestedAt: at0 + 3600_000 } : {}),
    auditLog: [{ action: auto ? 'admin_marked' : 'leave_approved', by: auto ? 'system' : USERS.manager.uid,
                 byName: auto ? 'Automatic' : USERS.manager.name, at: at0 }],
  }
}

/** A small deterministic generator: the same seed, the same month. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const weekStartOf = (date) => {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const plusDays = (date, n) => {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Working days of a month, divided per product the way the planner's button does it. */
function monthTarget(u, month, byProduct, extra = {}) {
  const [y, m] = month.split('-').map(Number)
  const workable = []
  for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`
    if (!isDayOff(date)) workable.push(date)
  }
  const daysByProduct = divideByProductAcrossDays(byProduct, workable)
  return {
    uid: u.uid, name: u.name, month,
    units: Object.values(byProduct).reduce((a, b) => a + b, 0),
    byProduct, daysByProduct, days: dayTotalsFromProducts(daysByProduct),
    setBy: USERS.manager.uid, setByName: USERS.manager.name, setAt: Date.now(),
    ...extra,
  }
}

async function recentMonth() {
  const db = getFirestore()

  // ── the third officer, and a super admin ──────────────────────────────────
  for (const u of [ARJUN, SUPER]) {
    await getAuth().createUser({
      uid: u.uid, email: u.email, password: PASSWORD, displayName: u.name,
      phoneNumber: `+91${u.phone}`,
    })
    await db.doc(`users/${u.uid}`).set({
      email: u.email, name: u.name, phone: `+91${u.phone}`,
      role: u.role, status: 'approved', createdAt: Date.now(),
    })
  }

  // ── shops, in their places ────────────────────────────────────────────────
  for (const s of SHOPS) {
    await db.doc(`parties/${s.id}`).set({
      name: s.name, type: 'retailer', category: s.category, outletType: s.type,
      phone: `90000001${String(SHOPS.indexOf(s)).padStart(2, '0')}`,
      address: `${s.place} Main Road`, place: s.place,
      district: 'Ernakulam', state: 'Kerala', pincode: '682001',
      pricePerPacket: 0, packetsAllocated: 0, cartonsAllocated: 0, lowStockThreshold: 0,
      status: 'active',
      underDistributorId: 'party_dist', underDistributorName: 'Rajan Distributors',
      addedBy: USERS.admin.uid, addedByName: USERS.admin.name, createdAt: Date.now(),
    })
  }
  // The seeded shops get places of their own too, so Ravi's area is not just "Kochi".
  await db.doc('parties/party_pharmacy').set({ place: 'Fort Kochi', status: 'active' }, { merge: true })
  await db.doc('parties/party_dist').set({ place: 'Ernakulam' }, { merge: true })

  // ── beats ─────────────────────────────────────────────────────────────────
  for (const p of PEOPLE) {
    await db.doc(`sales_routes/${p.route.id}`).set({
      name: p.route.name,
      description: `${p.user.name.split(' ')[0]}'s round.`,
      places: p.route.places,
      outletIds: [...p.outlets, ...p.quiet],
      defaultTargets: { visits: 10, orderValue: 40000 },
      active: true,
      createdBy: USERS.manager.uid, createdByName: USERS.manager.name, createdAt: Date.now(),
    }, { merge: true })
    for (const b of EXTRA_BEATS[p.key]) {
      await db.doc(`sales_routes/${b.id}`).set({
        name: b.name, description: `One of ${p.user.name.split(' ')[0]}'s other rounds.`,
        places: b.places, outletIds: b.all,
        defaultTargets: { visits: 10, orderValue: 40000 },
        active: true,
        createdBy: USERS.manager.uid, createdByName: USERS.manager.name, createdAt: Date.now(),
      })
    }
  }

  // ── targets: last month for everyone, this month for Arjun ────────────────
  // Ravi's and Priya's current month are set above, with today's figures in.
  const thisMonth = todayLocal().slice(0, 7)
  const lastMonth = (() => {
    const [y, m] = thisMonth.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })()
  await db.doc(`sales_targets/${USERS.rep.uid}_${lastMonth}`)
    .set(monthTarget(USERS.rep, lastMonth, { prod_wipes: 650, prod_mini: 350 }))
  await db.doc(`sales_targets/${USERS.rep2.uid}_${lastMonth}`)
    .set(monthTarget(USERS.rep2, lastMonth, { prod_wipes: 250, prod_mini: 350 }))
  await db.doc(`sales_targets/${ARJUN.uid}_${lastMonth}`)
    .set(monthTarget(ARJUN, lastMonth, { prod_wipes: 450, prod_mini: 300 }))
  await db.doc(`sales_targets/${ARJUN.uid}_${thisMonth}`)
    .set(monthTarget(ARJUN, thisMonth, { prod_wipes: 500, prod_mini: 350 }))

  // ── the month itself ──────────────────────────────────────────────────────
  const cfg = { hq: 200, ex: 300, os: 450, ratePerKm: 4.5 }
  const thisWeek = weekStartOf(todayLocal())

  // The three people at once: each has its own generator and its own records,
  // so nothing one writes depends on another, and four months take a third the time.
  await Promise.all(PEOPLE.map(async p => {
    const u = p.user
    const r = rng(p.seed)
    let odo = p.odoFrom
    const reports = new Map()   // weekStart → { id, total }
    let orders = 0, wipesOrders = 0

    // The sandbox's "Working day" switch lands on the latest working day. For
    // Ravi that day is worked and left unclaimed, so the end-of-day card has
    // something to offer when you look.
    let latestWork = 1
    while (isDayOff(dayBack(latestWork))) latestWork++
    const fresh = (back) => u.uid === USERS.rep.uid && back === latestWork
    // And the working day before that, Ravi was marked absent and is appealing
    // it — so the appeal has a day to sit on whatever weekday the sandbox starts.
    let appealDay = latestWork + 1
    while (isDayOff(dayBack(appealDay))) appealDay++
    const appealed = (back) => u.uid === USERS.rep.uid && back === appealDay

    for (let back = DAYS_BACK; back >= 1; back--) {
      const date = dayBack(back)
      if (isDayOff(date)) continue

      // What kind of day: mostly worked, now and then not started, now and
      // then out all day and nothing sold.
      const roll = r()
      const kind = fresh(back) ? 'sold' : appealed(back) ? 'absent'
        : p.force[back] ?? (roll < 0.07 ? 'absent' : roll < 0.15 ? 'nothing' : 'sold')
      // A day nobody started is what the sweep marks absent. The first one
      // in each person's history was booked leave instead — approved by the
      // manager — and Ravi's forced absence is under appeal.
      if (kind === 'absent') {
        const first = !p.hadLeave
        p.hadLeave = true
        const appeal = appealed(back)
        await db.doc(`leave_records/sb_${u.uid}_${date}`).set(first && !appeal
          ? leaveDoc(u, date, 'full_day', { auto: false, reason: 'Family' })
          : leaveDoc(u, date, 'full_day', {
              auto: true,
              ...(appeal ? { status: 'unmark_requested', appeal: 'Phone died at the depot — I was on the round.' } : {}),
            }))
        continue
      }

      // Now and then a late start: past the morning cutoff, so the sweep marked
      // half a day before the rep punched in at one.
      const late = !fresh(back) && r() < 0.06

      // Their own round on most days, one of their other three on the rest.
      // The forced days keep the main round, so the states they set up hold.
      const mine = beatsOf(p)
      const beat = fresh(back) || p.force[back] || r() < 0.55
        ? mine[0] : mine[1 + Math.floor(r() * 3)]

      const km = 18 + Math.round(r() * 60)
      const sessionId = `demo_${u.uid}_${date}`
      const start = odo
      odo += km
      await db.doc(`duty_sessions/${sessionId}`).set({
        uid: u.uid, name: u.name, date,
        routeId: beat.id, routeName: beat.name,
        startAt: late ? at(date, 13, 5) : at(date, 9, 10),
        startLocation: fix(DEPOT, late ? at(date, 13, 5) : at(date, 9, 10)),
        startOdometerKm: start, odometerStatus: 'recorded',
        startOdometerPhoto: 'demo/odometer.jpg', startOdometerPhotoVerified: false,
        endAt: at(date, 17, 40), endLocation: fix(DEPOT, at(date, 17, 40)),
        endOdometerKm: odo, endOdometerPhoto: 'demo/odometer.jpg',
        claimedDistanceKm: km, status: 'closed',
      })
      if (late) await db.doc(`leave_records/sb_${u.uid}_${date}`).set(leaveDoc(u, date, 'half_day', { auto: true }))
      await db.doc(`work_plans/${u.uid}_${date}`).set({
        uid: u.uid, name: u.name, date,
        routeId: beat.id, routeName: beat.name,
        targets: { visits: 10, orderValue: 40000 },
        assignedBy: USERS.manager.uid, assignedByName: USERS.manager.name,
        createdAt: at(date, 8, 0),
      })

      // Visits, and the orders that came out of some of them.
      const shops = 2 + Math.floor(r() * 4)
      const sellingTo = kind === 'sold' ? 1 + Math.floor(r() * Math.min(3, shops)) : 0
      const offset = Math.floor(r() * beat.visit.length)
      for (let i = 0; i < shops; i++) {
        const o = outlet(beat.visit[(offset + i) % beat.visit.length])
        const hour = 10 + Math.floor(i * 1.5)
        const sold = i < sellingTo
        const mins = 12 + Math.floor(r() * 30)
        await db.doc(`outlet_visits/${sessionId}_${i}`).set({
          sessionId, uid: u.uid, name: u.name, role: u.role, date,
          partyId: o.id, partyName: o.name, outletType: o.type,
          punchInAt: at(date, hour, (i * 20) % 60),
          punchInLocation: fix(STOPS[(offset + i) % STOPS.length], at(date, hour)),
          punchOutAt: at(date, hour, (i * 20) % 60) + mins * 60_000,
          durationMinutes: mins,
          stock: [], competitors: [], photos: [],
          orderPlaced: sold,
          remarksCategory: sold ? 'order_booked' : 'no_order_stock_available',
          remarksText: sold ? 'Took stock for the week.' : 'Shelf still full from the last drop.',
          status: 'closed',
        })

        if (sold) {
          // A day's pace spread over its orders, in each product's own steps.
          // The mix kept to the person's share rather than left to the dice,
          // which can deal one product a month of nothing.
          const pid = wipesOrders < p.wipesShare * (orders + 1) ? 'prod_wipes' : 'prod_mini'
          orders++
          if (pid === 'prod_wipes') wipesOrders++
          const pr = PRODUCTS[pid]
          // Selling builds over the four months — from about 70% of the
          // person's pace to about 130% — so month on month there is growth
          // to measure, as there would be in a business that is going well.
          const ramp = 0.7 + 0.6 * (1 - back / DAYS_BACK)
          const want = (p.pace * ramp / sellingTo) * (0.5 + r())
          const packets = Math.max(pr.step, Math.round(want / pr.step) * pr.step)
          const total = packets * pr.price
          const partyType = o.type === 'distributor' ? 'distributor' : 'retailer'
          const allocId = await companyAllocation({
            createdBy: u.uid, createdByName: u.name,
            createdAt: at(date, hour, 30),
            partyId: o.id, partyName: o.name, partyType,
            productId: pid, productName: pr.name,
            packets, cartons: Math.max(1, Math.round(packets / pr.perCarton)),
            pricePerPacket: pr.price, totalAmount: total,
            status: 'sent', sentAt: at(date, 15, 0), sentDate: date,
            month: date.slice(0, 7),
          })
          // The visit names the order it produced, as the outlet screen does —
          // what "visits where this product was ordered" is read from.
          await db.doc(`outlet_visits/${sessionId}_${i}`).update({ allocationIds: [allocId] })

          // Most bills are collected a week or so later, by the rep, the way
          // the outlet screen records it: the payment applied to the bill, the
          // bill marked paid. Older ones are approved; the last fortnight's are
          // still waiting on an admin. Some stay unpaid, so the credit book has
          // money outstanding.
          const payBack = back - (5 + Math.floor(r() * 6))
          if (payBack >= 1 && r() < 0.75) {
            const payDate = dayBack(payBack)
            const approved = payBack > 14
            await db.collection('payment_transactions').add({
              partyId: o.id, partyName: o.name, partyType,
              amount: total, paymentMethod: r() < 0.6 ? 'cash' : 'upi',
              collectionType: 'collected_by_salesperson',
              collectedBy: u.uid, collectedByName: u.name,
              notes: '', date: payDate, createdAt: at(payDate, 13, 0),
              appliedTo: [{ allocId, amount: total }],
              ...(approved
                ? { status: 'approved', approvedBy: USERS.admin.uid, approvedByName: USERS.admin.name,
                    approvedAt: at(payDate, 18, 0) }
                : { status: 'pending_approval' }),
            })
            await db.doc(`allocations_v2/${allocId}`).update({
              paidAmount: total, status: 'paid', paidAt: at(payDate, 13, 0),
            })
          }
        }
      }

      // Expenses on most worked days. The allowance follows the meter, fuel is
      // the meter's distance — except one of Ravi's, claimed above it with a
      // reason, which is the line the monitor calls out.
      if (r() < 0.8 && !fresh(back)) {
        const ws = weekStartOf(date)
        if (!reports.has(ws)) {
          const ref = db.collection('expense_reports').doc()
          const done = ws !== thisWeek
          await ref.set({
            userId: u.uid, userName: u.name, userRole: u.role,
            weekStart: ws, weekEnd: plusDays(ws, 6),
            // Weeks gone by are handed in; this one is still being filled.
            status: done ? 'submitted' : 'draft',
            ...(done ? { submittedAt: at(plusDays(ws, 6), 19, 0) } : {}),
            totalAmount: 0, createdAt: at(ws, 9, 0),
          })
          reports.set(ws, { id: ref.id, total: 0 })
        }
        const rep = reports.get(ws)
        const band = km <= 25 ? 'HQ' : km <= 70 ? 'EX' : 'OS'
        const allowance = cfg[band.toLowerCase()]
        const above = u.uid === USERS.rep.uid && back === 3
        const fuelKm = above ? km + 15 : km
        const fuel = Math.round(fuelKm * cfg.ratePerKm * 100) / 100
        await db.collection('expense_entries').add({
          reportId: rep.id, userId: u.uid, date, type: 'allowance', allowanceType: band,
          amount: allowance, allowanceFromKm: km, allowanceSuggested: band, createdAt: at(date, 18, 0),
        })
        await db.collection('expense_entries').add({
          reportId: rep.id, userId: u.uid, date, type: 'variable', category: 'fuel',
          amount: fuel, autoCalculated: true, distanceKm: fuelKm, ratePerKm: cfg.ratePerKm, meterKm: km,
          ...(above ? { aboveMeterReason: 'Meter reset at the garage at noon' } : {}),
          createdAt: at(date, 18, 1),
        })
        let total = allowance + fuel
        if (r() < 0.25) {
          const food = 80 + Math.round(r() * 8) * 10
          await db.collection('expense_entries').add({
            reportId: rep.id, userId: u.uid, date, type: 'variable', category: 'food',
            amount: food, notes: 'Lunch on the round', createdAt: at(date, 18, 2),
          })
          total += food
        }
        rep.total += total
      }
    }

    for (const rep of reports.values()) {
      await db.doc(`expense_reports/${rep.id}`).update({ totalAmount: Math.round(rep.total * 100) / 100 })
    }
  }))

  // One cancelled order, so the line that says cancellations are not counted
  // has something to not count.
  await companyAllocation({
    createdAt: at(dayBack(3), 12, 0),
    status: 'cancelled',
    month: dayBack(3).slice(0, 7),
  })
}

const PAD = Math.max(...Object.keys(USERS).map(k => k.length))

/**
 * A week of what the managers did, so Monitor managers has something to read
 * and to download. Meetings, a day out with a rep, office days — the three
 * kinds the log takes — spread over two managers, a few days back.
 */
async function managerWeek() {
  const db = getFirestore()
  const m1 = USERS.manager, m2 = USERS.managerPlus
  const ENTRIES = [
    { back: 6, who: m1, kind: 'meeting', title: 'Monday team review', with: [USERS.rep, USERS.rep2, ARJUN], minutes: 45,
      notes: 'Agreed the Onam scheme targets. Ravi to chase Anand Stores.' },
    { back: 5, who: m1, kind: 'joint_field', title: 'Out with Priya on Market Road', with: [USERS.rep2], minutes: 240,
      notes: 'Two new pharmacies interested. Kaloor Baby Store wants a better margin.' },
    { back: 5, who: m2, kind: 'office', title: 'Month-end stock reconciliation', minutes: 180 },
    { back: 4, who: m2, kind: 'meeting', title: 'Rajan Distributors — credit terms', party: { id: 'party_dist', name: 'Rajan Distributors' },
      minutes: 60, notes: 'They asked for 30 days. Said we would come back by Friday.' },
    { back: 3, who: m1, kind: 'joint_field', title: 'Out with Arjun, Hill Road', with: [ARJUN], minutes: 300,
      notes: 'Coached on the order pitch at Infopark Mart.' },
    { back: 2, who: m2, kind: 'office', title: 'Planning next week\'s beats' },
    { back: 1, who: m1, kind: 'meeting', title: 'Call with the Fort Kochi supermarket', party: { id: 'sb_fort_1', name: 'Fort Supermart' },
      minutes: 30 },
  ]
  for (const [i, e] of ENTRIES.entries()) {
    const date = dayBack(e.back)
    await db.doc(`manager_activities/sandbox_${i}`).set({
      uid: e.who.uid, name: e.who.name, date, kind: e.kind, title: e.title,
      // Always written, empty included — the rules read it on every entry.
      withUids: (e.with ?? []).map(u => u.uid),
      withNames: (e.with ?? []).map(u => u.name),
      ...(e.party ? { partyId: e.party.id, partyName: e.party.name } : {}),
      ...(e.minutes ? { minutes: e.minutes } : {}),
      ...(e.notes ? { notes: e.notes } : {}),
      createdAt: at(date, 18, i),
    })
  }
}

/**
 * Arjun's latest working day, left open and closed by the nightly job — the
 * day a rep forgets to end. Started with a reading, never given a closing one,
 * ended at 11:59 pm by the system, no distance claimed.
 */
async function autoClosedDay() {
  const db = getFirestore()
  // A leave Arjun has asked for next week, not yet approved.
  let ahead = 7
  while (isDayOff(dayAhead(ahead))) ahead++
  await db.doc(`leave_records/sb_${ARJUN.uid}_request`).set(
    leaveDoc(ARJUN, dayAhead(ahead), 'full_day', { auto: false, status: 'pending_approval', reason: 'Personal' }))
  let back = 1
  while (isDayOff(dayBack(back))) back++
  const date = dayBack(back)
  await db.doc(`duty_sessions/demo_${ARJUN.uid}_${date}`).set({
    uid: ARJUN.uid, name: ARJUN.name, date,
    routeId: 'route_hill', routeName: 'Hill Road',
    startAt: at(date, 9, 40), startLocation: fix(DEPOT, at(date, 9, 40)),
    startOdometerKm: 9900, odometerStatus: 'recorded',
    startOdometerPhoto: 'demo/odometer.jpg', startOdometerPhotoVerified: false,
    endAt: at(date, 23, 59), autoClosed: true, autoClosedAt: at(date, 23, 59),
    status: 'closed',
  })
}

async function main() {
  console.log(`\n  Rebuilding the ${PROJECT_ID} world…`)
  await resetWorld()
  await seedWorld()
  await sandboxExtras()
  await recentMonth()
  await autoClosedDay()
  await managerWeek()
  await closeAdmin()

  console.log('\n  Signed-out and ready. Every account uses the same password.\n')
  for (const [key, u] of Object.entries(USERS)) {
    console.log(`    ${key.padEnd(PAD)}  ${u.email.padEnd(24)} ${u.phone}  ${u.role}`)
  }
  console.log(`    ${'rep3'.padEnd(PAD)}  ${ARJUN.email.padEnd(24)} ${ARJUN.phone}  ${ARJUN.role}  (sandbox only)`)
  console.log(`    ${'super'.padEnd(PAD)}  ${SUPER.email.padEnd(24)} ${SUPER.phone}  ${SUPER.role}  (sandbox only)`)
  console.log(`\n    password  ${PASSWORD}`)
  console.log('\n  Either the email or the mobile number signs them in.')
  console.log('\n  App: http://127.0.0.1:5174')
  console.log('\n  Fuel rate is ₹4.50/km, so fuel is claimed as a distance.')
  console.log('  Three reps (Ravi, Priya, Arjun) on three beats, with the last 30 days')
  console.log('  worked: visits in different areas, orders in both products, targets for')
  console.log('  this month and last, expenses on most days. Reports, then Monitor reps:')
  console.log('  End of day, or Report for the graph.')
  console.log('  Re-seed at any time without restarting: npm run sandbox:reseed\n')
}

main().catch(err => {
  console.error('\n  Could not build the sandbox world.')
  console.error('  Are the emulators up? This script expects to run inside')
  console.error('  `firebase emulators:exec` — use `npm run sandbox`.\n')
  console.error(err)
  process.exit(1)
})
