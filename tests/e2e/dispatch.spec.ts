import { test, expect } from './fixtures/app'
import { companyAllocation } from './fixtures/seed'

/**
 * Who may send the stock, and who may say the money came.
 *
 * These are two authorities and they used to arrive together: the Allocations
 * screen took a single `isAdmin`, every caller filled it in from
 * `dispatch_allocations`, and Mark paid rode along on it. So anybody granted
 * dispatch got a Mark paid button the rules would refuse — and the refusal was
 * silent, because the handler had no catch.
 *
 * A screen that offers a button the database will turn down reads as a broken
 * app rather than as a rule being enforced, which is why this is worth a test
 * rather than a careful reading.
 */

async function openAllocations(page: any) {
  await page.getByRole('button', { name: /^Allocations/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Allocations' })).toBeVisible()
}

test.describe('dispatching stock', () => {
  test('a manager on the shipped defaults can dispatch', async ({ page, loginAs }) => {
    await companyAllocation()

    await loginAs('manager')
    await openAllocations(page)

    await expect(page.getByRole('button', { name: 'Dispatch' })).toBeVisible()
    await expect(page.getByText('Waiting to be dispatched.')).toHaveCount(0)
  })

  test('a rep sees who it is waiting on, and no button', async ({ page, loginAs }) => {
    await companyAllocation()

    await loginAs('rep')
    // A rep reaches the same screen from their own home, not the dashboard.
    await page.getByRole('button', { name: /^Allocations/ }).first().click()

    await expect(page.getByText('Waiting to be dispatched.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dispatch' })).toHaveCount(0)
  })
})

test.describe('settling a bill is a separate authority', () => {
  /**
   * The bug this holds down. `manager` holds dispatch and not mark_paid, so
   * Mark paid must not be drawn — the rules would refuse the write.
   */
  test('dispatch does not bring Mark paid with it', async ({ page, loginAs }) => {
    await companyAllocation({ status: 'sent', sentAt: Date.now(), sentDate: '2099-01-01' })

    await loginAs('manager')
    await openAllocations(page)

    await expect(page.getByRole('button', { name: 'Mark paid' })).toHaveCount(0)
  })

  test('a manager who holds mark_paid does get it', async ({ page, loginAs }) => {
    await companyAllocation({ status: 'sent', sentAt: Date.now(), sentDate: '2099-01-01' })

    await loginAs('managerPlus')
    await openAllocations(page)

    await expect(page.getByRole('button', { name: 'Mark paid' })).toBeVisible()
  })
})
