import { test, expect } from './fixtures/app'
import { USERS, PASSWORD } from './fixtures/seed'

/**
 * Who gets in, and what they land on.
 *
 * The status gate is the first thing between a stranger and the company's
 * trade data, so it is the first thing tested.
 */

test.describe('signing in', () => {
  test('a rep lands on their own field screen, not the dashboard', async ({ page, loginAs }) => {
    await loginAs('rep')
    await expect(page.getByText(`${USERS.rep.name} · Offline sales`)).toBeVisible()
    await expect(page.getByRole('heading', { name: /needs you today/i })).toHaveCount(0)
  })

  test('an admin lands on the dashboard', async ({ page, loginAs }) => {
    await loginAs('admin')
    await expect(page.getByText('Needs you today')).toBeVisible()
  })

  test('a pending account is held at the door', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder('you@example.com').fill(USERS.pending.email)
    await page.getByPlaceholder(/password/i).first().fill(PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()

    // Held on the status screen, told why, and given a way back out. The gate
    // is only real if none of the app leaks past it.
    await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible()
    await expect(page.getByText(/An admin has to approve your account/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await expect(page.getByText('Needs you today')).toHaveCount(0)
    await expect(page.getByText('Trade')).toHaveCount(0)
  })

  test('a wrong password does not sign anyone in', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder('you@example.com').fill(USERS.rep.email)
    await page.getByPlaceholder(/password/i).first().fill('not-the-password')
    await page.getByRole('button', { name: /sign in/i }).click()

    await expect(page.getByText(`${USERS.rep.name} · Offline sales`)).toHaveCount(0)
  })

  test('signing out returns to the login screen', async ({ page, loginAs, isMobile }) => {
    await loginAs('rep')
    if (isMobile) await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('button', { name: /^sign out$/i }).click()
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
  })
})

test.describe('what each role may open', () => {
  test('a rep has no Team link — user management is not theirs', async ({ page, loginAs, isMobile }) => {
    await loginAs('rep')
    if (isMobile) await page.getByRole('button', { name: 'Menu' }).click()
    await expect(page.locator('header').getByRole('button', { name: 'Team' })).toHaveCount(0)
  })

  test('a manager on the shipped defaults can see the team', async ({ page, loginAs, isMobile }) => {
    await loginAs('manager')
    if (isMobile) await page.getByRole('button', { name: 'Menu' }).click()
    await expect(page.locator('header').getByRole('button', { name: 'Team' })).toBeVisible()
  })
})
