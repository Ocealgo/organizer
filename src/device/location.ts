import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { GeoPoint } from '../types'

/**
 * Position fixes for punch-in, punch-out and geofencing.
 *
 * The Capacitor plugin has a web implementation backed by navigator.geolocation,
 * so this same path works in `npm run dev` as well as on device.
 *
 * NOTE ON SPOOFING: GeoPoint carries an `isMock` flag, but neither the browser
 * nor @capacitor/geolocation reports Android's mock-provider bit. It stays
 * undefined until we adopt a plugin that surfaces it — the background
 * geolocation plugins do. Treat an unset `isMock` as "unknown", not "genuine".
 */

/**
 * Accuracy beyond this is noted on the record but never rejected. Location here
 * is captured, not enforced — a vague fix is still more use than none, and the
 * accuracy travels with it so a report can weigh it.
 */
export const DEFAULT_MAX_ACCURACY_M = 100

/**
 * Used only to describe how far an officer was from an outlet. Nothing is
 * blocked by it.
 */
export const DEFAULT_GEOFENCE_RADIUS_M = 130

export class LocationError extends Error {
  constructor(
    message: string,
    readonly kind: 'denied' | 'unavailable' | 'timeout' | 'inaccurate',
    readonly accuracy?: number,
  ) {
    super(message)
    this.name = 'LocationError'
  }
}

async function ensurePermission(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  const status = await Geolocation.checkPermissions()
  if (status.location === 'granted' || status.coarseLocation === 'granted') return
  const asked = await Geolocation.requestPermissions({ permissions: ['location'] })
  if (asked.location !== 'granted' && asked.coarseLocation !== 'granted') {
    throw new LocationError('Location permission was declined.', 'denied')
  }
}

/**
 * A single high-accuracy fix.
 *
 * Throws on permission, timeout or hardware failure. Pass `maxAccuracyM` to
 * also reject an imprecise fix; by default nothing is rejected on accuracy,
 * because the accuracy is recorded alongside the position anyway.
 */
export async function getFix(opts?: {
  timeoutMs?: number
  maxAccuracyM?: number
  capturedBy?: string
}): Promise<GeoPoint> {
  const timeout = opts?.timeoutMs ?? 15000
  const maxAccuracy = opts?.maxAccuracyM ?? Infinity

  await ensurePermission()

  let position
  try {
    position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout,
      maximumAge: 0, // a cached fix defeats the point of proving presence now
    })
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    if (/denied|permission/i.test(msg)) throw new LocationError('Location permission was declined.', 'denied')
    if (/timeout/i.test(msg)) throw new LocationError('Could not get a location in time. Move into the open and try again.', 'timeout')
    throw new LocationError('Location is unavailable on this device.', 'unavailable')
  }

  const accuracy = position.coords.accuracy ?? 9999
  if (accuracy > maxAccuracy) {
    throw new LocationError(
      `Location is only accurate to about ${Math.round(accuracy)}m. Move into the open and try again.`,
      'inaccurate',
      accuracy,
    )
  }

  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy,
    capturedAt: Date.now(),
    ...(opts?.capturedBy ? { capturedBy: opts.capturedBy } : {}),
  }
}

/**
 * Best-effort fix. Never throws and never blocks — returns null when the device
 * cannot supply a position. This is the one to use for punching in and out,
 * where a missing location should be recorded as missing rather than stopping
 * someone from working.
 */
export async function getFixOrNull(opts?: {
  timeoutMs?: number
  capturedBy?: string
}): Promise<GeoPoint | null> {
  try {
    return await getFix(opts)
  } catch (e) {
    console.warn('[location] no fix available', e)
    return null
  }
}

/** Great-circle distance in metres. */
export function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Total path length in kilometres for an ordered list of fixes. */
export function pathLengthKm(points: { lat: number; lng: number }[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distanceM(points[i - 1], points[i])
  return total / 1000
}

export interface GeofenceResult {
  within: boolean
  distanceM: number | null   // null when the outlet has no registered coordinates
  radiusM: number
}

/**
 * Is this fix close enough to the outlet to count as being there?
 * An outlet with no coordinates yet returns `within: true` — we cannot hold a
 * rep responsible for a geofence that was never drawn. The visit still records
 * where they were, which is how outlets get their coordinates in the first place.
 */
export function checkGeofence(
  fix: { lat: number; lng: number },
  outlet: { lat: number; lng: number } | null | undefined,
  radiusM: number = DEFAULT_GEOFENCE_RADIUS_M,
): GeofenceResult {
  if (!outlet) return { within: true, distanceM: null, radiusM }
  const d = distanceM(fix, outlet)
  return { within: d <= radiusM, distanceM: Math.round(d), radiusM }
}
