import { test, expect } from './fixtures/app'
import {
  companyAllocation, companyStock, noAllocations, noTargetsSet, packetTarget, todayLocal,
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
   * The day's figure is the rep's, not the beat's, and needs no beat at all.
   *
   * That is the whole point of moving it: a rep sent to a shop off their round
   * still owes the day's packets, so a target fixed to the beat stops applying
   * exactly when the day stops going to plan.
   */
  test('a day target shows with no beat assigned at all', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()
    await packetTarget('rep', todayLocal().slice(0, 7), 1000, { [todayLocal()]: 80 })

    await loginAs('rep')
    await expect(page.getByText('This month · 24 of 1000 packets')).toBeVisible()
    await expect(page.getByText('Today · 24 of 80 packets')).toBeVisible()
  })

  /** A day nobody set has no line, rather than a line reading zero. */
  test('a day with nothing set shows no day line', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()
    await packetTarget('rep', todayLocal().slice(0, 7), 1000, { '2020-01-02': 80 })

    await loginAs('rep')
    await expect(page.getByText('This month · 24 of 1000 packets')).toBeVisible()
    await expect(page.getByText(/^Today ·/)).toHaveCount(0)
  })
})

test.describe('dividing a month across its days', () => {
  test('equal division fills the days and adds up to the month', async ({
    page, loginAs, asAlso,
  }) => {
    await loginAs('manager')
    await openPlannerTargets(page)

    await page.getByLabel('Packets for Ravi Rep').fill('1000')
    await page.getByRole('button', { name: 'Set target for Ravi Rep' }).click()

    // By name, not by position: the reps sort alphabetically, so the first
    // panel on the screen is Priya's and the assertions below are Ravi's.
    await page.getByRole('button', { name: 'Day by day for Ravi Rep' }).click()
    await page.getByRole('button', { name: 'Divide equally for Ravi Rep' }).click()

    // The remainder goes somewhere rather than being dropped, so the days
    // still add up to the month they came from.
    await expect(page.getByText('1000 across the days')).toBeVisible()
    await page.getByRole('button', { name: 'Save days for Ravi Rep' }).click()

    // And the rep is told what today owes, without anybody assigning a beat.
    const repPage = await asAlso('rep')
    await expect(repPage.getByText(/^Today · 0 of \d+ packets$/)).toBeVisible()
  })

  test('a day can be changed away from the even split', async ({ page, loginAs }) => {
    await packetTarget('rep', todayLocal().slice(0, 7), 1000, { [todayLocal()]: 38 })

    await loginAs('manager')
    await openPlannerTargets(page)
    await page.getByRole('button', { name: 'Day by day for Ravi Rep' }).click()

    await page.getByLabel(`Packets for Ravi Rep on ${todayLocal()}`).fill('120')
    await page.getByRole('button', { name: 'Save days for Ravi Rep' }).click()

    // Said out loud, because a breakdown that no longer adds up to its month is
    // a decision rather than a mistake — but only if somebody can see it.
    await expect(page.getByText(/under the month by 880/)).toBeVisible()
  })

  test('there is nothing to divide without a month figure', async ({ page, loginAs }) => {
    await loginAs('manager')
    await openPlannerTargets(page)

    await page.getByRole('button', { name: 'Day by day for Priya Rep' }).click()
    await page.getByRole('button', { name: 'Divide equally for Priya Rep' }).click()

    await expect(page.getByText(/there is nothing to divide/)).toBeVisible()
  })

  /** Nothing set means nothing shown. A card reading "0 of 0" is noise. */
  test('a rep with no target sees no card', async ({ page, loginAs }) => {
    await loginAs('rep')
    await expect(page.getByText(/This month ·/)).toHaveCount(0)
  })
})
