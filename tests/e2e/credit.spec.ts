import { test, expect, clickStable } from './fixtures/app'
import { creditBillPaid, noAllocations, storedField } from './fixtures/seed'

/**
 * Changing a payment after the fact. Money again: an edit that lays the new
 * amount on bills that still carry the old one makes a shop owe less than it
 * does, and nothing on the screen says so.
 */
test.beforeEach(async () => { await noAllocations() })

async function openParty(page: any) {
  await page.getByRole('button', { name: /Credit book/ }).first().click()
  await clickStable(page.getByRole('button', { name: /Rajan Distributors/ }).first())
  await expect(page.getByText(/Payment history ·/)).toBeVisible()
}

test('an edited payment is laid on the bill once, not on top of itself', async ({ page, loginAs }) => {
  const { allocId, txnId } = await creditBillPaid(1000, 500)
  await loginAs('admin')
  await openParty(page)

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const amount = page.locator('input[type="number"]').first()
  await amount.fill('600')
  await page.getByRole('button', { name: 'Save changes' }).click()

  // 600 of 1000 paid, not 1000: the old 500 came off before the new 600 went on.
  await expect.poll(() => storedField(`allocations_v2/${allocId}`, 'paidAmount')).toBe(600)
  expect(await storedField(`allocations_v2/${allocId}`, 'status')).toBe('sent')
  expect(await storedField(`payment_transactions/${txnId}`, 'amount')).toBe(600)
})

test('a rep asks for a change, and an admin approves it', async ({ page, loginAs, asAlso }) => {
  const { allocId, txnId } = await creditBillPaid(1000, 500)
  await loginAs('rep')
  await openParty(page)

  // The rep cannot change it themselves.
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Ask to change' }).click()
  await page.locator('input[type="number"]').first().fill('600')
  await page.getByLabel('Why').fill('Typed 500, it was 600')
  await page.getByRole('button', { name: 'Send request' }).click()
  await expect(page.getByTestId('payment-change-request')).toContainText('waiting on your manager')
  // Nothing has moved yet.
  expect(await storedField(`allocations_v2/${allocId}`, 'paidAmount')).toBe(500)

  const admin = await asAlso('admin')
  await openParty(admin)
  await expect(admin.getByTestId('payment-change-request')).toContainText('change it to ₹600')
  await admin.getByRole('button', { name: 'Approve change' }).click()
  await admin.getByRole('button', { name: 'Approve', exact: true }).click()

  await expect.poll(() => storedField(`allocations_v2/${allocId}`, 'paidAmount')).toBe(600)
  expect(await storedField(`payment_transactions/${txnId}`, 'changeRequest')).toBeUndefined()
})
