/**
 * Catching the browser's install offer, which arrives before React does.
 *
 * Chrome fires `beforeinstallprompt` once, early — often before the app has
 * mounted. A listener added inside a component's effect therefore misses it,
 * and misses it permanently: the event is not re-fired for that page load, so
 * the install button simply never appears and nothing anywhere says why.
 *
 * So the listener is registered as a side effect of importing this module, and
 * `main.tsx` imports it before it renders anything. Whatever mounts later asks
 * this what it caught.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()

const announce = () => listeners.forEach(l => l())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    // Without this Chrome shows its own mini-infobar and the app never gets to
    // choose the moment.
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    announce()
  })

  window.addEventListener('appinstalled', () => {
    installed = true
    deferred = null
    announce()
  })
}

export function installOffer(): BeforeInstallPromptEvent | null {
  return deferred
}

export function wasInstalled(): boolean {
  return installed
}

export function subscribeToInstallOffer(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** Show the browser's own dialog. Returns true if they went through with it. */
export async function promptToInstall(): Promise<boolean> {
  if (!deferred) return false
  await deferred.prompt()
  const choice = await deferred.userChoice
  // One offer per page load — Chrome will not hand back the same event twice.
  deferred = null
  announce()
  return choice.outcome === 'accepted'
}

/**
 * Whether this is somebody else's browser embedded in an app.
 *
 * A link opened from WhatsApp, Instagram or Messenger runs in that app's own
 * web view, and none of them can install anything to a home screen — there is
 * no menu item for it and `beforeinstallprompt` never fires. Which is exactly
 * how most people receive a link, so "nothing happened" here is the common
 * case rather than an odd one, and it needs saying rather than leaving
 * somebody to conclude the app is broken.
 */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|MicroMessenger|Snapchat/i.test(ua)
    // Android web views identify themselves with a bare "wv" token, which is
    // what WhatsApp uses.
    || /\bwv\b/.test(ua)
}
