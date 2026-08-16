import { useState, useEffect } from 'react'
import {
  collection, query, where, getDocs, orderBy, limit, doc, updateDoc, addDoc,
} from 'firebase/firestore'
import { onSnapshot } from '../data/live'
import { db } from '../firebase'
import { DutySession } from '../types'
import { localDateStr } from '../utils/date'
import { AUTO_CLOSE_HOUR, cancelEndOfDayReminder } from '../device/notify'

/**
 * Today's duty session for one officer.
 *
 * Everything the field app does hangs off this: the outlet list stays locked
 * until `isOnDuty` is true (spec §2.3), and every visit and expense is filed
 * against the open session.
 *
 * Two equality filters need no composite index — Firestore merges single-field
 * indexes for equality-only queries.
 */
export function useDutySession(uid?: string, date?: string) {
  const [session, setSession] = useState<DutySession | null>(null)
  const [loading, setLoading] = useState(true)

  const day = date ?? localDateStr()

  useEffect(() => {
    if (!uid) { setLoading(false); return }
    setLoading(true)
    const q = query(
      collection(db, 'duty_sessions'),
      where('uid', '==', uid),
      where('date', '==', day),
    )
    return onSnapshot(
      q,
      snap => {
        const d = snap.docs[0]
        setSession(d ? ({ id: d.id, ...d.data() } as DutySession) : null)
        setLoading(false)
      },
      err => {
        console.error('[useDutySession] listener failed', err)
        setSession(null)
        setLoading(false)
      },
    )
  }, [uid, day])

  return {
    session,
    loading,
    /** Punched in and not yet punched out. */
    isOnDuty: session?.status === 'active',
    /** Punched out — the day is finished and nothing more can be logged. */
    isDayClosed: session?.status === 'closed',
  }
}

/**
 * The last closing odometer reading, used to stop today's start reading being
 * lower than yesterday's finish (spec §6, `day_start_km`).
 * Needs the composite index in firestore.indexes.json.
 *
 * Falls back to the opening reading when there is no closing one. A day that
 * was auto-closed never recorded a finish, and without the fallback the floor
 * silently disappears for the next punch-in — which would make forgetting to
 * punch out the way to reset your own meter baseline. The opening reading is
 * the last figure the officer actually evidenced, so it is the honest floor.
 */
export async function lastClosingOdometer(uid: string, beforeDate: string): Promise<number | null> {
  try {
    const snap = await getDocs(query(
      collection(db, 'duty_sessions'),
      where('uid', '==', uid),
      where('date', '<', beforeDate),
      orderBy('date', 'desc'),
      limit(1),
    ))
    const prev = snap.docs[0]?.data() as DutySession | undefined
    return prev?.endOdometerKm ?? prev?.startOdometerKm ?? null
  } catch (e) {
    // A missing index or a denied read must not block someone starting work.
    console.error('[lastClosingOdometer] lookup failed', e)
    return null
  }
}

/** A session left open is stale once its day is over, or once tonight is. */
function isStale(session: DutySession, now = new Date()): boolean {
  const today = localDateStr(now)
  if (session.date < today) return true
  return session.date === today && now.getHours() >= AUTO_CLOSE_HOUR
}

/**
 * Close any duty session the officer left open, and abandon the outlet visit
 * they may have left open inside it.
 *
 * There is no backend to run this at a fixed hour, so it runs on the officer's
 * own device when the app opens — the only party the rules let close their
 * session. In practice that means a day forgotten on Tuesday night is tidied
 * on Wednesday morning rather than at 23:00 sharp.
 *
 * Nothing is invented. No closing reading is written and no distance is
 * claimed, because none was ever taken; the day is marked `autoClosed` so a
 * report can tell "went nowhere" apart from "never told us".
 *
 * Safe to call on every app open — it is a no-op when nothing is stale, and
 * every failure is swallowed so a housekeeping sweep can never block the app.
 */
export async function closeAbandonedSessions(uid: string, name: string): Promise<number> {
  try {
    const snap = await getDocs(query(
      collection(db, 'duty_sessions'),
      where('uid', '==', uid),
      where('status', '==', 'active'),
    ))

    const stale = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as DutySession))
      .filter(s => isStale(s))

    if (stale.length === 0) return 0

    for (const session of stale) {
      // Visits first, session last. The session being `active` is what makes
      // this sweep pick the day up again, so if the app dies halfway the next
      // open retries and finishes the job. Closing the session first would
      // strand any still-open visit for good.
      const openVisits = await getDocs(query(
        collection(db, 'outlet_visits'),
        where('sessionId', '==', session.id),
        where('status', '==', 'open'),
      ))
      for (const v of openVisits.docs) {
        // A visit punched into and never punched out of never collected its
        // outcome or remarks, so it is abandoned, not closed.
        await updateDoc(doc(db, 'outlet_visits', v.id), {
          status: 'abandoned',
          abandonedAt: Date.now(),
        })
      }

      await updateDoc(doc(db, 'duty_sessions', session.id!), {
        endAt: Date.now(),
        status: 'closed',
        autoClosed: true,
        autoClosedAt: Date.now(),
      })

      // Somebody has to see it. Otherwise a forgotten day just reads as a day
      // with no distance and no one asks why.
      await addDoc(collection(db, 'alerts'), {
        type: 'duty_auto_closed',
        message: `${name} did not end their day on ${session.date} — closed automatically, no distance claimed`,
        relatedId: session.id!,
        toRole: 'admin_group',
        read: false,
        createdAt: Date.now(),
      })
    }

    await cancelEndOfDayReminder()
    return stale.length
  } catch (e) {
    console.error('[closeAbandonedSessions] sweep failed', e)
    return 0
  }
}
