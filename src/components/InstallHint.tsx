import { useState, useEffect } from 'react'
import { useTheme } from '../context/ThemeContext'
import { isInstalledWeb, isIOS, cameraIsVerifiable } from '../device/platform'
import { GhostButton } from './ui'

/**
 * Getting the app onto a home screen, and saying what that does and does not
 * buy you.
 *
 * Android fires `beforeinstallprompt` and the browser can do the asking. iOS
 * fires nothing at all — Safari only installs through Share → Add to Home
 * Screen, and there is no API to trigger it — so on an iPhone the only thing
 * that works is telling somebody where the button is. Hence two paths that
 * look like one feature.
 *
 * Dismissal is remembered. A banner that returns every morning is an
 * advertisement, and this is a suggestion.
 */

const DISMISSED = 'oc-install-dismissed'

export default function InstallHint() {
  const { t } = useTheme()
  const [prompt, setPrompt] = useState<any>(null)
  const [showIOS, setShowIOS] = useState(false)
  const [dismissed, setDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(DISMISSED) === '1')

  useEffect(() => {
    // The Android app has its own icon already; only the browser needs this.
    if (isInstalledWeb() || cameraIsVerifiable()) return
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  useEffect(() => {
    // Nothing to offer on iOS but instructions, and only while it is still a
    // browser tab.
    if (isIOS() && !isInstalledWeb()) setShowIOS(true)
  }, [])

  if (dismissed || isInstalledWeb()) return null
  if (!prompt && !showIOS) return null

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
        {showIOS
          ? 'Tap Share at the bottom of Safari, then “Add to Home Screen”. It opens full screen, without the browser bar.'
          : 'It opens full screen, without the browser bar, and starts from your icon.'}
      </div>

      <div className="oc-wrap" style={{ gap: 10, marginTop: 12 }}>
        {prompt && (
          <GhostButton onClick={async () => {
            prompt.prompt()
            await prompt.userChoice
            setPrompt(null)
            close()
          }}>
            Install
          </GhostButton>
        )}
        <GhostButton onClick={close}>Not now</GhostButton>
      </div>
    </div>
  )
}
