import { useRegisterSW } from 'virtual:pwa-register/react'
import { useTheme } from '../context/ThemeContext'
import { GhostButton } from './ui'

/**
 * A new version is ready — said, not applied.
 *
 * The alternative is `autoUpdate`, which reloads the page the moment a deploy
 * lands. That is fine for a blog and wrong here: nothing rehydrates the visit
 * form, so a rep half way through counting a shelf when a release goes out
 * would watch the screen blank and their counts vanish. It has to be their
 * moment, not the deploy's.
 *
 * Sitting at the bottom rather than the top because it is never urgent — the
 * old version keeps working, and this can wait until they are between shops.
 */
export default function UpdatePrompt() {
  const { t } = useTheme()
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(e) { console.error('[pwa] service worker registration failed', e) },

    /**
     * Ask whether there is a new version, on the two occasions it matters.
     *
     * The browser only re-fetches the worker on a navigation, and an installed
     * app hardly ever navigates — people background it and resume it from the
     * switcher, which is not a page load. So a phone could sit on a build from
     * last week and never once look, which is exactly the case this whole
     * prompt exists for.
     *
     * Coming back to the foreground is the honest trigger: it is when somebody
     * has just picked the phone up, before they have started anything they
     * could lose. The hourly timer is only there for the app left open all day
     * on a desk.
     */
    onRegisteredSW(_url, registration) {
      if (!registration) return

      const check = () => { void registration.update().catch(() => { /* offline */ }) }

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      window.addEventListener('online', check)
      setInterval(check, 60 * 60 * 1000)
    },
  })

  if (!needRefresh) return null

  return (
    <div style={{
      position: 'fixed', left: 0, right: 0,
      bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
      zIndex: 1500, display: 'flex', justifyContent: 'center',
      padding: '0 20px', pointerEvents: 'none',
    }}>
      <div style={{
        pointerEvents: 'auto',
        width: '100%', maxWidth: 420,
        background: t.bg2, border: `0.5px solid ${t.border2}`,
        borderRadius: 8, padding: '14px 16px',
      }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: t.text }}>
          A new version is ready
        </div>
        <div style={{ fontSize: 13, color: t.text3, marginTop: 3, lineHeight: 1.5 }}>
          Finish what you are doing first — this one keeps working until you reload.
        </div>
        <div className="oc-wrap" style={{ gap: 10, marginTop: 12 }}>
          <GhostButton onClick={() => updateServiceWorker(true)}>Reload now</GhostButton>
          <GhostButton onClick={() => setNeedRefresh(false)}>Later</GhostButton>
        </div>
      </div>
    </div>
  )
}
