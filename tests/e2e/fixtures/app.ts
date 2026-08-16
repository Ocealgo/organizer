import { test as base, expect, Page } from '@playwright/test'
import { resetWorld, seedWorld, USERS, PASSWORD, UserKey } from './seed'

/**
 * The shared harness.
 *
 * Every spec gets a freshly wiped and reseeded emulator, so specs can run in
 * any order and a failure never poisons the next one. That costs a second or
 * two per test and buys the ability to trust a red run.
 */

export interface AppFixtures {
  /** Sign in as one of the seeded accounts and wait for the app to settle. */
  loginAs: (who: UserKey) => Promise<void>
  /**
   * A second person, in their own browser context.
   *
   * Firebase Auth persists per browser context, not per tab — two pages in one
   * context share a session, so signing in the second user silently signs the
   * first one out. Any spec covering a hand-off (rep submits, admin reviews)
   * needs genuinely separate contexts.
   */
  asAlso: (who: UserKey) => Promise<Page>
  /** Hand the next file-picker dialog a real JPEG — the web camera fallback. */
  stubCamera: () => Promise<void>
}

/** A 2×2 JPEG. Small enough to inline, real enough for createImageBitmap. */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
)

export const test = base.extend<AppFixtures>({
  // Geolocation is recorded on punch-in and punch-out. A fixed fix keeps the
  // distances in assertions stable.
  contextOptions: async ({ contextOptions }, use) => {
    await use({
      ...contextOptions,
      permissions: ['geolocation'],
      geolocation: { latitude: 9.9312, longitude: 76.2673, accuracy: 12 },
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
    })
  },

  page: async ({ page }, use) => {
    // A console error in the app is a test failure waiting to happen, so they
    // are collected and surfaced rather than lost in the browser.
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    await use(page)
    if (errors.length) {
      // Attached rather than thrown: the assertion that already failed is the
      // more useful signal, and this explains it.
      // eslint-disable-next-line no-console
      console.error('[page errors]\n' + errors.join('\n'))
    }
  },

  loginAs: async ({ page }, use) => {
    await use(async (who: UserKey) => {
      const u = USERS[who]
      await page.goto('/')
      await page.getByPlaceholder('you@example.com').fill(u.email)
      await page.getByPlaceholder(/password/i).first().fill(PASSWORD)
      await page.getByRole('button', { name: /sign in/i }).click()
      // The shell only renders once the user document has resolved.
      await expect(page.getByText('Ocealgo').first()).toBeVisible()
      await expect(page.getByText('Loading Ocealgo')).toHaveCount(0)
    })
  },

  asAlso: async ({ browser, baseURL }, use) => {
    const opened: import('@playwright/test').BrowserContext[] = []
    await use(async (who: UserKey) => {
      const ctx = await browser.newContext({
        baseURL,
        permissions: ['geolocation'],
        geolocation: { latitude: 9.9312, longitude: 76.2673, accuracy: 12 },
        locale: 'en-IN',
        timezoneId: 'Asia/Kolkata',
      })
      opened.push(ctx)
      const p = await ctx.newPage()
      const u = USERS[who]
      await p.goto('/')
      await p.getByPlaceholder('you@example.com').fill(u.email)
      await p.getByPlaceholder(/password/i).first().fill(PASSWORD)
      await p.getByRole('button', { name: /sign in/i }).click()
      await expect(p.getByText('Loading Ocealgo')).toHaveCount(0)
      return p
    })
    for (const ctx of opened) await ctx.close()
  },

  stubCamera: async ({ page }, use) => {
    await use(async () => {
      page.once('filechooser', async (chooser) => {
        await chooser.setFiles({
          name: 'odometer.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG,
        })
      })
    })
  },
})

test.beforeEach(async () => {
  await resetWorld()
  await seedWorld()
})

/**
 * Click something that a late-arriving snapshot may re-render underneath you.
 *
 * Several screens paint from static state and then re-render as their Firestore
 * listeners resolve, which detaches the node Playwright had already resolved.
 * Playwright retries a detached click, but on a cold emulator the churn can
 * outlast a single action timeout. Retrying the whole resolve-and-click is the
 * honest fix; raising the timeout only makes the flake slower.
 */
export async function clickStable(locator: import('@playwright/test').Locator) {
  await expect(async () => {
    await locator.click({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

export { expect }
export type { Page }
