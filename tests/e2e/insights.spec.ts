import { test, expect } from './fixtures/app'
import {
  companyStock, companyAllocation, packetTarget, outletVisit, beat, todayLocal,
  noAllocations, noTargetsSet,
} from './fixtures/seed'
import { testDate } from './fixtures/clock'

/** A date `n` months back, on day `day` of that month, as YYYY-MM-DD. */
function monthsBack(n: number, day: number): string {
  const d = testDate()
  const x = new Date(d.getFullYear(), d.getMonth() - n, day)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

/**
 * Reports home's three questions: on track for the month, do visits turn into
 * orders, are the beats being worked. Each is arithmetic over facts already
 * recorded, so each spec seeds the facts and reads the arithmetic back.
 */
test.beforeEach(async () => {
  await noTargetsSet()
  await noAllocations()
})

async function openReports(page: any, tab?: 'Compare') {
  await page.getByRole('button', { name: /^Reports/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible()
  if (tab) await page.getByRole('button', { name: tab, exact: true }).click()
}

test('the month against its target, rep by rep', async ({ page, loginAs }) => {
  await companyStock('prod_wipes', 500)
  await companyAllocation()                                   // Ravi: 24 packets today
  await packetTarget('rep', todayLocal().slice(0, 7), 1000)

  await loginAs('manager')
  await openReports(page)

  const row = page.getByTestId('pace-row-e2e_rep')
  await expect(row).toContainText('Ravi Rep')
  await expect(row).toContainText('1,000')
  await expect(row).toContainText('24')
  await expect(page.getByText('Ordered so far')).toBeVisible()
  await expect(page.getByText('Needed a day', { exact: true }).first()).toBeVisible()
})

test('with no targets, it says where to set them rather than showing zeros', async ({ page, loginAs }) => {
  await loginAs('manager')
  await openReports(page)
  await expect(page.getByText(/No targets set for this month yet/)).toBeVisible()
})

test('strike rate is the visits that ended in an order', async ({ page, loginAs }) => {
  // Six visits, three with an order: 50%. Six clears the five-visit floor for the ranking.
  for (let i = 0; i < 6; i++) await outletVisit('rep', todayLocal(), 'party_shop', i < 3)

  await loginAs('manager')
  await openReports(page, 'Compare')

  await expect(page.getByText('3 of 6 visits ended in an order')).toBeVisible()
  await page.getByRole('button', { name: 'Strike rate', exact: true }).click()
  await expect(page.getByRole('group', { name: /^1st, Ravi Rep: 50%/ })).toBeVisible()
})

test('beat coverage: visited, and of those, ordered', async ({ page, loginAs }) => {
  // A beat of three shops: two visited, one of them ordered.
  await beat('route_cov', 'Test Beat', ['party_shop', 'party_pharmacy', 'party_dist'])
  await outletVisit('rep', todayLocal(), 'party_shop', true)
  await outletVisit('rep', todayLocal(), 'party_pharmacy', false)
  await companyStock('prod_wipes', 500)
  await companyAllocation({ partyId: 'party_shop', partyName: 'Anand Stores', partyType: 'retailer' })

  await loginAs('manager')
  await openReports(page)

  const row = page.getByTestId('coverage-row-route_cov')
  await expect(row).toContainText('Test Beat')
  await expect(row).toContainText('67%')                      // 2 of 3 visited
  await expect(row).toContainText('33%')                      // 1 of 3 ordered
})

test('opens on This month, and Compare holds the period-against-period figures', async ({ page, loginAs }) => {
  await loginAs('manager')
  await openReports(page)
  await expect(page.getByRole('button', { name: 'This month', exact: true })).toBeVisible()
  await expect(page.getByText('This month against the target')).toBeVisible()
  await expect(page.getByText('Against last period')).toHaveCount(0)

  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(page.getByText('Against last period')).toBeVisible()
  await expect(page.getByText('Growth, month by month')).toBeVisible()

  // The dates live in the box they change, and the growth box says it ignores them.
  const period = page.locator('section', { hasText: 'Period against period' })
  const growth = page.locator('section', { hasText: 'Growth, month by month' })
  await expect(period.getByRole('button', { name: 'Last 30 days' })).toBeVisible()
  await expect(growth.getByRole('button', { name: 'Last 30 days' })).toHaveCount(0)
  await expect(growth.getByText('Always the last six months, whatever dates are picked above.')).toBeVisible()
})

/** Nothing in the period before: say so, rather than "up 100%". */
test('a thin earlier period says there is not enough history', async ({ page, loginAs }) => {
  await outletVisit('rep', todayLocal(), 'party_shop', true)
  await loginAs('manager')
  await openReports(page, 'Compare')
  await expect(page.getByText('not enough history to compare').first()).toBeVisible()
})

/**
 * Growth over complete months only — the month under way is always behind a
 * whole one — and a first month that began partway through is not counted.
 */
test('growth: month against month, and the average over complete months', async ({ page, loginAs }) => {
  await companyStock('prod_wipes', 5000)
  // Three complete months, each starting early so none is "partial":
  // ₹1,440 → ₹2,880 → ₹4,320. Up 100%, then up 50%; compound average √3 − 1 ≈ 73.2%.
  const order = (date: string, n: number) => companyAllocation({
    createdAt: new Date(`${date}T11:00:00`).getTime(), packets: 24 * n, totalAmount: 1440 * n,
  })
  await order(monthsBack(3, 2), 1)
  await order(monthsBack(2, 2), 2)
  await order(monthsBack(1, 2), 3)

  await loginAs('manager')
  await openReports(page, 'Compare')

  await expect(page.getByTestId(`growth-row-${monthsBack(2, 2).slice(0, 7)}`)).toContainText('up 100%')
  await expect(page.getByTestId(`growth-row-${monthsBack(1, 2).slice(0, 7)}`)).toContainText('up 50%')
  await expect(page.getByText('+73.2%')).toBeVisible()
})

test('a first month that began late is shown as partial and left out', async ({ page, loginAs }) => {
  await companyStock('prod_wipes', 5000)
  await companyAllocation({ createdAt: new Date(`${monthsBack(2, 20)}T11:00:00`).getTime() })
  await companyAllocation({ createdAt: new Date(`${monthsBack(1, 2)}T11:00:00`).getTime(), packets: 240, totalAmount: 14400 })

  await loginAs('manager')
  await openReports(page, 'Compare')

  const first = page.getByTestId(`growth-row-${monthsBack(2, 20).slice(0, 7)}`)
  await expect(first).toContainText('partial')
  await expect(first).toContainText('not counted')
  // Against a partial month there is no change to state.
  await expect(page.getByTestId(`growth-row-${monthsBack(1, 2).slice(0, 7)}`)).not.toContainText('up')
})
