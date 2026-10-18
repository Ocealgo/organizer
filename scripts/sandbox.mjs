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

/** Shops on each beat, in their own areas, so the Area column has places to name. */
const SHOPS = [
  { id: 'sb_fort_1', name: 'Fort Supermart', place: 'Fort Kochi', type: 'supermarket', category: 'Supermarket' },
  { id: 'sb_matt_1', name: 'Mattancherry Medicals', place: 'Mattancherry', type: 'pharmacy', category: 'Pharma' },
  { id: 'sb_kaloor_1', name: 'Kaloor Baby Store', place: 'Kaloor', type: 'general', category: 'General Store' },
  { id: 'sb_vytt_1', name: 'Vyttila Fresh', place: 'Vyttila', type: 'supermarket', category: 'Supermarket' },
  { id: 'sb_vytt_2', name: 'Hub Pharmacy', place: 'Vyttila', type: 'pharmacy', category: 'Pharma' },
  { id: 'sb_kakk_1', name: 'Infopark Mart', place: 'Kakkanad', type: 'supermarket', category: 'Supermarket' },
  { id: 'sb_edap_1', name: 'Lulu Kids Corner', place: 'Edappally', type: 'general', category: 'General Store' },
  { id: 'sb_edap_2', name: 'Edappally Care Pharmacy', place: 'Edappally', type: 'pharmacy', category: 'Pharma' },
]
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
    user: USERS.rep, seed: 11, pace: 44, wipesShare: 0.65, odoFrom: 40500,
    route: { id: 'route_demo', name: 'Beach Road', places: ['Kochi', 'Fort Kochi', 'Mattancherry'] },
    outlets: ['party_shop', 'party_pharmacy', 'sb_fort_1', 'sb_matt_1'],
    // Kept from the hand-made week this replaced, so those states stay findable.
    force: { 2: 'absent', 4: 'nothing' },
  },
  {
    user: USERS.rep2, seed: 23, pace: 26, wipesShare: 0.4, odoFrom: 18000,
    route: { id: 'route_market', name: 'Market Road', places: ['Ernakulam', 'Kaloor', 'Vyttila'] },
    outlets: ['party_dist', 'sb_kaloor_1', 'sb_vytt_1', 'sb_vytt_2'],
    force: { 1: 'absent' },
  },
  {
    user: ARJUN, seed: 37, pace: 32, wipesShare: 0.55, odoFrom: 7200,
    route: { id: 'route_hill', name: 'Hill Road', places: ['Kakkanad', 'Edappally'] },
    outlets: ['sb_kakk_1', 'sb_edap_1', 'sb_edap_2'],
    force: { 3: 'absent', 6: 'nothing' },
  },
]
const DAYS_BACK = 30

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

  // ── the third officer ─────────────────────────────────────────────────────
  await getAuth().createUser({
    uid: ARJUN.uid, email: ARJUN.email, password: PASSWORD, displayName: ARJUN.name,
    phoneNumber: `+91${ARJUN.phone}`,
  })
  await db.doc(`users/${ARJUN.uid}`).set({
    email: ARJUN.email, name: ARJUN.name, phone: `+91${ARJUN.phone}`,
    role: ARJUN.role, status: 'approved', createdAt: Date.now(),
  })

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
      outletIds: p.outlets,
      defaultTargets: { visits: 10, orderValue: 40000 },
      active: true,
      createdBy: USERS.manager.uid, createdByName: USERS.manager.name, createdAt: Date.now(),
    }, { merge: true })
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

  for (const p of PEOPLE) {
    const u = p.user
    const r = rng(p.seed)
    let odo = p.odoFrom
    const reports = new Map()   // weekStart → { id, total }
    let orders = 0, wipesOrders = 0

    for (let back = DAYS_BACK; back >= 1; back--) {
      const date = dayBack(back)
      if (isDayOff(date)) continue

      // What kind of day: mostly worked, now and then not started, now and
      // then out all day and nothing sold.
      const roll = r()
      const kind = p.force[back] ?? (roll < 0.07 ? 'absent' : roll < 0.15 ? 'nothing' : 'sold')
      if (kind === 'absent') continue

      const km = 18 + Math.round(r() * 60)
      const sessionId = `demo_${u.uid}_${date}`
      const start = odo
      odo += km
      await db.doc(`duty_sessions/${sessionId}`).set({
        uid: u.uid, name: u.name, date,
        routeId: p.route.id, routeName: p.route.name,
        startAt: at(date, 9, 10), startLocation: fix(DEPOT, at(date, 9, 10)),
        startOdometerKm: start, odometerStatus: 'recorded',
        startOdometerPhoto: 'demo/odometer.jpg', startOdometerPhotoVerified: false,
        endAt: at(date, 17, 40), endLocation: fix(DEPOT, at(date, 17, 40)),
        endOdometerKm: odo, endOdometerPhoto: 'demo/odometer.jpg',
        claimedDistanceKm: km, status: 'closed',
      })
      await db.doc(`work_plans/${u.uid}_${date}`).set({
        uid: u.uid, name: u.name, date,
        routeId: p.route.id, routeName: p.route.name,
        targets: { visits: 10, orderValue: 40000 },
        assignedBy: USERS.manager.uid, assignedByName: USERS.manager.name,
        createdAt: at(date, 8, 0),
      })

      // Visits, and the orders that came out of some of them.
      const shops = 2 + Math.floor(r() * 4)
      const sellingTo = kind === 'sold' ? 1 + Math.floor(r() * Math.min(3, shops)) : 0
      const offset = Math.floor(r() * p.outlets.length)
      for (let i = 0; i < shops; i++) {
        const o = outlet(p.outlets[(offset + i) % p.outlets.length])
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
          const want = (p.pace / sellingTo) * (0.5 + r())
          const packets = Math.max(pr.step, Math.round(want / pr.step) * pr.step)
          await companyAllocation({
            createdBy: u.uid, createdByName: u.name,
            createdAt: at(date, hour, 30),
            partyId: o.id, partyName: o.name, partyType: o.type === 'distributor' ? 'distributor' : 'retailer',
            productId: pid, productName: pr.name,
            packets, cartons: Math.max(1, Math.round(packets / pr.perCarton)),
            pricePerPacket: pr.price, totalAmount: packets * pr.price,
            status: 'sent', sentAt: at(date, 15, 0), sentDate: date,
            month: date.slice(0, 7),
          })
        }
      }

      // Expenses on most worked days. The allowance follows the meter, fuel is
      // the meter's distance — except one of Ravi's, claimed above it with a
      // reason, which is the line the monitor calls out.
      if (r() < 0.8) {
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
  }

  // One cancelled order, so the line that says cancellations are not counted
  // has something to not count.
  await companyAllocation({
    createdAt: at(dayBack(3), 12, 0),
    status: 'cancelled',
    month: dayBack(3).slice(0, 7),
  })
}

const PAD = Math.max(...Object.keys(USERS).map(k => k.length))

async function main() {
  console.log(`\n  Rebuilding the ${PROJECT_ID} world…`)
  await resetWorld()
  await seedWorld()
  await sandboxExtras()
  await recentMonth()
  await closeAdmin()

  console.log('\n  Signed-out and ready. Every account uses the same password.\n')
  for (const [key, u] of Object.entries(USERS)) {
    console.log(`    ${key.padEnd(PAD)}  ${u.email.padEnd(24)} ${u.phone}  ${u.role}`)
  }
  console.log(`    ${'rep3'.padEnd(PAD)}  ${ARJUN.email.padEnd(24)} ${ARJUN.phone}  ${ARJUN.role}  (sandbox only)`)
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
