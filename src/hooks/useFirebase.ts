import { useState, useEffect } from 'react'
import {
  collection, doc, setDoc, getDocs,
  query, where, onSnapshot, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { CheckIn, PostStatus } from '../types'

// ── CHECK-INS ─────────────────────────────────────────────────────────────────
export function useCheckIns(date: string) {
  const [checkIns, setCheckIns] = useState<CheckIn[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(collection(db, 'checkins'), where('date', '==', date))
    const unsub = onSnapshot(q, (snap) => {
      setCheckIns(snap.docs.map(d => ({ id: d.id, ...d.data() } as CheckIn)))
      setLoading(false)
    })
    return unsub
  }, [date])

  return { checkIns, loading }
}

export async function submitCheckIn(data: Omit<CheckIn, 'id'>) {
  const id = `${data.name.toLowerCase()}_${data.date}`
  await setDoc(doc(db, 'checkins', id), {
    ...data,
    createdAt: Date.now(),
  })
}

// ── MARKETING STATUSES ────────────────────────────────────────────────────────
export function usePostStatuses(month: string) {
  const [statuses, setStatuses] = useState<Record<number, PostStatus['status']>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(collection(db, 'post_statuses'), where('month', '==', month))
    const unsub = onSnapshot(q, (snap) => {
      const map: Record<number, PostStatus['status']> = {}
      snap.docs.forEach(d => {
        const data = d.data() as PostStatus
        map[data.postId] = data.status
      })
      setStatuses(map)
      setLoading(false)
    })
    return unsub
  }, [month])

  return { statuses, loading }
}

export async function updatePostStatus(
  postId: number,
  status: PostStatus['status'],
  updatedBy: string,
  month: string
) {
  const id = `${month}_post_${postId}`
  await setDoc(doc(db, 'post_statuses', id), {
    postId,
    status,
    updatedBy,
    month,
    updatedAt: Date.now(),
  })
}
