import { Capacitor } from '@capacitor/core'
import { Device } from '@capacitor/device'

/**
 * Battery level at punch-in and punch-out (spec §2.1).
 *
 * The point of recording it is that a phone which dies at 11am explains a
 * missing afternoon, and a phone that was at 4% when the day started explains
 * a patchy location trace. It is context for the audit, not a gate.
 *
 * On web the Battery Status API has been removed from Safari and Firefox, so
 * this returns undefined there rather than pretending. Only the native build
 * reports it reliably.
 */
export async function batteryPercent(): Promise<number | undefined> {
  try {
    if (Capacitor.isNativePlatform()) {
      const info = await Device.getBatteryInfo()
      return info.batteryLevel === undefined
        ? undefined
        : Math.round(info.batteryLevel * 100)
    }

    const nav = navigator as any
    if (typeof nav.getBattery === 'function') {
      const battery = await nav.getBattery()
      return Math.round(battery.level * 100)
    }
  } catch {
    // Never let a diagnostic reading block a punch-in.
  }
  return undefined
}
