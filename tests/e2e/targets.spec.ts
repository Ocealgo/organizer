import { test, expect } from './fixtures/app'
import { companyAllocation, companyStock, noAllocations, noTargetsSet } from './fixtures/seed'

/**
 * A monthly packet target, and the two places it has to agree with itself.
 *
 * A manager sets it on the planner; the rep sees their own progress on their
 * home screen; the report reads it for the team. All three count the same way
 * — packets on bills that settled this month — through one helper, because a
 * target that means one thing on one screen and something else on the next is
 * worse than no target.
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

    await expect(page.getByText(/0 of 2000 packets settled/)).toBeVisible()
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
   * The whole point of counting settled bills: raising an order moves nothing,
   * and the rep is told why rather than left to wonder.
   */
  test('an unpaid order does not count toward the target', async ({
    page, loginAs, asAlso,
  }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()   // pending, never paid

    await loginAs('manager')
    await openPlannerTargets(page)
    await page.getByLabel('Packets for Ravi Rep').fill('100')
    await page.getByRole('button', { name: 'Set target for Ravi Rep' }).click()
    await expect(page.getByText(/0 of 100 packets settled/)).toBeVisible()
    // Raised is shown beside it, so a settled zero has its reason on screen.
    await expect(page.getByText(/24 packets ordered this month/)).toBeVisible()

    // The rep sees the same target on their own screen, and no progress yet.
    const repPage = await asAlso('rep')
    await expect(repPage.getByText('This month · 0 of 100 packets')).toBeVisible()
    await expect(repPage.getByText(/Counted when a bill is settled/)).toBeVisible()
  })

  test('a settled bill counts, and the rep sees it', async ({
    page, loginAs, asAlso,
  }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation({ status: 'paid', paidAt: Date.now(), paidAmount: 1440 })

    await loginAs('manager')
    await openPlannerTargets(page)
    await page.getByLabel('Packets for Ravi Rep').fill('100')
    await page.getByRole('button', { name: 'Set target for Ravi Rep' }).click()

    await expect(page.getByText(/24 of 100 packets settled/)).toBeVisible()

    const repPage = await asAlso('rep')
    await expect(repPage.getByText('This month · 24 of 100 packets')).toBeVisible()
    await expect(repPage.getByText('76 to go.', { exact: false })).toBeVisible()
  })

  /** Nothing set means nothing shown. A card reading "0 of 0" is noise. */
  test('a rep with no target sees no card', async ({ page, loginAs }) => {
    await loginAs('rep')
    await expect(page.getByText(/This month ·/)).toHaveCount(0)
  })
})
