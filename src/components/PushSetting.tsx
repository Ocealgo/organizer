import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { enablePush, disablePush, pushSupported, pushState, PushState } from '../device/push'
import { isIOS, isInstalledWeb, canScheduleReminders } from '../device/platform'
import { Section, GhostButton, Note } from './ui'

/**
 * Turning notifications on, from a tap.
 *
 * It has to be a tap. iOS refuses the permission prompt unless it comes from a
 * real gesture, and Chrome counts asking on page load against the origin — so
 * this lives on the account screen behind a button rather than firing at
 * somebody the first time they open the app.
 *
 * It is also the only honest place to say what will and will not arrive.
 * There are three configurations and they are not equal: the Android build
 * schedules its own reminder locally and needs none of this; an installed web
 * app receives whatever the server sends; a Safari tab receives nothing at all
 * until it is added to the home screen, which is a sentence somebody has to
 * read or they will simply think the switch is broken.
 */
export default function PushSetting() {
  const { appUser } = useAuth()
  const { t } = useTheme()

  const [supported, setSupported] = useState<boolean | null>(null)
  const [state, setState] = useState<PushState>(pushState())
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => { void pushSupported().then(setSupported) }, [])

  // The Android build has its own notifications and does not use web push.
  if (canScheduleReminders()) {
    return (
      <Section label="Notifications">
        <div style={{ fontSize: 14, color: t.text3, lineHeight: 1.6 }}>
          On. The app handles these itself, including the reminder to close your day.
        </div>
      </Section>
    )
  }

  const iosInTab = isIOS() && !isInstalledWeb()

  return (
    <Section label="Notifications">
      {iosInTab ? (
        <Note>
          On an iPhone, notifications only work once Ocealgo is on your home screen.
          Tap Share at the bottom of Safari, then “Add to Home Screen”, and turn them
          on from there.
        </Note>
      ) : supported === false ? (
        <div style={{ fontSize: 14, color: t.text3, lineHeight: 1.6 }}>
          This browser cannot receive notifications. On an iPhone they need iOS 16.4 or
          later and the app added to your home screen; a private window never gets them.
        </div>
      ) : state === 'granted' ? (
        <div>
          <div style={{ fontSize: 14, color: t.text, lineHeight: 1.6 }}>
            On for this device. You will be told when your leave or expenses are
            answered, and reminded at 6pm if your day is still open.
          </div>
          <div style={{ marginTop: 12 }}>
            <GhostButton disabled={busy} onClick={async () => {
              setBusy(true); setNote(null)
              await disablePush()
              setState('default')
              setNote('Off for this device. Your phone may still list Ocealgo under its own notification settings.')
              setBusy(false)
            }}>
              {busy ? 'Turning off…' : 'Turn off on this device'}
            </GhostButton>
          </div>
        </div>
      ) : state === 'denied' ? (
        <Note tone="warn">
          Notifications are blocked for Ocealgo in this browser, so the app cannot ask
          again — it has to be changed in the browser's own site settings for this
          address, then reloaded.
        </Note>
      ) : (
        <div>
          <div style={{ fontSize: 14, color: t.text3, lineHeight: 1.6 }}>
            Get told when your leave or expenses are answered, and a nudge at 6pm if
            you are still punched in. Each device is separate — turning it on here
            does nothing for your other phone.
          </div>
          <div style={{ marginTop: 12 }}>
            <GhostButton disabled={busy || !appUser} onClick={async () => {
              if (!appUser) return
              setBusy(true); setNote(null)
              const result = await enablePush(appUser.uid)
              setState(result)
              if (result === 'denied') setNote('Your browser refused. You can change that in its settings for this site.')
              if (result === 'unsupported') setNote('This device cannot receive them.')
              setBusy(false)
            }}>
              {busy ? 'Asking…' : 'Turn on notifications'}
            </GhostButton>
          </div>
        </div>
      )}

      {note && (
        <div style={{ fontSize: 13, color: t.text3, marginTop: 10, lineHeight: 1.6 }}>{note}</div>
      )}
    </Section>
  )
}
