import { test, expect } from './fixtures/app'
import { testDate } from './fixtures/clock'
import {
  companyAllocation, companyStock, noAllocations, noTargetsSet, packetTarget, todayLocal,
  addProduct,
} from './fixtures/seed'

/**
 * A monthly packet target, and the two places it has to agree with itself.
 *
 * A manager sets it on the planner; the rep sees their own progress on their
 * home screen; the report reads it for the team. All three count the same way
 * — packets on orders placed this month, cancellations off — through one
 * helper, because a target that means one thing on one screen and something
 * else on the next is worse than no target.
 *
 * The count is derived from the orders every time rather than accumulated, and
 * the cancellation test below is the one that proves why: nothing has to
 * remember to subtract.
 */

/**
 * Both stated out loud, immediately before they are needed.
 *
 * The wipe between specs cannot drop a write that has not landed yet, and both
 * of these are the kind that bites quietly: a leftover target turns Set into
 * Update, and a leftover order makes a settled count read high for reasons
 * nothing on the screen explains.
 */
test.beforeEach(async () => {
  await noTargetsSet()
  await noAllocations()
})

/**
 * A day of this month that can actually carry a target.
 *
 * Sundays cannot: the division skips them and the day grid draws no box for
 * them. Anything asserting on a specific day has to pick one that exists, or
 * it passes six days a week and fails on the seventh — which is how both of
 * these were written the first time.
 */
/**
 * The next day a target may be set for.
 *
 * Forward to the first non-Sunday, which on a Sunday is tomorrow. "Today" is
 * not a safe stand-in: a Sunday has no box at all, because the division never
 * offers one and the grid draws only the days it offers.
 */
/** A date this many days back, for asserting on days that have gone. */
function dayBefore(n: number): string {
  const d = testDate()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function aSettableDay(): string {
  const d = testDate()
  while (d.getDay() === 0) d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function openPlannerTargets(page: any) {
  await page.getByRole('button', { name: /^The week/ }).first().click()
  await expect(page.getByRole('heading', { name: 'The week' })).toBeVisible()
  await page.getByRole('button', { name: 'Targets', exact: true }).click()
}

test.describe('setting a target', () => {
  test('a manager sets one and it reads back', async ({ page, loginAs }) => {
    await loginAs('manager')
    await openPlannerTargets(page)

    // Addressed by name, not by position. Two reps are seeded and they sort
    // alphabetically, so "the first box" is Priya and the orders below belong
    // to Ravi — a test that works by position tests the wrong person.
    await page.getByLabel('Baby Wet Wipes 72s packets for Ravi Rep').fill('2000')
    await page.getByRole('button', { name: 'Set target for Ravi Rep' }).click()

    await expect(page.getByText(/0 of 2000 packets ordered/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Update target for Ravi Rep' })).toBeVisible()
  })

  /** A target somebody sets for themselves is not a target, it is an intention. */
  test('a rep is not offered the planner at all', async ({ page, loginAs }) => {
    await loginAs('rep')
    await expect(page.getByRole('button', { name: /^The week/ })).toHaveCount(0)
  })

  test('a whole number or nothing', async ({ page, loginAs }) => {
    await loginAs('manager')
    await openPlannerTargets(page)

    await page.getByLabel('Baby Wet Wipes 72s packets for Ravi Rep').fill('12.5')
    await page.getByRole('button', { name: 'Set target for Ravi Rep' }).click()

    await expect(page.getByText(/packets has to be a whole number/)).toBeVisible()
  })
})

test.describe('progress against it', () => {
  /**
   * Placing the order is what counts, and it counts straight away — before
   * anything is dispatched and long before anything is paid. That is the point
   * of measuring the rep on the part they control.
   */
  test('an order counts the moment it is placed, and the rep sees it', async ({
    page, loginAs, asAlso,
  }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()   // pending: never dispatched, never paid

    await loginAs('manager')
    await openPlannerTargets(page)
    await page.getByLabel('Baby Wet Wipes 72s packets for Ravi Rep').fill('100')
    await page.getByRole('button', { name: 'Set target for Ravi Rep' }).click()

    await expect(page.getByText(/24 of 100 packets ordered/)).toBeVisible()

    const repPage = await asAlso('rep')
    // The card leads with today, and nobody gave today a figure — so it says
    // so, rather than drawing "0 of 0" that reads as a target already missed.
    // The month sits underneath as context, and the order counts there.
    await expect(repPage.getByText('No target for today')).toBeVisible()
    await expect(repPage.getByText('This month · 24 of 100 packets')).toBeVisible()
  })

  /**
   * The reason the figure is worked out from the orders rather than kept as a
   * running total: cancelling takes the packets back out on its own, and no
   * code path has to remember to do it.
   */
  test('a cancelled order takes its packets back out', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()
    await companyAllocation({ status: 'cancelled' })

    await loginAs('manager')
    await openPlannerTargets(page)
    await page.getByLabel('Baby Wet Wipes 72s packets for Ravi Rep').fill('100')
    await page.getByRole('button', { name: 'Set target for Ravi Rep' }).click()

    // 48 packets were ordered; one order of 24 was cancelled.
    await expect(page.getByText(/24 of 100 packets ordered/)).toBeVisible()
    await expect(page.getByText(/1 cancelled, not counted/)).toBeVisible()
  })

  /**
   * The day's figure is the rep's, not the beat's, and needs no beat at all.
   *
   * That is the whole point of moving it: a rep sent to a shop off their round
   * still owes the day's packets, so a target fixed to the beat stops applying
   * exactly when the day stops going to plan.
   */
  test('a day target shows with no beat assigned at all', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()
    await packetTarget('rep', todayLocal().slice(0, 7), 1000, { [todayLocal()]: 80 })

    await loginAs('rep')
    await expect(page.getByText('This month · 24 of 1000 packets')).toBeVisible()
    await expect(page.getByText('Today · 24 of 80 packets')).toBeVisible()
  })

  /** A day nobody set has no line, rather than a line reading zero. */
  test('a day with nothing set shows no day line', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()
    await packetTarget('rep', todayLocal().slice(0, 7), 1000, { '2020-01-02': 80 })

    await loginAs('rep')
    await expect(page.getByText('This month · 24 of 1000 packets')).toBeVisible()
    await expect(page.getByText(/^Today ·/)).toHaveCount(0)
  })
})

test.describe('a target per product', () => {
  /**
   * The total is the sum and nothing else, which is what stops two numbers
   * disagreeing about one month.
   */
  test('the month total is the sum of the products', async ({ page, loginAs }) => {
    await loginAs('manager')
    await openPlannerTargets(page)

    await page.getByLabel('Baby Wet Wipes 72s packets for Ravi Rep').fill('600')
    await page.getByLabel('Baby Wet Wipes 30s packets for Ravi Rep').fill('400')

    // Said before it is saved, so a manager can see what they have built.
    await expect(page.getByText('1000 packets for the month, across 2 products')).toBeVisible()

    await page.getByRole('button', { name: 'Set target for Ravi Rep' }).click()
    await expect(page.getByText(/0 of 1000 packets ordered/)).toBeVisible()
  })

  /** An order counts against its own product, not against all of them. */
  test('an order lands on the product it was for', async ({ page, loginAs, asAlso }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()   // 24 packets of prod_wipes
    await packetTarget('rep', todayLocal().slice(0, 7), 1000,
      { [todayLocal()]: 38 }, { prod_wipes: 600, prod_mini: 400 })

    await loginAs('manager')
    await openPlannerTargets(page)

    // 24 against the wipes. "0 ordered" is not asserted here: both officers
    // have both products, so three boxes read zero and the locator would be
    // ambiguous for a reason that has nothing to do with the test. The
    // rep-side assertion below covers the untouched product precisely.
    await expect(page.getByText('24 ordered')).toBeVisible()

    // And the rep is told the split they are working to, with today's share of
    // each worked out from the month rather than stored.
    const repPage = await asAlso('rep')
    await expect(repPage.getByText('Baby Wet Wipes 72s')).toBeVisible()
    // Today's share of a 38-packet day: 600 and 400 come to 22.8 and 15.2,
    // and the spare packet goes to the larger fraction — 23 and 15. The order
    // was 24 of the 72s, so that product is already over today and the other
    // has not started.
    await expect(repPage.getByText('24 / 23 today')).toBeVisible()
    await expect(repPage.getByText('0 / 15 today')).toBeVisible()
  })

  /**
   * A day's per-product figures have to add up to the day, which floor
   * division does not do: 600 and 400 of 38 are 22.8 and 15.2, and flooring
   * both gives 37.
   */
  test('the day splits without losing a packet', async ({ page, loginAs }) => {
    await packetTarget('rep', todayLocal().slice(0, 7), 1000,
      { [todayLocal()]: 38 }, { prod_wipes: 600, prod_mini: 400 })

    await loginAs('rep')
    await expect(page.getByText('Today · 0 of 38 packets')).toBeVisible()
    // 23 and 15 — the spare packet goes to the larger fraction, not nowhere.
    await expect(page.getByText(/23 today/)).toBeVisible()
    await expect(page.getByText(/15 today/)).toBeVisible()
  })

  /** A target set before products existed keeps working, unchanged. */
  test('a target with no breakdown still reads as a total', async ({ page, loginAs }) => {
    await companyStock('prod_wipes', 500)
    await companyAllocation()
    await packetTarget('rep', todayLocal().slice(0, 7), 1000, { [todayLocal()]: 80 })

    await loginAs('rep')
    await expect(page.getByText('This month · 24 of 1000 packets')).toBeVisible()
    // No breakdown stored, so none is invented.
    await expect(page.getByText(/ \/ 600/)).toHaveCount(0)
  })
})

test.describe('each product has its own days', () => {
  /**
   * The point of the change: two products do not move together, so each one
   * carries its own figures and a day is their sum rather than a number split
   * after the fact.
   */
  test('a day reads each product separately, and the total is their sum', async ({
    page, loginAs,
  }) => {
    // Today, not the last workable day: the rep's card shows today and
    // nothing else. A day set by hand carries its target whatever weekday it
    // is — only dividing skips Sundays, because only dividing has to choose.
    const day = todayLocal()
    await packetTarget('rep', day.slice(0, 7), 1000, undefined,
      { prod_wipes: 600, prod_mini: 400 },
      { prod_wipes: { [day]: 30 }, prod_mini: { [day]: 8 } })

    await loginAs('rep')
    // 30 and 8, not a 38 shared out by month share — which would have been
    // 23 and 15.
    await expect(page.getByText(/30 today/)).toBeVisible()
    await expect(page.getByText(/8 today/)).toBeVisible()
    await expect(page.getByText('Today · 0 of 38 packets')).toBeVisible()
  })

  /** One press divides every product by its own month, not the total once. */
  test('dividing fills every product, each by its own figure', async ({ page, loginAs }) => {
    await loginAs('manager')
    await openPlannerTargets(page)

    await page.getByLabel('Baby Wet Wipes 72s packets for Ravi Rep').fill('600')
    await page.getByLabel('Baby Wet Wipes 30s packets for Ravi Rep').fill('400')
    await page.getByRole('button', { name: 'Set target for Ravi Rep' }).click()

    await page.getByRole('button', { name: 'Day by day for Ravi Rep' }).click()
    await page.getByRole('button', { name: 'Divide equally for Ravi Rep' }).click()

    // Both products carry their own month, and the line above the grid counts
    // every product rather than the one on screen.
    await expect(page.getByText('1000 across the days')).toBeVisible()
    await expect(page.getByRole('button', { name: /Days for Baby Wet Wipes 72s, Ravi Rep/ }))
      .toBeVisible()

    await page.getByRole('button', { name: 'Save days for Ravi Rep' }).click()
    await expect(page.getByText('1000 across the days')).toBeVisible()
  })

  /**
   * A product added later needs no code to follow it. Nothing names a product
   * anywhere — the chips, the boxes and the division all come off the products
   * collection.
   */
  test('a product added later gets its own column', async ({ page, loginAs }) => {
    await addProduct('prod_jumbo', 'Baby Wet Wipes 120s')

    await loginAs('manager')
    await openPlannerTargets(page)

    // A monthly box of its own, straight away.
    await expect(page.getByLabel('Baby Wet Wipes 120s packets for Ravi Rep')).toBeVisible()

    // And a day grid of its own, without anybody adding one.
    await page.getByRole('button', { name: 'Day by day for Ravi Rep' }).click()
    await expect(page.getByRole('button', { name: /Days for Baby Wet Wipes 120s, Ravi Rep/ }))
      .toBeVisible()
  })

  /** A target from before per-product days keeps working, unchanged. */
  test('a day figure with no product breakdown still reads', async ({ page, loginAs }) => {
    const day = todayLocal()
    await packetTarget('rep', day.slice(0, 7), 1000, { [day]: 38 },
      { prod_wipes: 600, prod_mini: 400 })

    await loginAs('rep')
    // No per-product days stored, so the old proportional split answers: 23
    // and 15 of the 38.
    await expect(page.getByText('Today · 0 of 38 packets')).toBeVisible()
    await expect(page.getByText(/23 today/)).toBeVisible()
    await expect(page.getByText(/15 today/)).toBeVisible()
  })
})

test.describe('a target can only be set forwards', () => {
  /**
   * A figure written onto a day somebody has already worked is not a target,
   * it is a mark awarded afterwards — and the only thing that makes a daily
   * target worth anything is that the rep knew it before the day began.
   */
  test('a day already gone cannot be changed, but can be read', async ({ page, loginAs }) => {
    const gone = dayBefore(3)
    await packetTarget('rep', gone.slice(0, 7), 1000, undefined,
      { prod_wipes: 600, prod_mini: 400 },
      { prod_wipes: { [gone]: 44 } })

    await loginAs('manager')
    await openPlannerTargets(page)
    await page.getByRole('button', { name: 'Day by day for Ravi Rep' }).click()
    // The chips open on the alphabetically first product — the 30s — and the
    // day above was seeded against the 72s. One grid is on screen at a time,
    // so the product has to be chosen before its days can be read.
    await page.getByRole('button', { name: /Days for Baby Wet Wipes 72s, Ravi Rep/ }).click()

    const past = page.getByLabel(`Packets for Ravi Rep on ${gone}`)
    // Still on screen, and still carrying its figure: a month missing its
    // earlier days would stop adding up to itself.
    await expect(past).toHaveValue('44')
    await expect(past).toHaveAttribute('readonly', '')

    await expect(page.getByText(/Days already gone are shown but cannot be changed/))
      .toBeVisible()
  })

  test('today can still be set', async ({ page, loginAs }) => {
    await loginAs('manager')
    await openPlannerTargets(page)
    await page.getByRole('button', { name: 'Day by day for Ravi Rep' }).click()

    // The next day that can carry one. Today qualifies on a weekday; on a
    // Sunday there is no box, because a Sunday is never offered a target.
    const now = page.getByLabel(`Packets for Ravi Rep on ${aSettableDay()}`)
    await expect(now).not.toHaveAttribute('readonly', '')
    await now.fill('42')
    await expect(now).toHaveValue('42')
  })

  /** Dividing fills what is ahead, and says how many days that is. */
  test('dividing only covers the days still to come', async ({ page, loginAs }) => {
    await loginAs('manager')
    await openPlannerTargets(page)

    await page.getByLabel('Baby Wet Wipes 72s packets for Ravi Rep').fill('600')
    await page.getByRole('button', { name: 'Set target for Ravi Rep' }).click()
    await page.getByRole('button', { name: 'Day by day for Ravi Rep' }).click()

    // The button counts the days it can write, not the days in the month.
    const label = await page.getByRole('button', { name: 'Divide equally for Ravi Rep' })
      .textContent()
    const ahead = Number(/across (\d+) days/.exec(label ?? '')?.[1])
    const stated = /(\d+) of (\d+) days are still ahead/.exec(
      (await page.getByText(/days are still ahead/).textContent()) ?? '')
    expect(ahead).toBe(Number(stated?.[1]))
    // Mid-month those two differ; at the start of one they do not.
    expect(ahead).toBeLessThanOrEqual(Number(stated?.[2]))
  })
})

test.describe('dividing a month across its days', () => {
  test('equal division fills the days and adds up to the month', async ({
    page, loginAs, asAlso,
  }) => {
    await loginAs('manager')
    await openPlannerTargets(page)

    await page.getByLabel('Baby Wet Wipes 72s packets for Ravi Rep').fill('1000')
    await page.getByRole('button', { name: 'Set target for Ravi Rep' }).click()

    // By name, not by position: the reps sort alphabetically, so the first
    // panel on the screen is Priya's and the assertions below are Ravi's.
    await page.getByRole('button', { name: 'Day by day for Ravi Rep' }).click()
    await page.getByRole('button', { name: 'Divide equally for Ravi Rep' }).click()

    // The remainder goes somewhere rather than being dropped, so the days
    // still add up to the month they came from.
    await expect(page.getByText('1000 across the days')).toBeVisible()
    await page.getByRole('button', { name: 'Save days for Ravi Rep' }).click()

    // It survives the write: the row still reads the same total back from the
    // document rather than from the boxes. Today's own figure is not asserted
    // here — a Sunday has none, by design — and the split landing on a day is
    // covered by the test below, which picks a day that can carry one.
    await expect(page.getByText('1000 across the days')).toBeVisible()

    const repPage = await asAlso('rep')
    await expect(repPage.getByText('This month · 0 of 1000 packets')).toBeVisible()
  })

  test('a day can be changed away from the even split', async ({ page, loginAs }) => {
    // Still ahead, or the box is read-only and there is nothing to change.
    const day = aSettableDay()
    await packetTarget('rep', day.slice(0, 7), 1000, { [day]: 38 })

    await loginAs('manager')
    await openPlannerTargets(page)
    await page.getByRole('button', { name: 'Day by day for Ravi Rep' }).click()

    await page.getByLabel(`Packets for Ravi Rep on ${day}`).fill('120')
    await page.getByRole('button', { name: 'Save days for Ravi Rep' }).click()

    // Said out loud, because a breakdown that no longer adds up to its month is
    // a decision rather than a mistake — but only if somebody can see it.
    await expect(page.getByText(/under the month by 880/)).toBeVisible()
  })

  test('there is nothing to divide without a month figure', async ({ page, loginAs }) => {
    await loginAs('manager')
    await openPlannerTargets(page)

    await page.getByRole('button', { name: 'Day by day for Priya Rep' }).click()
    await page.getByRole('button', { name: 'Divide equally for Priya Rep' }).click()

    await expect(page.getByText(/there is nothing to divide/)).toBeVisible()
  })

  /** Nothing set means nothing shown. A card reading "0 of 0" is noise. */
  test('a rep with no target sees no card', async ({ page, loginAs }) => {
    await loginAs('rep')
    await expect(page.getByText(/This month ·/)).toHaveCount(0)
  })
})
