import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

/**
 * The end-of-day reminder.
 *
 * A forgotten punch-out costs the officer their distance claim for the day and
 * leaves the odometer chain with a hole, and the person it happens to is by
 * definition not looking at the app. So the reminder has to survive the app
 * being closed — an in-app banner only reaches someone who already opened it.
 *
 * Local notifications need no server: one is scheduled when the day is punched
 * in and cancelled when it is punched out. Nothing here is allowed to throw —
 * a denied permission or a web build must never stop someone starting work.
 */

/** One officer per device, so a fixed id is enough to schedule and cancel. */
const REMINDER_ID = 1

/** Local hour at which an officer still on duty gets nudged. */
export const REMINDER_HOUR = 18

/** Local hour past which an unclosed day is swept up as abandoned. */
export const AUTO_CLOSE_HOUR = 23

const available = () =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LocalNotifications')

/** Today's reminder time, or null when that moment has already passed. */
function reminderAt(now = new Date()): Date | null {
  const at = new Date(now)
  at.setHours(REMINDER_HOUR, 0, 0, 0)
  return at.getTime() > now.getTime() ? at : null
}

/**
 * Ask once, at punch-in, when the reason for asking is on screen. A refusal is
 * final and simply means no reminder — never an error the officer has to clear.
 */
async function permitted(): Promise<boolean> {
  try {
    const current = await LocalNotifications.checkPermissions()
    if (current.display === 'granted') return true
    if (current.display === 'denied') return false
    const asked = await LocalNotifications.requestPermissions()
    return asked.display === 'granted'
  } catch {
    return false
  }
}

/** Schedule the nudge for 18:00 today. A day started after that gets none. */
export async function scheduleEndOfDayReminder(): Promise<void> {
  if (!available()) return
  try {
    const at = reminderAt()
    if (!at) return
    if (!(await permitted())) return

    // Cancel first: a second punch-in on the same device must not stack.
    await cancelEndOfDayReminder()
    await LocalNotifications.schedule({
      notifications: [{
        id: REMINDER_ID,
        title: 'End your day',
        body: 'You are still punched in. Record your closing meter reading before you finish.',
        schedule: { at },
      }],
    })
  } catch (e) {
    console.error('[notify] could not schedule the end-of-day reminder', e)
  }
}

/** Drop the nudge — the day was closed, or closed for them. */
export async function cancelEndOfDayReminder(): Promise<void> {
  if (!available()) return
  try {
    await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] })
  } catch (e) {
    console.error('[notify] could not cancel the end-of-day reminder', e)
  }
}
