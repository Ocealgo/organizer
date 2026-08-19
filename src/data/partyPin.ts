import { addDoc, collection, doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import {
  AppUser, GeoPoint, MAX_PIN_ACCURACY_M, MAX_PIN_HISTORY, Party,
  PinChange, PinSource, PIN_MOVE_ALERT_M,
} from '../types'
import { distanceM } from '../device/location'

/**
 * The one way a shop's position is ever written.
 *
 * Every caller goes through here — the first punch-in at an unpositioned shop,
 * an outlet added in the field, a rep standing at a shop saying the pin is
 * wrong, and an admin placing one on a map. That is deliberate. A shop's pin
 * is its geofence, and `distanceFromOutletM` on every visit is measured
 * against it, so a pin that moves without a trace quietly rewrites the past:
 * visits that were logged from the doorstep start reading as 300 m out, or the
 * reverse, and nothing anywhere says why.
 *
 * So the move, who made it, how far it went and how it was made are recorded
 * with the new position, in the same write. Not as an audit bolted on later —
 * as the only way to do it at all.
 */
export async function setPartyPin(
  party: Party,
  to: GeoPoint,
  how: PinSource,
  by: AppUser,
): Promise<void> {
  if (!party.id) return

  const from = party.coordinates
  const movedM = from ? Math.round(distanceM(from, to)) : undefined

  const change: PinChange = {
    at: Date.now(),
    by: by.uid,
    byName: by.name,
    ...(from ? { from } : {}),
    to,
    ...(movedM !== undefined ? { movedM } : {}),
    how,
  }

  // Newest last, oldest dropped. A shop corrected twenty times has told us
  // everything it is going to; the current pin and who set it live on the
  // party itself and are never trimmed away.
  const history = [...(party.coordinatesHistory ?? []), change].slice(-MAX_PIN_HISTORY)

  await updateDoc(doc(db, 'parties', party.id), {
    coordinates: to,
    coordinatesSetBy: by.uid,
    coordinatesSetByName: by.name,
    coordinatesSetAt: change.at,
    coordinatesHistory: history,
  })

  // A shop that moves further than a visit could ever have been judged against
  // is not a correction, it is a different shop. Somebody sees it happen.
  if (movedM !== undefined && movedM > PIN_MOVE_ALERT_M) {
    await addDoc(collection(db, 'alerts'), {
      type: 'party_pin_moved',
      message: `${by.name} moved ${party.name}'s registered position by ${movedM} m`,
      relatedId: party.id,
      toRole: 'admin_group',
      read: false,
      createdAt: Date.now(),
    })
  }
}

/**
 * Is this fix good enough to say where a shop *is*?
 *
 * Recording a vague fix against a visit is fine — "somewhere in this circle"
 * is still evidence of being out. Writing the middle of that circle down as
 * the shop's permanent position is a guess that every later visit gets
 * measured against, which is a different and much longer-lived claim.
 */
export function accurateEnoughForPin(fix: GeoPoint): boolean {
  return typeof fix.accuracy !== 'number' || fix.accuracy <= MAX_PIN_ACCURACY_M
}
