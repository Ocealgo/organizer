import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end runs against the Firebase emulator suite.
 *
 * `webServer` starts the emulators and the Vite dev server together, in test
 * mode, so a run needs nothing set up by hand and can never touch a real
 * project — `.env.test` carries a `demo-` project id and the SDKs refuse to
 * leave the machine for one of those.
 *
 * Video is on for every test, not just failures: the same recordings are the
 * raw material for the end-user walkthroughs, and a walkthrough that only
 * exists when a test fails is no use to anybody.
 */
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/e2e/.artifacts',
  fullyParallel: false,        // one emulator, one world — specs reseed serially
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: { mode: 'on', size: { width: 1280, height: 800 } },
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // The app is phone-first and most of its users are on one. Anything that
      // only passes at 1280px has not been tested.
      name: 'mobile',
      use: { ...devices['Pixel 7'], isMobile: true, hasTouch: true },
    },
  ],

  webServer: {
    command: 'npm run e2e:server',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
