import { test, expect } from './fixtures/app'
import { USERS, PASSWORD, UNKNOWN_PHONE, latestSmsCode } from './fixtures/seed'

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

/**
 * The code does not exist the instant the button is clicked — the send is still
 * in flight. Waiting for the code box to appear is the app telling us the SMS
 * has gone; reading the emulator any earlier just races it.
 */
async function codeSentTo(page: import('@playwright/test').Page, phone: string) {
  await expect(page.getByPlaceholder('123456')).toBeVisible()
  return latestSmsCode(phone)
}

test.describe('signing in with a mobile number', () => {
  test('a rep gets in with a code instead of a password', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Mobile number' }).click()
    await page.getByPlaceholder('10-digit mobile number').fill(USERS.rep.phone)
    await page.getByRole('button', { name: /send code/i }).click()

    await page.getByPlaceholder('123456').fill(await codeSentTo(page, USERS.rep.phone))
    await page.getByRole('button', { name: /^sign in$/i }).click()

    // The same account as the email door opens, with the same role. A phone
    // sign-in that landed on a fresh uid would look almost identical here
    // right up until none of the rep's data was there.
    await expect(page.getByText(`${USERS.rep.name} · Offline sales`)).toBeVisible()
  })

  test('a number nobody registered is refused, and leaves no account behind', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Mobile number' }).click()
    await page.getByPlaceholder('10-digit mobile number').fill(UNKNOWN_PHONE)
    await page.getByRole('button', { name: /send code/i }).click()

    // The code still sends — Firebase will text any valid number. The refusal
    // happens after, which is the only place it can happen.
    await page.getByPlaceholder('123456').fill(await codeSentTo(page, UNKNOWN_PHONE))
    await page.getByRole('button', { name: /^sign in$/i }).click()

    await expect(page.getByText(/No account uses that number/i)).toBeVisible()
    await expect(page.getByText('Trade')).toHaveCount(0)

    // And the account Firebase created on the way through is gone again.
    const res = await fetch(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-ocealgo/accounts:query',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
        body: '{}',
      },
    )
    const { userInfo = [] } = await res.json() as { userInfo?: { phoneNumber?: string }[] }
    expect(userInfo.some(u => u.phoneNumber === `+91${UNKNOWN_PHONE}`)).toBe(false)
  })
})

test.describe('forgetting a password', () => {
  const NEW_PASSWORD = 'Rebuilt99!'

  /** Walk the reset to the end, leaving the account on NEW_PASSWORD. */
  async function resetByCode(page: import('@playwright/test').Page) {
    await page.goto('/')
    await page.getByRole('button', { name: /forgotten your password/i }).click()
    await page.getByPlaceholder('10-digit mobile number').fill(USERS.rep.phone)
    await page.getByRole('button', { name: /send code/i }).click()

    await page.getByPlaceholder('123456').fill(await codeSentTo(page, USERS.rep.phone))
    await page.getByRole('button', { name: /continue/i }).click()

    await page.getByPlaceholder('At least six characters').fill(NEW_PASSWORD)
    await page.getByPlaceholder('Type it again').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: /save password/i }).click()

    // Signed out again on purpose, so the new password gets used at least once
    // rather than being forgotten before it is ever typed.
    await expect(page.getByText(/Password changed/i)).toBeVisible()
  }

  test('a code to the registered number sets a new password', async ({ page }) => {
    await resetByCode(page)

    await page.getByPlaceholder('you@example.com').fill(USERS.rep.email)
    await page.getByPlaceholder(/password/i).first().fill(NEW_PASSWORD)
    await page.getByRole('button', { name: /^sign in$/i }).click()
    await expect(page.getByText(`${USERS.rep.name} · Offline sales`)).toBeVisible()
  })

  test('the old password stops working once it has been changed', async ({ page }) => {
    await resetByCode(page)

    await page.getByPlaceholder('you@example.com').fill(USERS.rep.email)
    await page.getByPlaceholder(/password/i).first().fill(PASSWORD)
    await page.getByRole('button', { name: /^sign in$/i }).click()

    await expect(page.getByText(`${USERS.rep.name} · Offline sales`)).toHaveCount(0)
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
