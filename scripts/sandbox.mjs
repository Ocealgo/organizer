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
import {
  resetWorld, seedWorld, closeAdmin, USERS, PASSWORD, PROJECT_ID,
  companyStock, companyAllocation, assignedDay, todayLocal,
} from '../tests/e2e/fixtures/seed.ts'
import { divideAcrossDays } from '../src/types.ts'

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
    if (new Date(date + 'T00:00:00').getDay() === 0) continue
    workable.push(date)
  }

  await db.doc(`sales_targets/${USERS.rep.uid}_${month}`).set({
    uid: USERS.rep.uid,
    name: USERS.rep.name,
    month,
    units: 1000,
    days: divideAcrossDays(1000, workable),
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
    days: divideAcrossDays(600, workable),
    setBy: USERS.manager.uid,
    setByName: USERS.manager.name,
    setAt: Date.now(),
  })

  // One order already placed, so both lines open on something other than zero
  // and cancelling it is one tap from showing what that does.
  await companyAllocation()
}

/**
 * A week behind us, with days that landed and days that did not.
 *
 * The sandbox was a world with one order in it, which is enough to see a
 * screen and not enough to see a report. A range only means something over
 * several days, and a met/missed filter only means something when both exist —
 * so the week is deliberately mixed rather than uniformly good.
 *
 * Shaped, not random. A fixed pattern per weekday means the same sandbox comes
 * back every time it is reseeded, so a number somebody is puzzled by is still
 * there when they go to look at it again.
 */
async function recentWeek() {
  const db = getFirestore()

  /** Parties to visit, with the type each one reports as. */
  const OUTLETS = [
    { id: 'party_shop', name: 'Anand Stores', type: 'general' },
    { id: 'party_pharmacy', name: 'Guardian Pharmacy', type: 'pharmacy' },
    { id: 'party_dist', name: 'Rajan Distributors', type: 'distributor' },
  ]

  /**
   * What each of the last days looked like, oldest first.
   *
   * `packets` against a divided target of about 37 is what decides the flag, so
   * the week carries two comfortable days, two short ones, a blank and a day
   * nobody started — which is every state the monitor can draw.
   */
  const SHAPE = [
    { back: 7, shops: 3, packets: 48, km: 62 },
    { back: 6, shops: 2, packets: 24, km: 41 },   // short
    { back: 5, shops: 4, packets: 72, km: 88 },
    { back: 4, shops: 1, packets: 0, km: 23 },    // out, sold nothing
    { back: 3, shops: 3, packets: 48, km: 55 },
    { back: 2, shops: 0, packets: 0, km: null },  // never started
    { back: 1, shops: 2, packets: 24, km: 37 },   // short
  ]

  const dayBack = (n) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  /** A timestamp at a given hour on a given day, so the day it lands on is the day meant. */
  const at = (date, hour, min = 0) =>
    new Date(`${date}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`).getTime()

  let odo = 41200

  for (const spec of SHAPE) {
    const date = dayBack(spec.back)
    // A Sunday is a day off, and inventing work on one would contradict every
    // other screen — the monitor hides it, the planner refuses to target it.
    if (new Date(date + 'T00:00:00').getDay() === 0) continue

    const u = USERS.rep
    const sessionId = `demo_${u.uid}_${date}`

    if (spec.km !== null) {
      const start = odo
      odo += spec.km
      await db.doc(`duty_sessions/${sessionId}`).set({
        uid: u.uid, name: u.name, date,
        routeId: 'route_demo', routeName: 'Beach Road',
        startAt: at(date, 9, 10),
        startOdometerKm: start,
        odometerStatus: 'recorded',
        startOdometerPhoto: 'demo/odometer.jpg',
        startOdometerPhotoVerified: false,
        endAt: at(date, 17, 40),
        endOdometerKm: odo,
        endOdometerPhoto: 'demo/odometer.jpg',
        claimedDistanceKm: spec.km,
        status: 'closed',
      })

      // The beat was assigned for the day, which is what puts a route on the
      // card. Targets are not copied here — those live on the rep's month.
      await db.doc(`work_plans/${u.uid}_${date}`).set({
        uid: u.uid, name: u.name, date,
        routeId: 'route_demo', routeName: 'Beach Road',
        targets: { visits: 12, orderValue: 50000 },
        assignedBy: USERS.manager.uid,
        assignedByName: USERS.manager.name,
        createdAt: at(date, 8, 0),
      })
    }

    for (let i = 0; i < spec.shops; i++) {
      const o = OUTLETS[i % OUTLETS.length]
      const hour = 10 + i * 2
      await db.doc(`outlet_visits/${sessionId}_${i}`).set({
        sessionId, uid: u.uid, name: u.name, role: u.role, date,
        partyId: o.id, partyName: o.name, outletType: o.type,
        punchInAt: at(date, hour),
        punchOutAt: at(date, hour, 24),
        durationMinutes: 24,
        stock: [], competitors: [], photos: [],
        orderPlaced: spec.packets > 0 && i === 0,
        remarksCategory: spec.packets > 0 && i === 0 ? 'order_booked' : 'no_order_stock_available',
        remarksText: spec.packets > 0 && i === 0
          ? 'Took a carton for the festival week.'
          : 'Shelf still full from the last drop.',
        status: 'closed',
      })
    }

    if (spec.packets > 0) {
      // Through the shared helper, so a demo order is the same document an
      // order raised in the app would be — and counts the same everywhere.
      await companyAllocation({
        createdAt: at(date, 11, 30),
        packets: spec.packets,
        cartons: Math.round(spec.packets / 24),
        totalAmount: spec.packets * 60,
        status: 'sent',
        sentAt: at(date, 15, 0),
        sentDate: date,
        month: date.slice(0, 7),
      })
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
  await recentWeek()
  await closeAdmin()

  console.log('\n  Signed-out and ready. Every account uses the same password.\n')
  for (const [key, u] of Object.entries(USERS)) {
    console.log(`    ${key.padEnd(PAD)}  ${u.email.padEnd(24)} ${u.phone}  ${u.role}`)
  }
  console.log(`\n    password  ${PASSWORD}`)
  console.log('\n  Either the email or the mobile number signs them in.')
  console.log('\n  App: http://127.0.0.1:5174')
  console.log('\n  Fuel rate is ₹4.50/km, so fuel is claimed as a distance.')
  console.log('  Ravi Rep has a 1000-packet month divided across its working days and')
  console.log('  a worked week behind him: days that met the target, days that fell')
  console.log('  short, a blank one and one he never started. Reports \u2192 Monitor reps.')
  console.log('  Re-seed at any time without restarting: npm run sandbox:reseed\n')
}

main().catch(err => {
  console.error('\n  Could not build the sandbox world.')
  console.error('  Are the emulators up? This script expects to run inside')
  console.error('  `firebase emulators:exec` — use `npm run sandbox`.\n')
  console.error(err)
  process.exit(1)
})
