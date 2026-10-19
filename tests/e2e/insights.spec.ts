import { test, expect } from './fixtures/app'
import {
  companyStock, companyAllocation, packetTarget, outletVisit, beat, todayLocal,
  noAllocations, noTargetsSet,
} from './fixtures/seed'

/**
 * Reports home's three questions: on track for the month, do visits turn into
 * orders, are the beats being worked. Each is arithmetic over facts already
 * recorded, so each spec seeds the facts and reads the arithmetic back.
 */
test.beforeEach(async () => {
  await noTargetsSet()
  await noAllocations()
})

async function openReports(page: any) {
  await page.getByRole('button', { name: /^Reports/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible()
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
  await openReports(page)

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
