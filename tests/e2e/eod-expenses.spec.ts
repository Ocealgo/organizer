import { test, expect } from './fixtures/app'
import { closedDay, fuelRate, noWeeksFiled, noOneOnDuty, todayLocal, outletVisit } from './fixtures/seed'

/**
 * The day's expenses, proposed at the end of it.
 *
 * The thing that matters is not the arithmetic, which is a multiplication. It
 * is that the meter becomes the default and a claim above it has to say why —
 * the one fuel figure that used to come from memory now comes from the
 * odometer unless somebody explains otherwise.
 */

test.beforeEach(async () => {
  await noOneOnDuty()
  await noWeeksFiled()
  await fuelRate(4.5)
})

test.describe('the end of a worked day', () => {
  test('it proposes the allowance and the fuel from the meter', async ({ page, loginAs }) => {
    await closedDay('rep', todayLocal(), { km: 47 })
    await loginAs('rep')

    await expect(page.getByText('Today’s expenses')).toBeVisible()
    await expect(page.getByText(/Worked out from the 47 km on your meter/)).toBeVisible()
    // 47 km is beyond 25, so EX — and the fuel is 47 × 4.5.
    await expect(page.getByText('₹300')).toBeVisible()
    await expect(page.getByLabel('Fuel kilometres')).toHaveValue('47')
    await expect(page.getByText('₹211.5')).toBeVisible()
  })

  /** Proposed, never filed: nothing is on the week until the rep says so. */
  test('nothing is claimed until the rep adds it', async ({ page, loginAs }) => {
    await closedDay('rep', todayLocal(), { km: 47 })
    await loginAs('rep')

    await page.getByRole('button', { name: /Add ₹511\.5 to this week/ }).click()
    await expect(page.getByText(/₹511\.5 added to this week/)).toBeVisible()
  })

  test('claiming less than the meter needs no reason', async ({ page, loginAs }) => {
    await closedDay('rep', todayLocal(), { km: 47 })
    await loginAs('rep')

    await page.getByLabel('Fuel kilometres').fill('30')
    await expect(page.getByLabel('Reason for claiming above the meter')).toHaveCount(0)
    await page.getByRole('button', { name: /Add ₹435 to this week/ }).click()
    await expect(page.getByText(/added to this week/)).toBeVisible()
  })

  /**
   * The one case the odometer cannot vouch for, so the one that needs a
   * sentence — and the sentence is required, not suggested.
   */
  test('claiming more than the meter has to say why', async ({ page, loginAs }) => {
    await closedDay('rep', todayLocal(), { km: 47 })
    await loginAs('rep')

    await page.getByLabel('Fuel kilometres').fill('80')
    await expect(page.getByLabel('Reason for claiming above the meter')).toBeVisible()

    await page.getByRole('button', { name: /to this week/ }).click()
    await expect(page.getByText(/more than the 47 km on the meter — say why/)).toBeVisible()
    await expect(page.getByText(/added to this week/)).toHaveCount(0)

    await page.getByLabel('Reason for claiming above the meter')
      .fill('Meter reset at the garage at noon')
    await page.getByRole('button', { name: /to this week/ }).click()
    await expect(page.getByText(/added to this week/)).toBeVisible()
  })

  test('the allowance band follows the meter, and can be changed', async ({ page, loginAs }) => {
    await closedDay('rep', todayLocal(), { km: 12 })
    await loginAs('rep')

    // 12 km is within 25 — HQ, at 200.
    await expect(page.getByText('₹200', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'OS · stayed over' }).click()
    await expect(page.getByText('₹450', { exact: true })).toBeVisible()
    // Changed away from what the meter points at, and said so.
    await expect(page.getByText(/The meter points at HQ/)).toBeVisible()
  })
})

test.describe('when it cannot work anything out', () => {
  test('a broken meter offers only the allowance, and says why', async ({ page, loginAs }) => {
    await closedDay('rep', todayLocal(), { km: null })
    await loginAs('rep')

    await expect(page.getByText(/There was no meter reading today/)).toBeVisible()
    await expect(page.getByLabel('Fuel kilometres')).toHaveCount(0)
  })

  /** Proposed once. A fuel claim proposed twice is a fuel claim paid twice. */
  test('once added, it is not offered again', async ({ page, loginAs }) => {
    await closedDay('rep', todayLocal(), { km: 47 })
    await loginAs('rep')
    await page.getByRole('button', { name: /to this week/ }).click()
    await expect(page.getByText(/added to this week/)).toBeVisible()

    await page.reload()
    await expect(page.getByText(/already on this week/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Add ₹/ })).toHaveCount(0)
  })

  test('an automatically closed day shows no card', async ({ page, loginAs }) => {
    await closedDay('rep', todayLocal(), { km: 47, autoClosed: true })
    await loginAs('rep')
    await expect(page.getByText('Today’s expenses')).toHaveCount(0)
  })
})

test.describe('a manager in the field', () => {
  test('a day with no shop visits offers no expenses', async ({ page, loginAs }) => {
    await closedDay('manager', todayLocal(), { km: 47 })
    await loginAs('manager')
    await page.getByRole('button', { name: 'Your day' }).click()
    await expect(page.getByText(/Done for the day/)).toBeVisible()
    await expect(page.getByText('Today’s expenses')).toHaveCount(0)
  })

  test('a day with a shop visit offers them', async ({ page, loginAs }) => {
    await closedDay('manager', todayLocal(), { km: 47 })
    await outletVisit('manager', todayLocal(), 'party_shop', false)
    await loginAs('manager')
    await page.getByRole('button', { name: 'Your day' }).click()
    await expect(page.getByText('Today’s expenses')).toBeVisible()
  })
})
