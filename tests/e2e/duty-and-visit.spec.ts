import { test, expect, clickStable } from './fixtures/app'
import { noOneOnDuty } from './fixtures/seed'

/**
 * The field day: punch in, visit an outlet, punch out.
 *
 * This is the spine of the app — the outlet list is locked behind the duty
 * session, and every visit is filed against it. If this path breaks, a rep
 * cannot work at all, so it is worth testing end to end rather than in pieces.
 */

/** Punch in so a spec starts on an open day. */
async function startDay(page: any, stubCamera: () => Promise<void>) {
  // Stated, not assumed. See noOneOnDuty in fixtures/seed.ts.
  await noOneOnDuty()
  await clickStable(page.getByRole('button', { name: /Start the day/ }))
  // Prove we are on the opening screen before typing into it. Both duty
  // screens share the meter-reading placeholder, so filling blind on the
  // closing screen succeeds and fails three lines later looking for a button
  // that was never going to be there.
  await expect(page.getByRole('heading', { name: 'Start your day' })).toBeVisible()
  await page.getByPlaceholder('Kilometres on the meter').fill('12500')
  await stubCamera()
  await page.getByRole('button', { name: 'Take the photo' }).click()
  // Wait for the shot to actually land. Until it does the submit is still
  // the capture control, so clicking straight through looks for a button
  // that does not exist yet — which passes on a fast run and fails once
  // enough specs have gone before it to slow the upload down.
  await expect(page.getByRole('button', { name: 'Retake' })).toBeVisible()
  await page.getByRole('button', { name: 'Start the day' }).click()
  await expect(page.getByRole('button', { name: /Log a visit/ })).toBeEnabled()
}

test.describe('the duty gate', () => {
  test('visit logging is locked until the day is started', async ({ page, loginAs }) => {
    await loginAs('rep')

    await expect(page.getByText('You have not started your day yet. Punch in to unlock your outlet list.')).toBeVisible()
    const logVisit = page.getByRole('button', { name: /Log a visit/ })
    await expect(logVisit).toBeDisabled()
    await expect(page.getByText('Locked until you start the day')).toBeVisible()
  })

  test('punching in unlocks the outlet list', async ({ page, loginAs, stubCamera }) => {
    await loginAs('rep')

    await clickStable(page.getByRole('button', { name: /Start the day/ }))
    await expect(page.getByRole('heading', { name: 'Start your day' })).toBeVisible()

    await page.getByPlaceholder('Kilometres on the meter').fill('12500')
    await stubCamera()
    await page.getByRole('button', { name: 'Take the photo' }).click()
    await expect(page.getByRole('button', { name: 'Retake' })).toBeVisible()

    await page.getByRole('button', { name: 'Start the day' }).click()

    await expect(page.getByText(/Nothing logged yet today/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Log a visit/ })).toBeEnabled()
  })

  /**
   * Closing the day is the one thing here that cannot be undone: no more
   * visits, no more expenses against it, and the distance is claimed as it
   * stands. It gets asked for.
   */
  test('closing the day is asked for, and saying no leaves it open', async ({ page, loginAs, stubCamera }) => {
    await loginAs('rep')
    await startDay(page, stubCamera)

    await clickStable(page.getByRole('button', { name: /End the day/ }))
    await expect(page.getByRole('heading', { name: 'End your day' })).toBeVisible()

    await page.getByPlaceholder('Kilometres on the meter').fill('12563')
    await stubCamera()
    await page.getByRole('button', { name: 'Take the photo' }).click()
    await expect(page.getByRole('button', { name: 'Retake' })).toBeVisible()

    // Submitting asks first, and says what it is about to claim.
    await page.getByRole('button', { name: 'End the day' }).click()
    await expect(page.getByText('End your day?')).toBeVisible()
    await expect(page.getByText(/63 km will be claimed/)).toBeVisible()

    // Backing out writes nothing — the day is still open behind the form.
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('End your day?')).toHaveCount(0)
    await page.getByRole('button', { name: '← Back' }).click()
    await expect(page.getByRole('button', { name: /Log a visit/ })).toBeEnabled()

    // And going through with it closes the day and shuts the visit gate.
    await clickStable(page.getByRole('button', { name: /End the day/ }))
    await page.getByPlaceholder('Kilometres on the meter').fill('12563')
    await stubCamera()
    await page.getByRole('button', { name: 'Take the photo' }).click()
    await expect(page.getByRole('button', { name: 'Retake' })).toBeVisible()
    await page.getByRole('button', { name: 'End the day' }).click()
    await page.getByRole('button', { name: 'End the day' }).last().click()

    await expect(page.getByText(/Your day is finished — 0 visits logged and 63 km travelled/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Log a visit/ })).toBeDisabled()
    await expect(page.getByText('Locked — you have punched out for the day')).toBeVisible()
  })

  /**
   * Reopening the app on an open day must never put the punch-in form in front
   * of the officer. It used to: the row rendered "Start the day" before the
   * session listener had answered, and the form it opened turned into the
   * closing one a moment later, with the button under their thumb changing
   * meaning. This pins the settled state; the screen itself now latches which
   * form it is, so a late answer is reported rather than applied.
   */
  test('reopening on an open day offers the closing form, never the opening one', async ({ page, loginAs, stubCamera }) => {
    await loginAs('rep')
    await startDay(page, stubCamera)

    await page.reload()

    await expect(page.getByRole('button', { name: /End the day/ })).toBeEnabled()
    await expect(page.getByRole('button', { name: /Start the day/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Log a visit/ })).toBeEnabled()

    await clickStable(page.getByRole('button', { name: /End the day/ }))
    await expect(page.getByRole('heading', { name: 'End your day' })).toBeVisible()
  })
})

test.describe('an outlet visit', () => {
  test('a visit cannot be closed without an outcome and real remarks', async ({ page, loginAs, stubCamera }) => {
    await loginAs('rep2')
    await startDay(page, stubCamera)

    await clickStable(page.getByRole('button', { name: /Log a visit/ }))
    await expect(page.getByRole('heading', { name: 'Which outlet?' })).toBeVisible()

    await clickStable(page.getByRole('button', { name: /Anand Stores/ }))
    await page.getByRole('button', { name: 'Punch in' }).click()
    await expect(page.getByRole('heading', { name: 'Anand Stores' })).toBeVisible()

    // Nothing filled in — the punch-out must refuse and say why.
    const punchOut = page.getByRole('button', { name: /Punch out of this outlet/ })
    await expect(punchOut).toBeDisabled()

    await page.getByPlaceholder(/At least 15 characters/).fill('Too short')
    await expect(punchOut).toBeDisabled()

    // CustomSelect is a div, not a <select> — its placeholder is rendered text.
    await page.getByText('Select the outcome').click()
    await page.getByText('Order booked', { exact: true }).click()
    await page.getByPlaceholder(/At least 15 characters/)
      .fill('Owner reordered the 72s pack and asked about the new mini pack.')

    await expect(punchOut).toBeEnabled()
    await punchOut.click()

    await expect(page.getByRole('heading', { name: 'Which outlet?' })).toBeVisible()
  })

  test('an outlet missing from the list can be added on the spot', async ({ page, loginAs, stubCamera }) => {
    await loginAs('rep')
    await startDay(page, stubCamera)

    await clickStable(page.getByRole('button', { name: /Log a visit/ }))
    await page.getByPlaceholder('Search by name or place').fill('Kumar Medicals')
    await expect(page.getByText('No outlets found')).toBeVisible()

    await page.getByRole('button', { name: 'Add an outlet' }).first().click()
    await expect(page.getByRole('heading', { name: 'Add an outlet' })).toBeVisible()

    await page.getByPlaceholder('Rajan Enterprises').fill('Kumar Medicals')
    await page.getByPlaceholder('10-digit mobile number').fill('9876543210')
    await page.getByPlaceholder('Koramangala').fill('Kaloor')
    await page.getByRole('button', { name: /Save retailer/ }).click()

    // Straight into the punch-in confirmation for the shop just added.
    await expect(page.getByRole('button', { name: 'Punch in' })).toBeVisible()
    await expect(page.getByText('Kumar Medicals').first()).toBeVisible()
  })

  test('a sales manager can work a day in the field like an officer', async ({ page, loginAs, isMobile }) => {
    await noOneOnDuty()
    await loginAs('manager')

    // Both halves of the job, and the team half is what they land on.
    await expect(page.getByRole('button', { name: 'Your team' })).toBeVisible()
    await page.getByRole('button', { name: 'Your day' }).click()

    // No vehicle, no meter, no explanation demanded. An officer is held to the
    // reading because it evidences a distance claim; a manager on a train is
    // not filing one.
    await clickStable(page.getByRole('button', { name: /Start the day/ }))
    await expect(page.getByRole('heading', { name: 'Start your day' })).toBeVisible()
    await page.getByText('I am not using a vehicle').click()
    await page.getByRole('button', { name: 'Start the day' }).click()

    await expect(page.getByRole('button', { name: /Log a visit/ })).toBeEnabled()

    // And the supervisor half is still one tap away.
    await page.getByRole('button', { name: 'Your team' }).click()
    if (isMobile) await page.getByRole('button', { name: 'Menu' }).click()
    await expect(page.locator('header').getByRole('button', { name: 'Team' })).toBeVisible()
  })

  test('a duplicate phone number is refused', async ({ page, loginAs, stubCamera }) => {
    await loginAs('rep')
    await startDay(page, stubCamera)

    await clickStable(page.getByRole('button', { name: /Log a visit/ }))
    await page.getByRole('button', { name: 'Add an outlet' }).first().click()

    await page.getByPlaceholder('Rajan Enterprises').fill('Copycat Stores')
    await page.getByPlaceholder('10-digit mobile number').fill('9000000002') // Anand Stores
    await page.getByPlaceholder('Koramangala').fill('Kaloor')
    await page.getByRole('button', { name: /Save retailer/ }).click()

    await expect(page.getByText(/already registered to Anand Stores/)).toBeVisible()
  })
})
