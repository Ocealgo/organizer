import { test as base, expect, Page } from '@playwright/test'
import { resetWorld, seedWorld, USERS, PASSWORD, UserKey } from '../../e2e/fixtures/seed'

/**
 * The walkthrough recorder.
 *
 * These are not tests. They are scripted journeys whose only output is the
 * video, so they assert almost nothing and instead spend their time being
 * legible: captions naming each step, and pauses long enough for a first-time
 * viewer to read the screen before it changes.
 *
 * They are recorded at phone size because that is what a rep actually holds.
 *
 * The point of scripting them rather than screen-recording by hand is that they
 * can be re-recorded. When a screen changes, you re-run the script instead of
 * booking somebody to re-shoot twelve minutes of footage.
 */

/** How long a caption stays up before the next action. */
const READ_MS = 2200
/** A shorter pause between steps inside one screen. */
const BEAT_MS = 700

export interface DemoFixtures {
  /** Sign in as a seeded account, silently — the login is its own walkthrough. */
  signIn: (who: UserKey) => Promise<void>
  /** Put a caption on screen and hold it long enough to read. */
  say: (text: string, holdMs?: number) => Promise<void>
  /** A short pause, for when an action needs room to land. */
  beat: (ms?: number) => Promise<void>
  /** Answer the camera's file picker with a real photo. */
  stubCamera: () => Promise<void>
}

const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
)

const CAPTION_ID = '__oc_caption'

/**
 * The caption lives in the page rather than being burned in afterwards, so the
 * raw .webm is already usable without an editor. pointer-events:none keeps it
 * from ever intercepting a click the script means for the app.
 */
async function showCaption(page: Page, text: string) {
  await page.evaluate(([id, msg]) => {
    let el = document.getElementById(id)
    if (!el) {
      el = document.createElement('div')
      el.id = id
      Object.assign(el.style, {
        position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '2147483647',
        padding: '14px 18px calc(14px + env(safe-area-inset-bottom, 0px))',
        background: 'rgba(6,10,15,0.92)',
        borderTop: '0.5px solid rgba(255,255,255,0.14)',
        color: '#f1f5f9', font: "500 15px/1.45 'Trebuchet MS', sans-serif",
        letterSpacing: '0.005em', pointerEvents: 'none',
        transition: 'opacity .18s ease',
      } as CSSStyleDeclaration)
      document.body.appendChild(el)
    }
    el.textContent = msg
    el.style.opacity = '1'
  }, [CAPTION_ID, text] as const)
}

export const test = base.extend<DemoFixtures>({
  signIn: async ({ page }, use) => {
    await use(async (who: UserKey) => {
      const u = USERS[who]
      await page.goto('/')
      await page.getByPlaceholder('you@example.com').fill(u.email)
      await page.getByPlaceholder(/password/i).first().fill(PASSWORD)
      await page.getByRole('button', { name: /sign in/i }).click()
      await expect(page.getByText('Loading Ocealgo')).toHaveCount(0)
      await page.waitForTimeout(BEAT_MS)
    })
  },

  say: async ({ page }, use) => {
    await use(async (text: string, holdMs = READ_MS) => {
      await showCaption(page, text)
      await page.waitForTimeout(holdMs)
    })
  },

  beat: async ({ page }, use) => {
    await use(async (ms = BEAT_MS) => { await page.waitForTimeout(ms) })
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

export { expect }
export type { Page }
