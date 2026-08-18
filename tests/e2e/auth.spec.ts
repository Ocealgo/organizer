import { test, expect } from './fixtures/app'
import { USERS, PASSWORD, UNKNOWN_PHONE, latestSmsCode } from './fixtures/seed'

/**
 * Who gets in, how they get back in, and what they land on.
 *
 * The status gate is the first thing between a stranger and the company's
 * trade data, so it is the first thing tested. Everything after it is about
 * recovery — the paths a rep uses on the worst day they have with this app.
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
    await page.getByPlaceholder(/^your password$/i).fill(PASSWORD)
    await page.getByRole('button', { name: /^sign in$/i }).click()

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
    await page.getByPlaceholder(/^your password$/i).fill('not-the-password')
    await page.getByRole('button', { name: /^sign in$/i }).click()

    await expect(page.getByText(`${USERS.rep.name} · Offline sales`)).toHaveCount(0)
  })

  test('signing out returns to the login screen', async ({ page, loginAs, isMobile }) => {
    await loginAs('rep')
    if (isMobile) await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('button', { name: /^sign out$/i }).click()
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
  })
})

test.describe('the same account, either username', () => {
  // Reps mostly know their number and not their email. Both doors open the
  // same account with the same password — the number is resolved to an email
  // by a Cloud Function, because that map may not sit anywhere a stranger can
  // read it.
  test('a rep signs in with their mobile number instead of their email', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder('you@example.com').fill(USERS.rep.phone)
    await page.getByPlaceholder(/^your password$/i).fill(PASSWORD)
    await page.getByRole('button', { name: /^sign in$/i }).click()

    // The same uid and the same role as the email door opens. A lookup that
    // landed on a different account would look almost identical right up until
    // none of the rep's own data was there.
    await expect(page.getByText(`${USERS.rep.name} · Offline sales`)).toBeVisible()
  })

  test('a number nobody registered is refused', async ({ page }) => {
    await page.goto('/')
    await page.getByPlaceholder('you@example.com').fill(UNKNOWN_PHONE)
    await page.getByPlaceholder(/^your password$/i).fill(PASSWORD)
    await page.getByRole('button', { name: /^sign in$/i }).click()

    await expect(page.getByText(/do not match an account/i)).toBeVisible()
  })

  test('an unknown number and a wrong password are indistinguishable', async ({ page }) => {
    // Two different failures must read identically, or this screen becomes a
    // way to find out which numbers belong to staff.
    const message = async (identifier: string, password: string) => {
      await page.goto('/')
      await page.getByPlaceholder('you@example.com').fill(identifier)
      await page.getByPlaceholder(/^your password$/i).fill(password)
      await page.getByRole('button', { name: /^sign in$/i }).click()
      return (await page.getByText(/do not match an account/i).textContent()) ?? ''
    }

    const unknownNumber = await message(UNKNOWN_PHONE, PASSWORD)
    const wrongPassword = await message(USERS.rep.phone, 'not-the-password')
    expect(unknownNumber).toBe(wrongPassword)
  })
})

/**
 * The code does not exist the instant the button is clicked — the send is
 * still in flight. Waiting for the code box is the app telling us the SMS has
 * gone; reading the emulator any earlier just races it.
 */
async function codeSentTo(page: import('@playwright/test').Page, phone: string) {
  await expect(page.getByPlaceholder('123456')).toBeVisible()
  return latestSmsCode(phone)
}

test.describe('forgetting a password', () => {
  const NEW_PASSWORD = 'Rebuilt99!'

  async function resetByCode(page: import('@playwright/test').Page) {
    await page.goto('/')
    await page.getByRole('button', { name: /forgotten your password/i }).click()
    await page.getByPlaceholder('you@example.com').fill(USERS.rep.phone)
    await page.getByRole('button', { name: /^continue$/i }).click()

    await page.getByPlaceholder('123456').fill(await codeSentTo(page, USERS.rep.phone))
    await page.getByRole('button', { name: /^continue$/i }).click()

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
    await page.getByPlaceholder(/^your password$/i).fill(NEW_PASSWORD)
    await page.getByRole('button', { name: /^sign in$/i }).click()
    await expect(page.getByText(`${USERS.rep.name} · Offline sales`)).toBeVisible()
  })

  test('the old password stops working once it has been changed', async ({ page }) => {
    await resetByCode(page)

    await page.getByPlaceholder('you@example.com').fill(USERS.rep.email)
    await page.getByPlaceholder(/^your password$/i).fill(PASSWORD)
    await page.getByRole('button', { name: /^sign in$/i }).click()

    await expect(page.getByText(`${USERS.rep.name} · Offline sales`)).toHaveCount(0)
  })

  test('an email address is offered a link instead of a code', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /forgotten your password/i }).click()
    await page.getByPlaceholder('you@example.com').fill(USERS.rep.email)
    await page.getByRole('button', { name: /^continue$/i }).click()

    await expect(page.getByRole('heading', { name: 'Link sent' })).toBeVisible()
  })

  test('an address nobody uses is answered exactly the same way', async ({ page }) => {
    // Anything else turns this box into a way to test who has an account.
    await page.goto('/')
    await page.getByRole('button', { name: /forgotten your password/i }).click()
    await page.getByPlaceholder('you@example.com').fill('nobody@ocealgo.test')
    await page.getByRole('button', { name: /^continue$/i }).click()

    await expect(page.getByRole('heading', { name: 'Link sent' })).toBeVisible()
  })
})

test.describe('a password reset by somebody else', () => {
  /** Open the Team screen, whichever way this viewport hides it. */
  async function openTeam(page: import('@playwright/test').Page, isMobile: boolean) {
    if (isMobile) await page.getByRole('button', { name: 'Menu' }).click()
    await page.locator('header').getByRole('button', { name: 'Team' }).click()
    await page.getByRole('tab', { name: /Active/ }).click().catch(() => {})
    await page.getByRole('button', { name: /^Active/ }).click().catch(() => {})
  }

  /**
   * One person's card. Scoped to the list's direct children — filtering every
   * div on the page by name matches ancestors that hold the whole list, and
   * the innermost match holds only the name and none of the buttons.
   */
  const cardFor = (page: import('@playwright/test').Page, name: string) =>
    page.locator('.oc-list-flush > div').filter({ hasText: name })

  /**
   * Leave, properly.
   *
   * Firebase Auth persists per browser context, so reloading the page keeps
   * whoever was signed in signed in. Reaching the login form after acting as
   * an admin means actually leaving, not navigating.
   */
  async function signOut(page: import('@playwright/test').Page, isMobile: boolean) {
    if (isMobile) await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('button', { name: /^sign out$/i }).click()
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
  }

  /** Reset a rep's password from the Team screen and return what to read out. */
  async function resetFromTeam(page: import('@playwright/test').Page, isMobile: boolean) {
    await openTeam(page, isMobile)

    await cardFor(page, USERS.rep.name).getByRole('button', { name: 'Reset password' }).click()
    await page.getByRole('button', { name: 'Reset it' }).click()

    const shown = page.getByText(new RegExp(`Read this to ${USERS.rep.name}`))
    await expect(shown).toBeVisible()
    const text = (await shown.textContent()) ?? ''
    const match = text.match(/([a-z]+-[a-z]+-\d{4})/)
    expect(match, `no temporary password in: ${text}`).toBeTruthy()
    await page.getByRole('button', { name: /^OK$/ }).click()
    return match![1]
  }

  test('an admin resets a rep and the rep gets in on what they were read', async ({ page, loginAs, isMobile }) => {
    await loginAs('admin')
    const temporary = await resetFromTeam(page, isMobile)

    // A password read down a phone line is known to two people, so the app
    // stops the rep until they have replaced it.
    await signOut(page, isMobile)
    await page.getByPlaceholder('you@example.com').fill(USERS.rep.email)
    await page.getByPlaceholder(/^your password$/i).fill(temporary)
    await page.getByRole('button', { name: /^sign in$/i }).click()

    await expect(page.getByRole('heading', { name: /Choose your own password/i })).toBeVisible()
    await expect(page.getByText('Trade')).toHaveCount(0)
  })

  test('the rep is let through once they have chosen their own', async ({ page, loginAs, isMobile }) => {
    await loginAs('admin')
    const temporary = await resetFromTeam(page, isMobile)

    await signOut(page, isMobile)
    await page.getByPlaceholder('you@example.com').fill(USERS.rep.email)
    await page.getByPlaceholder(/^your password$/i).fill(temporary)
    await page.getByRole('button', { name: /^sign in$/i }).click()

    await page.getByPlaceholder('The one you were read').fill(temporary)
    await page.getByPlaceholder('At least six characters').fill('Chosen123!')
    await page.getByPlaceholder('Type it again').fill('Chosen123!')
    await page.getByRole('button', { name: /save and carry on/i }).click()

    await expect(page.getByText(`${USERS.rep.name} · Offline sales`)).toBeVisible()
  })

  test('a sales manager cannot reset an admin', async ({ page, loginAs, isMobile }) => {
    await loginAs('manager')
    await openTeam(page, isMobile)

    // The positive control comes first. Asserting only the absence would pass
    // just as happily if the list had failed to render at all.
    await expect(
      cardFor(page, USERS.rep.name).getByRole('button', { name: 'Reset password' }),
    ).toBeVisible()

    // The function refuses it regardless; not drawing the button is how the
    // screen stops offering something it knows will be turned down.
    await expect(
      cardFor(page, USERS.admin.name).getByRole('button', { name: 'Reset password' }),
    ).toHaveCount(0)
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
