import { getMessaging, getToken, isSupported, deleteToken } from 'firebase/messaging'
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { app, db } from '../firebase'
import { platform } from './platform'

/**
 * Getting a push notification onto a phone that is not running the app.
 *
 * The app already decides what is worth telling somebody — every one of those
 * decisions writes an `alerts` document addressed with `toUid` or
 * `toRole: 'admin_group'`. Until now that collection had exactly one delivery
 * mechanism: a bell that only works if you already have the app open, which is
 * precisely when you do not need telling.
 *
 * So nothing here decides what to send. A Cloud Function watches `alerts` and
 * pushes what is already there; this side only obtains permission and keeps a
 * token where that function can find it.
 *
 * What this cannot do is schedule anything. There is no web API that fires a
 * notification at six in the evening with the app closed — Chrome trialled one
 * and withdrew it — so the end-of-day reminder is sent by a scheduled function
 * rather than set by the phone. The Android build still schedules its own
 * locally and does not need any of this.
 */

const TOKENS = 'push_tokens'

export type PushState = 'unsupported' | 'default' | 'granted' | 'denied'

/**
 * Whether this browser can receive a push at all.
 *
 * False in every private window, in browsers without the Push API, and on iOS
 * in a Safari tab — there, push arrives only once the app has been added to
 * the home screen, and only on iOS 16.4 or later. That is worth saying out
 * loud rather than leaving somebody to wonder why the switch does nothing.
 */
export async function pushSupported(): Promise<boolean> {
  try {
    if (!('Notification' in window)) return false
    if (!('serviceWorker' in navigator)) return false
    return await isSupported()
  } catch {
    return false
  }
}

export function pushState(): PushState {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission as PushState
}

/**
 * Ask, then register.
 *
 * Must be called from a real tap. iOS refuses the permission prompt outright
 * unless it comes from a user gesture, and Chrome holds it against the origin
 * if it is asked for on load — which is also simply rude.
 */
export async function enablePush(uid: string): Promise<PushState> {
  if (!(await pushSupported())) return 'unsupported'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission as PushState

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY
  if (!vapidKey) {
    // Without the Web Push certificate from the Firebase console there is no
    // token to be had. Loud, because the failure is otherwise invisible.
    console.error('[push] VITE_FIREBASE_VAPID_KEY is not set — no token can be issued')
    return 'unsupported'
  }

  try {
    // The PWA's own worker, not a second one of Messaging's making. See sw.ts.
    const registration = await navigator.serviceWorker.ready
    const messaging = getMessaging(app)
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration })
    if (!token) return 'denied'

    // Keyed by the token itself, so re-registering the same device overwrites
    // rather than accumulating. A phone that is reinstalled issues a new token
    // and leaves a dead one behind; the sender prunes those when they fail.
    await setDoc(doc(db, TOKENS, token), {
      uid,
      token,
      platform: platform(),
      userAgent: navigator.userAgent.slice(0, 300),
      createdAt: Date.now(),
      lastSeenAt: serverTimestamp(),
    }, { merge: true })

    return 'granted'
  } catch (e) {
    console.error('[push] could not register for notifications', e)
    return 'denied'
  }
}

/** Stop this device receiving them, and take its token out of circulation. */
export async function disablePush(): Promise<void> {
  try {
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY
    const registration = await navigator.serviceWorker.ready
    const messaging = getMessaging(app)
    const token = vapidKey
      ? await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration })
      : null
    if (token) {
      await deleteDoc(doc(db, TOKENS, token)).catch(() => { /* already gone */ })
      await deleteToken(messaging)
    }
  } catch (e) {
    console.error('[push] could not unregister', e)
  }
}
