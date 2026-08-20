import { Capacitor } from '@capacitor/core'

/**
 * What this copy of the app can and cannot enforce.
 *
 * There are three ways somebody ends up running Ocealgo, and they are not
 * equivalent — which matters, because one of them cannot enforce the thing the
 * odometer photo exists for.
 *
 *   · the Android build — a real camera, a real scheduled reminder
 *   · installed from the browser on iPhone — neither
 *   · a browser tab — neither, and no icon on the home screen
 *
 * There is no iOS build. Reps carrying iPhones install the web app, so the
 * middle row is a real working configuration for real people rather than a
 * degraded edge case, and the app says out loud what it cannot do there rather
 * than letting a gallery photo pass as evidence of a meter reading.
 */

export type Platform = 'android_app' | 'installed_web' | 'browser'

/** Running from a home-screen icon rather than a browser tab. */
export function isInstalledWeb(): boolean {
  if (Capacitor.isNativePlatform()) return false
  if (typeof window === 'undefined') return false
  // Safari on iOS reports `navigator.standalone`; everyone else answers the
  // display-mode media query the manifest asked for.
  const iosStandalone = (window.navigator as any).standalone === true
  const displayMode = window.matchMedia?.('(display-mode: standalone)').matches === true
  return iosStandalone || displayMode
}

export function platform(): Platform {
  if (Capacitor.isNativePlatform()) return 'android_app'
  return isInstalledWeb() ? 'installed_web' : 'browser'
}

/**
 * Whether a photo taken here can be trusted to have come from a live camera.
 *
 * Only the native build can say yes. `CameraSource.Camera` gives no gallery to
 * escape into; a browser file input always does, whatever `capture` hints at,
 * and on a desktop it is simply a file picker. Every photo this returns false
 * for is stored with `fromLiveCamera: false` and should be shown as such
 * wherever somebody is judging it.
 */
export function cameraIsVerifiable(): boolean {
  return Capacitor.isNativePlatform()
}

/** Whether a reminder can be scheduled to fire with the app closed. */
export function canScheduleReminders(): boolean {
  return Capacitor.isNativePlatform()
}

/** True on an iPhone or iPad, where installing is a Safari-only manual step. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    || (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1)
}
