import { useState, useEffect } from 'react'
import { useTheme } from '../context/ThemeContext'
import { isInstalledWeb, isIOS, cameraIsVerifiable } from '../device/platform'
import {
  installOffer, subscribeToInstallOffer, promptToInstall, isInAppBrowser,
} from '../device/installPrompt'
import { GhostButton } from './ui'

/**
 * Getting the app onto a home screen.
 *
 * Three routes, and only one of them is a button:
 *
 *   · Chrome fires an install event and can do the asking itself
 *   · Safari on iOS fires nothing and offers no API, so the only thing that
 *     works is telling somebody where the Share button is
 *   · a link opened inside WhatsApp or Instagram cannot install at all, and
 *     says so rather than showing an offer that would do nothing
 *
 * The event is caught in device/installPrompt.ts at import time rather than
 * here, because Chrome fires it before React has mounted and never fires it
 * again — a listener added in an effect below would simply never see it.
 *
 * Dismissal is remembered. A banner that returns every morning is an
 * advertisement, and this is a suggestion.
 */

const DISMISSED = 'oc-install-dismissed'

export default function InstallHint() {
  const { t } = useTheme()

  const [offer, setOffer] = useState(installOffer())
  const [dismissed, setDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(DISMISSED) === '1')

  // The offer may already be in hand, or may arrive a moment from now.
  useEffect(() => subscribeToInstallOffer(() => setOffer(installOffer())), [])

  // The Android build is already an app; a copy on the home screen is done.
  if (cameraIsVerifiable() || isInstalledWeb() || dismissed) return null

  const embedded = isInAppBrowser()
  const ios = isIOS()

  // Chrome on a desktop or an unsupported browser gets no event and no
  // instructions worth giving, so it gets nothing rather than a dead button.
  if (!offer && !ios && !embedded) return null

  const close = () => {
    setDismissed(true)
    try { localStorage.setItem(DISMISSED, '1') } catch { /* private mode */ }
  }

  return (
    <div style={{
      background: t.tint, borderRadius: 6, padding: '14px 16px',
      margin: '0 20px 4px',
    }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: t.text }}>
        Put Ocealgo on your home screen
      </div>
      <div style={{ fontSize: 13, color: t.text3, marginTop: 3, lineHeight: 1.5 }}>
        {embedded
          // The commonest way to receive a link is also the one place this
          // cannot be done, so it says which browser to move to.
          ? ios
            ? 'You have opened this inside another app, which cannot install it. Tap the ⋯ menu and choose "Open in Safari" first, then Share → Add to Home Screen.'
            : 'You have opened this inside another app, which cannot install it. Tap the ⋯ menu and choose "Open in Chrome" first, then use its Install option.'
          : ios
            ? 'Tap Share at the bottom of Safari, then "Add to Home Screen". It opens full screen, without the browser bar.'
            : 'It opens full screen, without the browser bar, and starts from your icon.'}
      </div>

      <div className="oc-wrap" style={{ gap: 10, marginTop: 12 }}>
        {offer && !embedded && (
          <GhostButton onClick={async () => { await promptToInstall(); close() }}>
            Install
          </GhostButton>
        )}
        <GhostButton onClick={close}>Not now</GhostButton>
      </div>
    </div>
  )
}
