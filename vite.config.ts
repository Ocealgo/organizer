import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),

    /**
     * Installable on a phone without an app store.
     *
     * Reps on Android get the native build, which is what enforces a live
     * camera on a compliance photo. Reps on iPhone cannot — there is no iOS
     * build — so they install this, and everything they photograph is marked
     * as unverifiable rather than quietly passing as evidence. See
     * `device/photo.ts` and the note on the duty screen.
     *
     * What is cached is the app itself and nothing else. Every screen here
     * reads live Firestore listeners, and a service worker that answered those
     * from a cache would show a rep yesterday's outstanding balance, or a
     * manager a stale visit count, with no way to tell. Firestore has its own
     * offline layer and it is the only thing that should be doing this.
     */
    VitePWA({
      registerType: 'prompt',
      // Registered from React by UpdatePrompt, so the 'new version ready'
      // state has somewhere to be shown rather than being applied silently.
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],

      manifest: {
        name: 'Ocealgo Field',
        short_name: 'Ocealgo',
        description: 'Ocealgo field sales — visits, orders, collections and expenses.',
        // The app is written phone-first and has its own header; a browser
        // chrome on top of it wastes a fifth of the screen.
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        background_color: '#0d1117',
        theme_color: '#0d3d2e',
        lang: 'en-IN',
        categories: ['business', 'productivity'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        // The build is well past the 2MB default — Recharts and the map alone
        // are a quarter of a megabyte, and both are split out and worth having
        // available offline once fetched.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Anything the app asks a server for at runtime is live data. None of
        // it is cacheable and the service worker must not try — a stale
        // balance is worse than no balance.
        navigateFallbackDenylist: [/^\/__/, /\/[^/?]+\.[^/]+$/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },

      devOptions: { enabled: false },
    }),
  ],
})
