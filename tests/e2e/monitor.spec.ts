import { test, expect } from './fixtures/app'
import {
  companyAllocation, companyStock, noAllocations, noTargetsSet,
  packetTarget, todayLocal, closedDay, claimedExpense, noOneOnDuty, noWeeksFiled,
} from './fixtures/seed'

/**
 * The EOD card, and the one thing on it that is a judgement.
 *
 * Everything else the card shows is a fact copied from somewhere else. "Target
 * met" is the screen reaching a conclusion, so it is the part worth holding
 * down — including the case nobody set a target for, which must read as its
 * own answer rather than as a miss.
 */

test.beforeEach(async () => {
  await noTargetsSet()
  await noAllocations()
})

/**
 * Open it and point it at today, explicitly.
 *
 * The screen opens on the last day that could have been worked, which is not
 * today when today is a Sunday — right for a person and wrong for a spec that
 * seeded today. Setting the date says which day is under test instead of
 * inheriting whatever day the suite happens to run on.
 */
async function openMonitor(page: any) {
  await page.getByRole('button', { name: /^Reports/ }).first().click()
  await page.getByRole('button', { name: /^Monitor reps/ }).click()
  await expect(page.getByRole('heading', { name: 'Monitor reps' })).toBeVisible()
  await page.getByLabel('Day').fill(todayLocal())
}

test.describe('the end of a day', () => {
  test('a day that beat its target says so', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()                                   // 24 packets
    await packetTarget('rep', todayLocal().slice(0, 7), 1000, { [todayLocal()]: 20 })

    await loginAs('manager')
    await openMonitor(page)

    await expect(page.getByText('✓ Target met')).toBeVisible()
    // Label above figure, each in its own element — the card reads across now,
    // so the unit is no longer part of the same string as the number.
    await expect(page.getByText('Daily target')).toBeVisible()
    await expect(page.getByText('20', { exact: true })).toBeVisible()
    await expect(page.getByText('Order placed')).toBeVisible()
    await expect(page.getByText('24', { exact: true })).toBeVisible()
  })

  test('a day that fell short says that instead', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()                                   // 24 packets
    await packetTarget('rep', todayLocal().slice(0, 7), 1000, { [todayLocal()]: 80 })

    await loginAs('manager')
    await openMonitor(page)

    await expect(page.getByText('✗ Short')).toBeVisible()
    await expect(page.getByText('80', { exact: true })).toBeVisible()
  })

  /**
   * The case that must not read as a failure. Nobody set a figure, so there is
   * nothing to have missed — and a card that said "short" would be the screen
   * blaming a rep for an empty box in the planner.
   */
  test('a day with no target set is not a miss', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()

    await loginAs('manager')
    await openMonitor(page)

    // Nobody expected anything of this day, so it is a quiet one and hidden by
    // default. That is the right default and also why the toggle exists.
    await page.getByRole('button', { name: /Show days nothing happened on/ }).click()

    // Two officers are seeded and neither has a target, so both get a card —
    // hence `.first()`. Exact, because "No target set · 2" is the filter chip
    // and the footer mentions the phrase as well; only a card's own status
    // reads exactly this.
    await expect(page.getByText('No target', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Not set').first()).toBeVisible()

    // The assertion the test exists for: nothing was expected, so nothing can
    // have been missed, and no card may say otherwise.
    await expect(page.getByText('✗ Short')).toHaveCount(0)
  })

  /** Met and missed are countable, which is what the filter chips are for. */
  test('the chips filter down to the days that fell short', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()
    await packetTarget('rep', todayLocal().slice(0, 7), 1000, { [todayLocal()]: 80 })

    await loginAs('manager')
    await openMonitor(page)

    await expect(page.getByRole('button', { name: /^Missed · 1/ })).toBeVisible()
    await page.getByRole('button', { name: /^Met · 0/ }).click()
    await expect(page.getByText('No days to show')).toBeVisible()
  })

  /**
   * A day nobody punched in on is a different fact from a day that went badly,
   * and the card says which.
   */
  test('a day never started is called out', async ({ page, loginAs }) => {
    await packetTarget('rep', todayLocal().slice(0, 7), 1000, { [todayLocal()]: 80 })

    await loginAs('manager')
    await openMonitor(page)

    await expect(page.getByText('Never started the day.')).toBeVisible()
    await expect(page.getByText('No beat assigned')).toBeVisible()
  })

  test('a rep cannot open it', async ({ page, loginAs }) => {
    await loginAs('rep')
    await expect(page.getByRole('button', { name: /^Reports/ })).toHaveCount(0)
  })
})

/**
 * What the day took, under what it sold: the meter, the distance between
 * shops, and whether anything was claimed.
 */
test.describe('travel and spend on the card', () => {
  test.beforeEach(async () => {
    await noOneOnDuty()
    await noWeeksFiled()
  })

  test('a worked day shows the meter, and Nil where nothing was recorded', async ({
    page, loginAs,
  }) => {
    await closedDay('rep', todayLocal(), { km: 47 })
    await loginAs('manager')
    await openMonitor(page)

    await expect(page.getByText('47 km', { exact: true })).toBeVisible()
    // No positions were recorded, so there is nothing to join — said, not zero.
    await expect(page.getByText('not enough positions')).toBeVisible()
    await expect(page.getByText('nothing claimed for the day')).toBeVisible()
  })

  /** "Nil", as asked for, rather than a 0 km that reads as a day spent standing still. */
  test('a day never started reads Nil on the meter', async ({ page, loginAs }) => {
    await packetTarget('rep', todayLocal().slice(0, 7), 1000, { [todayLocal()]: 80 })
    await loginAs('manager')
    await openMonitor(page)

    await expect(page.getByText('day not started')).toBeVisible()
    await expect(page.getByText('Nil').first()).toBeVisible()
  })

  test('a claimed day says yes, and how much', async ({ page, loginAs }) => {
    await closedDay('rep', todayLocal(), { km: 47 })
    await claimedExpense('rep', todayLocal(), { allowance: 300, fuel: 211.5 })
    await loginAs('manager')
    await openMonitor(page)

    await expect(page.getByText('Yes · ₹511.5')).toBeVisible()
    await expect(page.getByText('Allowance ₹300 · Fuel ₹211.5')).toBeVisible()
  })
})

/**
 * The report: who is leading, and what sits behind it.
 *
 * The range is set to today alone, so the spec says which day is under test
 * rather than inheriting whatever week the suite happens to run in — on a
 * Sunday the default Monday-to-Saturday week would not contain today at all.
 */
test.describe('the report', () => {
  async function openReport(page: any) {
    await page.getByRole('button', { name: /^Reports/ }).first().click()
    await page.getByRole('button', { name: /^Monitor reps/ }).click()
    await page.getByRole('button', { name: 'Report', exact: true }).click()
    await page.getByRole('button', { name: 'A range' }).click()
    await page.getByLabel('From').fill(todayLocal())
    await page.getByLabel('To', { exact: true }).fill(todayLocal())
  }

  test('ranks the reps and lists what sits behind the bar', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()                                   // 24 packets, ₹1,440
    await packetTarget('rep', todayLocal().slice(0, 7), 1000, { [todayLocal()]: 20 })

    await loginAs('manager')
    await openReport(page)

    const row = page.getByTestId('report-row-e2e_rep')
    await expect(row).toContainText('24')
    await expect(row).toContainText('₹1,440')
    await expect(row).toContainText('1 / 1')
    // The bar carries its own number, and its readout the rest.
    await expect(page.getByRole('group', { name: /^1st, Ravi.*: 24 pkts\. 1 order · 1 of 1 days met/ }))
      .toBeVisible()
    await expect(page.getByText('Leading:')).toContainText('Ravi Rep · 24 pkts')
  })

  /**
   * The leaderboard can be read three ways, and they need not agree: more
   * orders is not more packets. Level reps share a place.
   */
  test('ranks by orders placed, and level reps share first', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()                                          // Ravi: one order, 24
    await companyAllocation({ createdBy: 'e2e_rep2', createdByName: 'Priya Rep', packets: 12 })

    await loginAs('manager')
    await openReport(page)
    await page.getByRole('group', { name: 'Rank by' }).getByRole('button', { name: 'Orders placed' }).click()

    await expect(page.getByText('Level at the top:')).toContainText('1 order')
    await expect(page.getByRole('group', { name: /^1st, Ravi Rep: 1 order/ })).toBeVisible()
    await expect(page.getByRole('group', { name: /^1st, Priya Rep: 1 order/ })).toBeVisible()

    // By packets they are not level, and the places say so.
    await page.getByRole('group', { name: 'Rank by' }).getByRole('button', { name: 'Packets' }).click()
    await expect(page.getByRole('group', { name: /^1st, Ravi Rep: 24 pkts/ })).toBeVisible()
    await expect(page.getByRole('group', { name: /^2nd, Priya Rep: 12 pkts/ })).toBeVisible()
  })

  test('a product filter narrows the orders and the target to that product', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()                                   // all of it prod_wipes
    await packetTarget('rep', todayLocal().slice(0, 7), 1000, { [todayLocal()]: 20 })

    await loginAs('manager')
    await openReport(page)
    await page.getByText('All products', { exact: true }).first().click()
    await page.getByText('Baby Wet Wipes 30s', { exact: true }).click()

    const row = page.getByTestId('report-row-e2e_rep')
    await expect(row).toContainText('₹0')
    // An old-shape target has no per-product split, so there is nothing for
    // the 30s to have been held to — "Not set", not a miss.
    await expect(row).toContainText('Not set')
  })
})
