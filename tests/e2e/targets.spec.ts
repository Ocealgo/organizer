import { test, expect } from './fixtures/app'
import {
  companyAllocation, companyStock, noAllocations, noTargetsSet, assignedDay, todayLocal,
} from './fixtures/seed'

/**
 * A monthly packet target, and the two places it has to agree with itself.
 *
 * A manager sets it on the planner; the rep sees their own progress on their
 * home screen; the report reads it for the team. All three count the same way
 * — packets on orders placed this month, cancellations off — through one
 * helper, because a target that means one thing on one screen and something
 * else on the next is worse than no target.
 *
 * The count is derived from the orders every time rather than accumulated, and
 * the cancellation test below is the one that proves why: nothing has to
 * remember to subtract.
 */

/**
 * Both stated out loud, immediately before they are needed.
 *
 * The wipe between specs cannot drop a write that has not landed yet, and both
 * of these are the kind that bites quietly: a leftover target turns Set into
 * Update, and a leftover order makes a settled count read high for reasons
 * nothing on the screen explains.
 */
test.beforeEach(async () => {
  await noTargetsSet()
  await noAllocations()
})

async function openPlannerTargets(page: any) {
  await page.getByRole('button', { name: /^The week/ }).first().click()
  await expect(page.getByRole('heading', { name: 'The week' })).toBeVisible()
  await page.getByRole('button', { name: 'Targets', exact: true }).click()
}

test.describe('setting a target', () => {
  test('a manager sets one and it reads back', async ({ page, loginAs }) => {
    await loginAs('manager')
    await openPlannerTargets(page)

    // Addressed by name, not by position. Two reps are seeded and they sort
    // alphabetically, so "the first box" is Priya and the orders below belong
    // to Ravi — a test that works by position tests the wrong person.
    await page.getByLabel('Packets for Ravi Rep').fill('2000')
    await page.getByRole('button', { name: 'Set target for Ravi Rep' }).click()

    await expect(page.getByText(/0 of 2000 packets ordered/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Update target for Ravi Rep' })).toBeVisible()
  })

  /** A target somebody sets for themselves is not a target, it is an intention. */
  test('a rep is not offered the planner at all', async ({ page, loginAs }) => {
    await loginAs('rep')
    await expect(page.getByRole('button', { name: /^The week/ })).toHaveCount(0)
  })

  test('a whole number or nothing', async ({ page, loginAs }) => {
    await loginAs('manager')
    await openPlannerTargets(page)

    await page.getByLabel('Packets for Ravi Rep').fill('12.5')
    await page.getByRole('button', { name: 'Set target for Ravi Rep' }).click()

    await expect(page.getByText(/packets has to be a whole number/)).toBeVisible()
  })
})

test.describe('progress against it', () => {
  /**
   * Placing the order is what counts, and it counts straight away — before
   * anything is dispatched and long before anything is paid. That is the point
   * of measuring the rep on the part they control.
   */
  test('an order counts the moment it is placed, and the rep sees it', async ({
    page, loginAs, asAlso,
  }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()   // pending: never dispatched, never paid

    await loginAs('manager')
    await openPlannerTargets(page)
    await page.getByLabel('Packets for Ravi Rep').fill('100')
    await page.getByRole('button', { name: 'Set target for Ravi Rep' }).click()

    await expect(page.getByText(/24 of 100 packets ordered/)).toBeVisible()

    const repPage = await asAlso('rep')
    await expect(repPage.getByText('This month · 24 of 100 packets')).toBeVisible()
    await expect(repPage.getByText('76 to go.', { exact: false })).toBeVisible()
  })

  /**
   * The reason the figure is worked out from the orders rather than kept as a
   * running total: cancelling takes the packets back out on its own, and no
   * code path has to remember to do it.
   */
  test('a cancelled order takes its packets back out', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()
    await companyAllocation({ status: 'cancelled' })

    await loginAs('manager')
    await openPlannerTargets(page)
    await page.getByLabel('Packets for Ravi Rep').fill('100')
    await page.getByRole('button', { name: 'Set target for Ravi Rep' }).click()

    // 48 packets were ordered; one order of 24 was cancelled.
    await expect(page.getByText(/24 of 100 packets ordered/)).toBeVisible()
    await expect(page.getByText(/1 cancelled, not counted/)).toBeVisible()
  })

  /**
   * The day's half. It lives on the beat, not on the rep, because a round of
   * forty shops in town is not the same day as eight in the hills — and it
   * reaches the rep through the day the beat was assigned to.
   */
  test('a day with a packet target shows today against it', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()
    await assignedDay('rep', todayLocal(), { units: 80, visits: 12 })

    await loginAs('rep')
    await expect(page.getByText('Today · 24 of 80 packets')).toBeVisible()
    // No monthly target here, so the month line carries no goal rather than
    // inventing one.
    await expect(page.getByText('This month · 24 packets')).toBeVisible()
  })

  /** Both horizons at once, which is the ordinary case once both are set. */
  test('a month target and a day target read side by side', async ({ page, loginAs, asAlso }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()
    await assignedDay('rep', todayLocal(), { units: 80 })

    await loginAs('manager')
    await openPlannerTargets(page)
    await page.getByLabel('Packets for Ravi Rep').fill('1000')
    await page.getByRole('button', { name: 'Set target for Ravi Rep' }).click()

    const repPage = await asAlso('rep')
    await expect(repPage.getByText('This month · 24 of 1000 packets')).toBeVisible()
    await expect(repPage.getByText('Today · 24 of 80 packets')).toBeVisible()
  })

  /** Nothing set means nothing shown. A card reading "0 of 0" is noise. */
  test('a rep with no target sees no card', async ({ page, loginAs }) => {
    await loginAs('rep')
    await expect(page.getByText(/This month ·/)).toHaveCount(0)
  })
})
