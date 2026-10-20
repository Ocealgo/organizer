import { useEffect, useMemo, useState } from 'react'
import { collection } from 'firebase/firestore'
import { onSnapshot } from './live'
import { db } from '../firebase'
import type { Holiday } from '../types'

/**
 * The declared holidays, as date → name, kept live.
 *
 * For the screens that only need to say "this day was a holiday" — the
 * holidays themselves are managed in Attendance → Holidays.
 */
export function useHolidays(): Map<string, string> {
  const [holidays, setHolidays] = useState<Holiday[]>([])
  useEffect(() => onSnapshot(collection(db, 'holidays'),
    s => setHolidays(s.docs.map(d => ({ id: d.id, ...d.data() } as Holiday))),
    err => console.error('[useHolidays] listener failed', err)), [])
  return useMemo(() => new Map(holidays.map(h => [h.date, h.name])), [holidays])
}
