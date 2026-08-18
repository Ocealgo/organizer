import { test, expect, clickStable } from './fixtures/app'
import { noWeeksFiled, noOneOnDuty } from './fixtures/seed'

/**
 * Money paths. These are the ones worth being strict about — a wrong number
 * here is a wrong payment, and nobody notices until the month closes.
 */

async function openExpenses(page: any) {
  await page.getByRole('button', { name: /Expense reports/ }).click()
  // The rep's screen is titled by the week; "My expenses" is the eyebrow.
  await expect(page.getByText('My expenses')).toBeVisible()
}

async function openAdminExpenses(page: any) {
  await page.getByRole('button', { name: /^Expenses/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible()
}

test.describe('fuel by distance', () => {
  test('with no rate set, fuel is a typed amount', async ({ page, loginAs }) => {
    await loginAs('rep')
    await openExpenses(page)

    await clickStable(page.getByRole('button', { name: 'Add an expense' }).first())
    await page.getByRole('button', { name: 'Fuel', exact: true }).click()

    await expect(page.getByText('No ₹ per km rate has been set, so enter the amount yourself.')).toBeVisible()
    await expect(page.getByPlaceholder('Kilometres')).toHaveCount(0)
  })

  test('a manager without clear_expenses cannot reach the rates', async ({ page, loginAs }) => {
    await loginAs('manager')
    await openAdminExpenses(page)
    // view_expenses is on by default, clear_expenses is not.
    await expect(page.getByRole('button', { name: 'Rates' })).toHaveCount(0)
  })

  test('a manager with clear_expenses sets the rate, and the rep claims by km', async ({
    page, loginAs, asAlso,
  }) => {
    await loginAs('managerPlus')
    await openAdminExpenses(page)
    await page.getByRole('button', { name: 'Rates' }).click()

    await page.getByPlaceholder(/Leave blank to let reps type/).fill('4.5')
    await page.getByRole('button', { name: 'Save rates' }).click()
    await expect(page.getByText(/Currently ₹4.5 per km/)).toBeVisible()

    // A different person, in their own session: the rep claims against that rate.
    const repPage = await asAlso('rep')
    await repPage.getByRole('button', { name: /Expense reports/ }).click()
    await clickStable(repPage.getByRole('button', { name: 'Add an expense' }).first())
    await repPage.getByRole('button', { name: 'Fuel', exact: true }).click()

    await expect(repPage.getByText('Paid at ₹4.5 per km. You do not enter the amount — it is worked out from this.')).toBeVisible()
    await repPage.getByPlaceholder('Kilometres').fill('12')
    await expect(repPage.getByText('That is ₹54.')).toBeVisible()

    await repPage.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(repPage.getByText('12 km at ₹4.5 per km')).toBeVisible()
    await expect(repPage.getByText('₹54').first()).toBeVisible()
  })
})

// These assert on a week being *empty*, so they use a rep no other spec
// touches. Sharing an actor with a spec that files an expense makes the
// assertion depend on teardown order, which is not a thing worth depending on.
test.describe('nil returns', () => {
  // A week nobody has touched, said out loud rather than assumed. A write from
  // the spec before this one can land after the wipe, and an inherited week
  // that is already submitted hides the very button these specs are about.
  test.beforeEach(async () => {
    await noWeeksFiled()
    await noOneOnDuty()
  })

  test('a week with nothing in it can be declared, not just left blank', async ({ page, loginAs }) => {
    await loginAs('rep2')
    await openExpenses(page)

    await expect(page.getByText(/Nothing is logged for this week/)).toBeVisible()
    await clickStable(page.getByRole('button', { name: 'Nothing to claim this week' }))
    await page.getByRole('button', { name: 'Declare nil' }).click()

    await expect(page.getByText(/Declared as nothing to claim/)).toBeVisible()
  })

  test('an admin sees the nil return and acknowledges rather than pays', async ({ page, loginAs, asAlso }) => {
    await loginAs('rep2')
    await openExpenses(page)
    await clickStable(page.getByRole('button', { name: 'Nothing to claim this week' }))
    await page.getByRole('button', { name: 'Declare nil' }).click()
    await expect(page.getByText(/Declared as nothing to claim/)).toBeVisible()

    const adminPage = await asAlso('admin')
    await openAdminExpenses(adminPage)

    await expect(adminPage.getByText('· nothing to claim')).toBeVisible()
    await clickStable(adminPage.getByRole('button', { name: /Priya Rep/ }))
    await expect(adminPage.getByRole('button', { name: 'Acknowledge the week' })).toBeVisible()
    // Nothing is being paid, so the money warning must not be shown.
    await expect(adminPage.getByText(/money has physically reached/)).toHaveCount(0)
  })
})
