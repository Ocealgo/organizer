/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { initializeApp } from 'firebase/app'
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw'

/**
 * The one service worker.
 *
 * There can only be usefully one at the root scope, and two things want it:
 * the PWA, which precaches the app shell, and Firebase Messaging, which needs
 * somewhere to receive a push while the app is closed. Letting the plugin
 * generate its own and letting FCM register `firebase-messaging-sw.js` puts
 * two workers at `/` and the last one registered wins — so this file is both,
 * and `getToken` is handed this registration rather than being allowed to make
 * its own.
 *
 * Precaching covers the app and nothing else. Every screen reads live
 * Firestore listeners; a worker answering those from a cache would show a rep
 * yesterday's outstanding balance with no way to tell.
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// The config is inlined at build time, exactly as it is in the app — a service
// worker cannot read import.meta.env at runtime but Vite does substitute it.
const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
})

try {
  const messaging = getMessaging(app)

  /**
   * A push that arrives while the app is closed or backgrounded.
   *
   * Sent as a data-only message on purpose. A `notification` payload is
   * displayed by the browser itself before this runs, which on some platforms
   * means two notifications for one alert — one from the browser and one from
   * here. Data-only puts the decision in one place.
   */
  onBackgroundMessage(messaging, payload => {
    const title = payload.data?.title || 'Ocealgo'
    self.registration.showNotification(title, {
      body: payload.data?.body || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      // Same tag replaces rather than stacks, so five alerts about one week's
      // expenses do not become five rows in the shade.
      tag: payload.data?.tag || 'ocealgo',
      data: { url: payload.data?.url || '/' },
    })
  })
} catch (e) {
  // Messaging is unsupported in some browsers and every private window. The
  // app must still install and run offline without it.
  console.warn('[sw] messaging unavailable', e)
}

/** Tapping a notification focuses the open app rather than opening a second. */
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = (event.notification.data?.url as string) || '/'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = all.find(c => 'focus' in c)
    if (open) { await open.focus(); return }
    await self.clients.openWindow(url)
  })())
})

self.addEventListener('message', event => {
  // Sent by the update prompt when somebody chooses to take a new version.
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})
