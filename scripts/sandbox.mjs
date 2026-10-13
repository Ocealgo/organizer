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
 */
import { getFirestore } from 'firebase-admin/firestore'
import {
  resetWorld, seedWorld, closeAdmin, USERS, PASSWORD, PROJECT_ID,
} from '../tests/e2e/fixtures/seed.ts'

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
}

const PAD = Math.max(...Object.keys(USERS).map(k => k.length))

async function main() {
  console.log(`\n  Rebuilding the ${PROJECT_ID} world…`)
  await resetWorld()
  await seedWorld()
  await sandboxExtras()
  await closeAdmin()

  console.log('\n  Signed-out and ready. Every account uses the same password.\n')
  for (const [key, u] of Object.entries(USERS)) {
    console.log(`    ${key.padEnd(PAD)}  ${u.email.padEnd(24)} ${u.phone}  ${u.role}`)
  }
  console.log(`\n    password  ${PASSWORD}`)
  console.log('\n  Either the email or the mobile number signs them in.')
  console.log('  Fuel rate is set to ₹4.50/km, so fuel is claimed as a distance.')
  console.log('  Re-seed at any time without restarting: npm run sandbox:reseed\n')
}

main().catch(err => {
  console.error('\n  Could not build the sandbox world.')
  console.error('  Are the emulators up? This script expects to run inside')
  console.error('  `firebase emulators:exec` — use `npm run sandbox`.\n')
  console.error(err)
  process.exit(1)
})
