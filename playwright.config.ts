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
      /**
       * Not a test project. Scripted rep journeys whose output is the video —
       * phone-sized, because that is what a rep holds, and paced for a viewer
       * rather than for speed. Run it with `npm run walkthroughs`; `npm run e2e`
       * names its two projects explicitly so this never runs by accident.
       */
      name: 'walkthrough',
      testDir: './tests/walkthroughs',
      outputDir: './tests/walkthroughs/clips',
      use: {
        // A phone-sized viewport, but NOT Playwright's mobile emulation: with
        // isMobile on, the recorder writes a frame taller than the page it
        // paints, leaving a grey strip across the bottom of every clip. The
        // app's phone layout keys off viewport width, so 412px gets the same
        // rendering without the artefact.
        viewport: { width: 412, height: 915 },
        deviceScaleFactor: 1,
        // A rep watching this should see the app working, not apologising for a
        // permission the recorder never granted.
        permissions: ['geolocation'],
        geolocation: { latitude: 9.9312, longitude: 76.2673, accuracy: 12 },
        locale: 'en-IN',
        timezoneId: 'Asia/Kolkata',
        video: { mode: 'on', size: { width: 412, height: 915 } },
        trace: 'off',
        screenshot: 'off',
        actionTimeout: 20_000,
      },
      timeout: 180_000,
    },
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
