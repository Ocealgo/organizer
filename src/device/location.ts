import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { GeoPoint, LocationIssue } from '../types'

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
    readonly kind: LocationIssue,
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

/** A fix, or the reason there isn't one. Exactly one of the two is set. */
export interface LocationAttempt {
  fix: GeoPoint | null
  issue: LocationIssue | null
}

/**
 * Best-effort fix that says why it failed. Never throws and never blocks.
 *
 * This is the one to use for punching in and out, where a missing location is
 * recorded as missing rather than stopping someone from working.
 *
 * It replaced a version that returned the fix or `null`, which meant a declined
 * permission, a dead GPS chip, a timeout and a hopelessly vague reading all
 * reached the record as the same blank — `LocationError.kind` was worked out
 * carefully and then thrown away at every call site. A rep who had switched
 * location off was therefore indistinguishable, on every screen and in every
 * report, from a rep who spent the morning inside a concrete market. The first
 * is a conversation with a person and the second is a conversation with a
 * phone, so the two are kept apart.
 */
export async function getFixOrReason(opts?: {
  timeoutMs?: number
  capturedBy?: string
}): Promise<LocationAttempt> {
  try {
    return { fix: await getFix(opts), issue: null }
  } catch (e) {
    console.warn('[location] no fix available', e)
    // Anything that is not a LocationError got past getFix's own translation,
    // so the device is the honest thing to blame rather than the person.
    return { fix: null, issue: e instanceof LocationError ? e.kind : 'unavailable' }
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

/**
 * Beyond this, "nearby" stops being a fair word for it. A market street or a
 * wholesale complex easily spans a few hundred metres, so the middle band is
 * wide on purpose — the point is to separate "plausibly at work" from "worth
 * asking about", not to catch people out by a few paces.
 */
export const NEARBY_RADIUS_M = 500

export type ProximityKind = 'at_shop' | 'nearby' | 'away' | 'unsure' | 'no_pin'

export interface Proximity {
  kind: ProximityKind
  /** Ready to print. */
  label: string
  /** True only where somebody should actually look into it. */
  flag: boolean
}

const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`)

/**
 * Turn a raw distance into something a manager can act on.
 *
 * A bare "240 m from the shop" asks the reader to be a judge without giving
 * them the evidence, because **distance means nothing without the accuracy it
 * was measured at**. A fix that is 180 m out with ±8 m of error says the rep
 * was up the road. The same 180 m with ±200 m of error says nothing whatsoever
 * — the true position could be the doorstep. Reporting both the same way is
 * how somebody gets accused of something a phone made up.
 *
 * So the uncertainty gets its own verdict rather than being folded in. When
 * the error is as large as the finding, this says it cannot tell, which is the
 * honest answer and stops a manager reading a GPS wobble as a fake visit.
 *
 * Nothing here blocks anything. It is the same bargain the app makes
 * everywhere else with location: write down what was seen, name what was not,
 * and leave the judgement to a person.
 */
export function proximity(
  distanceM: number | null | undefined,
  accuracyM?: number,
  radiusM: number = DEFAULT_GEOFENCE_RADIUS_M,
): Proximity {
  if (distanceM === null || distanceM === undefined) {
    return { kind: 'no_pin', label: 'No registered position', flag: false }
  }

  // The uncertainty swallows the finding: anything from the doorstep to well
  // past it would produce this same reading, so there is no verdict to give.
  // Compared against the radius as well as the distance, because a ±200 m fix
  // cannot tell "at the shop" from "up the road" either.
  if (accuracyM !== undefined && accuracyM >= Math.max(distanceM, radiusM)) {
    return {
      kind: 'unsure',
      label: `Can't tell — GPS was ±${Math.round(accuracyM)} m`,
      flag: false,
    }
  }

  if (distanceM <= radiusM) return { kind: 'at_shop', label: 'At the shop', flag: false }
  if (distanceM <= NEARBY_RADIUS_M) {
    return { kind: 'nearby', label: `Nearby · ${metres(distanceM)}`, flag: false }
  }
  return { kind: 'away', label: `Away · ${metres(distanceM)}`, flag: true }
}
