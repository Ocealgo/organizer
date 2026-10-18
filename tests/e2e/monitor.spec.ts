import { test, expect } from './fixtures/app'
import {
  companyAllocation, companyStock, noAllocations, noTargetsSet,
  packetTarget, todayLocal,
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

async function openMonitor(page: any) {
  await page.getByRole('button', { name: /^Reports/ }).first().click()
  await page.getByRole('button', { name: /^Monitor reps/ }).click()
  await expect(page.getByRole('heading', { name: 'Monitor reps' })).toBeVisible()
}

test.describe('the end of a day', () => {
  test('a day that beat its target says so', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()                                   // 24 packets
    await packetTarget('rep', todayLocal().slice(0, 7), 1000, { [todayLocal()]: 20 })

    await loginAs('manager')
    await openMonitor(page)

    await expect(page.getByText('✓ Target met')).toBeVisible()
    await expect(page.getByText('20 packets')).toBeVisible()
    await expect(page.getByText(/24 packets/)).toBeVisible()
  })

  test('a day that fell short says that instead', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()                                   // 24 packets
    await packetTarget('rep', todayLocal().slice(0, 7), 1000, { [todayLocal()]: 80 })

    await loginAs('manager')
    await openMonitor(page)

    await expect(page.getByText('✗ Short')).toBeVisible()
    await expect(page.getByText('80 packets')).toBeVisible()
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
