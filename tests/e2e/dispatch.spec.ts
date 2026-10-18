import { test, expect } from './fixtures/app'
import { testNow } from './fixtures/clock'
import { companyAllocation, companyStock, noAllocations } from './fixtures/seed'

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

// Every spec here seeds its own orders and asserts on what the rows say, so
// inheriting the previous one's makes a getByText ambiguous — and the failure
// reads as the screen being wrong rather than the world being dirty.
test.beforeEach(async () => {
  await noAllocations()
})

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
    await companyAllocation({ status: 'sent', sentAt: testNow(), sentDate: '2099-01-01' })

    await loginAs('manager')
    await openAllocations(page)

    await expect(page.getByRole('button', { name: 'Mark paid' })).toHaveCount(0)
  })

  test('a manager who holds mark_paid does get it', async ({ page, loginAs }) => {
    await companyAllocation({ status: 'sent', sentAt: testNow(), sentDate: '2099-01-01' })

    await loginAs('managerPlus')
    await openAllocations(page)

    await expect(page.getByRole('button', { name: 'Mark paid' })).toBeVisible()
  })
})

/**
 * Sending a list at once.
 *
 * The tap count is the whole point: forty allocations was eighty taps, a
 * button and a dialog each. What must survive the shortcut is knowing what
 * moved — a batch that reports "done" while three are still pending is worse
 * than no batch at all.
 */
test.describe('sending several at once', () => {
  test('select all, send, and every one of them goes', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()
    await companyAllocation()
    await companyAllocation()

    await loginAs('manager')
    await openAllocations(page)

    await page.getByRole('button', { name: 'Select all 3 waiting' }).click()
    await expect(page.getByText(/3 selected/)).toBeVisible()

    await page.getByRole('button', { name: 'Send 3' }).first().click()
    // The dialog says what is about to move, in cartons and rupees.
    await expect(page.getByText('Send 3 allocations?')).toBeVisible()
    await expect(page.getByText(/worth ₹4,320/)).toBeVisible()

    await page.getByRole('button', { name: 'Send 3' }).last().click()

    await expect(page.getByText('All 3 sent')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Select all 3 waiting' })).toHaveCount(0)
  })

  /**
   * The failure that actually happens: three each fit on their own, and not
   * together. Without the guard inside the transaction this ran company stock
   * negative instead of refusing.
   */
  test('what could not be sent is named, and stays ticked', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 30)   // enough for one 24-packet order
    await companyAllocation()
    await companyAllocation()

    await loginAs('manager')
    await openAllocations(page)

    await page.getByRole('button', { name: 'Select all 2 waiting' }).click()
    await page.getByRole('button', { name: 'Send 2' }).first().click()
    await page.getByRole('button', { name: 'Send 2' }).last().click()

    await expect(page.getByText('1 sent, 1 not')).toBeVisible()
    await expect(page.getByText(/Rajan Distributors.*left/)).toBeVisible()
    // Still selected, and the button to try again is still on the screen. Only
    // one allocation is left to send, which used to be fewer than the bar
    // needed to draw itself at all — so the panel above promised a retry and
    // the control for it had gone.
    await expect(page.getByText(/1 selected/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send 1' })).toBeVisible()
  })

  test('a rep is offered no batch at all', async ({ page, loginAs }) => {
    await companyAllocation()
    await companyAllocation()

    await loginAs('rep')
    await page.getByRole('button', { name: /^Allocations/ }).first().click()

    await expect(page.getByRole('button', { name: /Select all/ })).toHaveCount(0)
  })

  test('one allocation on its own gets no batch bar', async ({ page, loginAs }) => {
    await companyAllocation()

    await loginAs('manager')
    await openAllocations(page)

    await expect(page.getByRole('button', { name: 'Dispatch' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Select all/ })).toHaveCount(0)
  })
})
