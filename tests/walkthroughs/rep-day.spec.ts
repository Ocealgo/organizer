import { test } from './fixtures/demo'

/**
 * A rep's day, in the order they live it. One clip per journey, so a trainer
 * can play just the part somebody is stuck on.
 *
 * The narration that goes with each of these is in NARRATION.md, step for step.
 */

test('01 signing in', async ({ page, say, beat }) => {
  await page.goto('/')
  await say('This is the Ocealgo app. Sign in with the email your admin set up for you.', 3000)

  await page.getByPlaceholder('you@example.com').click()
  await page.getByPlaceholder('you@example.com').type('rep@ocealgo.test', { delay: 45 })
  await beat()
  await page.getByPlaceholder(/password/i).first().type('Passw0rd!', { delay: 45 })
  await say('Tap Show if you want to check what you typed.', 1800)
  await page.getByRole('button', { name: /sign in/i }).click()
  await beat(1200)

  await say('The first line always tells you what today looks like. Right now: you have not started your day.', 3600)
  await say('Today holds the three things you do every day — start the day, log a visit, add an expense.', 3600)
  await page.mouse.wheel(0, 320)
  await say('Trade is your network, your allocations, stock and the credit book.', 3000)
  await page.mouse.wheel(0, 320)
  await say('Yours is your own record — everything you have logged, your leave, your expense reports.', 3400)
})

test('02 starting your day', async ({ page, signIn, say, beat, stubCamera }) => {
  await signIn('rep')
  await say('Nothing unlocks until you punch in. Start with Start the day.', 3000)

  await page.getByRole('button', { name: /Start the day/ }).click()
  await beat(1000)
  await say('Your location is recorded in the background. If it cannot be found, you can still carry on.', 3400)
  await say('First, tell the app about your vehicle meter.', 2400)
  await beat()

  await page.getByPlaceholder('Kilometres on the meter').click()
  await page.getByPlaceholder('Kilometres on the meter').type('12500', { delay: 90 })
  await say('Type the opening reading exactly as it shows on the meter.', 2800)

  await stubCamera()
  await page.getByRole('button', { name: 'Take the photo' }).click()
  await beat(1200)
  await say('Then photograph it. The number has to be readable in the photo — this is what proves your distance.', 3800)

  await page.getByRole('button', { name: 'Start the day' }).click()
  await beat(1200)
  await say('That is it. Your outlet list is now unlocked and your day has started.', 3200)
})

test('03 visiting an outlet', async ({ page, signIn, say, beat, stubCamera }) => {
  await signIn('rep')
  // Punch in off-camera; journey 2 already covers it.
  await page.getByRole('button', { name: /Start the day/ }).click()
  await page.getByPlaceholder('Kilometres on the meter').fill('12500')
  await stubCamera()
  await page.getByRole('button', { name: 'Take the photo' }).click()
  await page.getByRole('button', { name: 'Start the day' }).click()
  await beat(1000)

  await say('With your day open, tap Log a visit.', 2400)
  await page.getByRole('button', { name: /Log a visit/ }).click()
  await beat(1200)

  await say('Your outlets are sorted by how close they are to you right now.', 3000)
  await page.getByRole('button', { name: /Anand Stores/ }).click()
  await beat(900)
  await say('It tells you how far you are from where the shop is registered. It never stops you — it is only recorded.', 3800)
  await page.getByRole('button', { name: 'Punch in' }).click()
  await beat(1400)

  await say('You are now inside the visit. Start with what is on their shelf.', 3000)
  const qty = page.locator('input[type="number"]').first()
  await qty.click()
  await qty.type('18', { delay: 110 })
  await beat(900)

  await page.mouse.wheel(0, 300)
  await say('Note any competitor brand you can see, and its price if it is on the pack.', 3200)
  await page.getByRole('button', { name: 'Add a competitor' }).click()
  await beat(600)
  await page.getByPlaceholder('Brand').type('Rival Soft', { delay: 70 })
  await page.getByPlaceholder('₹/pack').type('55', { delay: 90 })
  await beat(900)

  await page.mouse.wheel(0, 320)
  await say('If they ordered, switch Book an order on and the order is raised for you.', 3400)
  await page.getByRole('button', { name: /Book an order/ }).click()
  await beat(700)

  await page.mouse.wheel(0, 320)
  await say('Every visit needs an outcome. This is the part your manager reads.', 3200)
  await page.getByText('Select the outcome').click()
  await beat(700)
  await page.getByText('Order booked', { exact: true }).click()
  await beat(700)

  await page.getByPlaceholder(/At least 15 characters/).click()
  await page.getByPlaceholder(/At least 15 characters/)
    .type('Owner reordered the 72s pack and asked about the mini pack.', { delay: 22 })
  await say('Write what was actually said. Fifteen characters is the minimum, not the target.', 3400)

  await page.mouse.wheel(0, 320)
  await beat()
  await page.getByRole('button', { name: /Punch out of this outlet/ }).click()
  await beat(1400)
  await say('Punched out. On to the next shop.', 2600)
})

test('04 adding a shop', async ({ page, signIn, say, beat, stubCamera }) => {
  await signIn('rep')
  await page.getByRole('button', { name: /Start the day/ }).click()
  await page.getByPlaceholder('Kilometres on the meter').fill('12500')
  await stubCamera()
  await page.getByRole('button', { name: 'Take the photo' }).click()
  await page.getByRole('button', { name: 'Start the day' }).click()
  await beat(1000)

  await page.getByRole('button', { name: /Log a visit/ }).click()
  await beat(1000)
  await say('Walked into a shop that is not on your list? You do not have to go anywhere else.', 3400)

  await page.getByPlaceholder('Search by name or place').type('Kumar Medicals', { delay: 60 })
  await beat(1200)
  await say('Search first, so you do not add a shop that is already there under another spelling.', 3400)

  await page.getByRole('button', { name: 'Add an outlet' }).first().click()
  await beat(1000)
  await say('Just enough to start visiting them. The full address can be filled in later from Network.', 3600)

  await page.getByPlaceholder('Rajan Enterprises').type('Kumar Medicals', { delay: 55 })
  await beat(500)
  await page.getByPlaceholder('10-digit mobile number').type('9876543210', { delay: 70 })
  await beat(500)
  await page.getByPlaceholder('Koramangala').type('Kaloor', { delay: 70 })
  await say('The shop is registered where you are standing, so the next visit knows where it is.', 3400)

  await page.getByRole('button', { name: /Save retailer/ }).click()
  await beat(1600)
  await say('Saved, and you are straight into punching in. No trip back to the office.', 3200)
})

test('05 logging expenses', async ({ page, signIn, say, beat }) => {
  await signIn('rep')
  await say('Expenses live under Yours, in Expense reports.', 2600)
  await page.getByRole('button', { name: /Expense reports/ }).click()
  await beat(1200)

  await say('One week at a time. Each working day gets a daily allowance and anything you spent.', 3600)
  await page.getByRole('button', { name: 'Add the daily allowance' }).first().click()
  await beat(800)
  await say('HQ, EX or OS — pick the one that matches how far you travelled.', 3000)
  await page.getByRole('button', { name: /^HQ/ }).first().click()
  await beat(1200)

  await page.getByRole('button', { name: 'Add an expense' }).first().click()
  await beat(900)
  await say('For anything else, pick what it was for and enter the amount.', 3000)
  await page.getByRole('button', { name: 'Bus fare', exact: true }).click()
  await beat(500)
  await page.getByPlaceholder('45').type('60', { delay: 90 })
  await beat(600)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await beat(1200)

  await say('When the week is done, submit it. An admin reviews it and clears it.', 3400)
  await page.mouse.wheel(0, 600)
  await beat(1000)
  await say('Had no expenses at all? Say so. A blank week just looks like you forgot.', 3600)
})

test('06 ending your day', async ({ page, signIn, say, beat, stubCamera }) => {
  await signIn('rep')
  await page.getByRole('button', { name: /Start the day/ }).click()
  await page.getByPlaceholder('Kilometres on the meter').fill('12500')
  await stubCamera()
  await page.getByRole('button', { name: 'Take the photo' }).click()
  await page.getByRole('button', { name: 'Start the day' }).click()
  await beat(1200)

  await say('At the end of the day, come back and close it off.', 2800)
  await page.getByRole('button', { name: /End the day/ }).click()
  await beat(1000)

  await page.getByPlaceholder('Kilometres on the meter').type('12563', { delay: 90 })
  await say('The closing reading. The app works out your distance from the two numbers.', 3400)
  await stubCamera()
  await page.getByRole('button', { name: 'Take the photo' }).click()
  await beat(1200)

  await page.getByRole('button', { name: 'End the day' }).click()
  await beat(1600)
  await say('Done — 63 km recorded. If you forget this, the day claims no distance at all, so make it a habit.', 4200)
})
