import { useState, useEffect } from 'react'
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore'
import { onSnapshot } from '../data/live'
import { db } from '../firebase'
import { DutySession } from '../types'
import { localDateStr } from '../utils/date'

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
    return prev?.endOdometerKm ?? null
  } catch (e) {
    // A missing index or a denied read must not block someone starting work.
    console.error('[lastClosingOdometer] lookup failed', e)
    return null
  }
}
