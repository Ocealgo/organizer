import { test, expect } from './fixtures/app'
import { testDate } from './fixtures/clock'
import {
  approvedLeave, autoMarkedLeave, makeSuperAdmin, noLeaveRecorded, noOneOnDuty,
} from './fixtures/seed'
import { localDateStr } from '../../src/utils/date'

/**
 * Automatic absence, and arguing with it.
 *
 * The sweep marks a day nobody started. That is a decision about a person made
 * while they were not there, so the whole feature rests on them being able to
 * say it was wrong — and these cover the two ways that stopped working.
 */

const dayBefore = (days: number) => {
  const d = testDate()
  d.setDate(d.getDate() - days)
  return localDateStr(d)
}

/** Open "My leaves" and land on the month the seeded record is in. */
async function openLeave(page: any, date: string) {
  await page.getByRole('button', { name: /My leaves/ }).click()
  await expect(page.getByText('My leave')).toBeVisible()
  if (date.slice(0, 7) !== localDateStr().slice(0, 7)) {
    await page.getByRole('button', { name: 'Previous month' }).click()
  }
}

test.describe('an automatic absence the officer disputes', () => {
  test.beforeEach(async () => {
    // The sweep only marks somebody who did not punch in, so the record only
    // makes sense in a world where they did not. And the book has to be empty
    // before one is written into it: these specs assert on what a single leave
    // record says, and the previous spec's appeal arriving late reads as this
    // one's.
    await noOneOnDuty()
    await noLeaveRecorded()
  })

  /**
   * The appeal used to close at midnight.
   *
   * The button was drawn only for a leave dated today or later, and the sweep
   * writes against the day it happened. The reasons it exists for — a flat
   * battery, no signal in a godown — are the same reasons the officer does not
   * see the notification until the next morning, so the only people who could
   * appeal were the ones it was right about.
   */
  test('a leave marked yesterday can still be appealed today', async ({ page, loginAs }) => {
    const yesterday = dayBefore(1)
    await autoMarkedLeave('rep', yesterday, 'half_day')

    await loginAs('rep')
    await openLeave(page, yesterday)

    await expect(page.getByText(/Marked automatically/)).toBeVisible()
    const appeal = page.getByRole('button', { name: 'This is wrong' })
    await expect(appeal).toBeVisible()

    await appeal.click()
    await page.getByPlaceholder(/Phone battery died/).fill('Phone battery died on the bus.')
    await page.getByRole('button', { name: 'Send to my manager' }).click()

    await expect(page.getByText('Cancellation requested')).toBeVisible()
    await expect(page.getByText('You said: Phone battery died on the bus.')).toBeVisible()
  })

  /** An explanation is the point of the appeal, so it is not optional. */
  test('an automatic leave cannot be appealed without saying what happened', async ({
    page, loginAs,
  }) => {
    const yesterday = dayBefore(1)
    await autoMarkedLeave('rep', yesterday, 'half_day')

    await loginAs('rep')
    await openLeave(page, yesterday)

    await page.getByRole('button', { name: 'This is wrong' }).click()
    await page.getByRole('button', { name: 'Send to my manager' }).click()

    await expect(page.getByText('Say what happened — your manager decides on this.')).toBeVisible()
    await expect(page.getByText('Cancellation requested')).toHaveCount(0)
  })

  /**
   * Half a day is half a day, on the screen as well as in the record.
   *
   * Worth asserting rather than assuming: every screen formats this from
   * `leaveType`, and one of them reading "Full day" over a half-day record is
   * the difference between a morning and a day of somebody's pay.
   */
  test('a half day reads as a half day, not a full one', async ({ page, loginAs }) => {
    const twoDaysAgo = dayBefore(2)
    await autoMarkedLeave('rep', twoDaysAgo, 'half_day')

    await loginAs('rep')
    await openLeave(page, twoDaysAgo)

    await expect(page.getByText('Half day').first()).toBeVisible()
    // "Full day" does appear on this screen — it is one of the two buttons for
    // requesting leave. So the assertion is that it appears exactly once and
    // that the once is the button, which is the same as saying the record above
    // it does not claim a full day.
    await expect(page.getByText('Full day', { exact: true })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Full day', exact: true })).toHaveCount(1)
  })

  /**
   * A leave the officer asked for themselves stays a past-is-past affair.
   *
   * The fix widens the appeal to automatic records only. One a manager
   * approved on a day that has gone is not arguable — there is nothing left to
   * cancel — and the button should still be absent.
   */
  test('an ordinary leave in the past offers nothing to cancel', async ({ page, loginAs }) => {
    const yesterday = dayBefore(1)
    await approvedLeave('rep2', yesterday, 'full_day')

    await loginAs('rep2')
    await openLeave(page, yesterday)

    await expect(page.getByText('Approved')).toBeVisible()
    await expect(page.getByText(/Marked automatically/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'This is wrong' })).toHaveCount(0)
  })
})

/**
 * A sales officer asking for time off.
 *
 * Separate from the appeal tests on purpose: "a rep cannot request leave" and
 * "a rep cannot argue with leave the app marked" are two different claims, and
 * only the second one was true. This holds the first one down so it stays that
 * way — the rules let a rep create their own record only at
 * `pending_approval`, and a tightening that forgot the officer's own case
 * would land here.
 */
test.describe('a rep requesting leave', () => {
  test('an offline sales officer can file a request and withdraw it', async ({
    page, loginAs,
  }) => {
    await noLeaveRecorded()
    await loginAs('rep')
    await page.getByRole('button', { name: /My leaves/ }).click()
    await expect(page.getByText('My leave')).toBeVisible()

    await page.getByRole('button', { name: 'Half day', exact: true }).click()
    await expect(page.getByText('A half day off. Pick the date and a reason.')).toBeVisible()

    await page.getByRole('button', { name: 'Personal', exact: true }).click()
    await page.getByRole('button', { name: /Send request/ }).click()
    // The confirm dialog, then the record.
    await page.getByRole('button', { name: 'Send request' }).last().click()

    // Exact: the page subtitle also counts them — "1 request awaiting approval".
    await expect(page.getByText('Awaiting approval', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Withdraw' })).toBeVisible()
  })
})

/**
 * The times that decide it.
 *
 * A rep on half a day cannot punch in before the resume time, and the full-day
 * cutoff marks anybody who has not punched in. Set the resume at or after that
 * cutoff and the app forbids them from starting, then records a full day
 * because they did not — a half day silently becomes a whole one and the only
 * thing the rep did wrong was obey the screen.
 */
test.describe('the missed punch-in settings', () => {
  test('a half day cannot be made to end after the full-day cutoff', async ({
    page, loginAs,
  }) => {
    await makeSuperAdmin('admin')
    await loginAs('admin')

    await page.getByRole('button', { name: /^Settings/ }).first().click()
    await expect(page.getByText('Missed punch-in')).toBeVisible()

    // Settings has two Saves — the mapper link's and this block's. Anchored
    // below the roles field, which only the attendance block has, so it stays
    // the right button if the page grows another one.
    const save = page
      .locator('button:below(:text("Roles this applies to"))')
      .filter({ hasText: /^Save/ })
      .first()

    // Full day at 14:00 by default; a half day that ends at 15:00 is the trap.
    await page.getByLabel('Half day ends at').fill('15:00')

    await expect(page.getByText(/A half day has to end before the full-day cutoff/)).toBeVisible()
    await expect(save).toBeDisabled()

    // Back inside the window and the save is live again.
    await page.getByLabel('Half day ends at').fill('13:00')
    await expect(page.getByText(/A half day has to end before the full-day cutoff/)).toHaveCount(0)
    await expect(save).toBeEnabled()
  })
})
