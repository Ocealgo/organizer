import { useState, useEffect } from 'react'
import { collection, doc, setDoc, getDocs, query, where, onSnapshot, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { CheckIn, PostStatus, StockConfig } from '../types'

// ── TODAY ─────────────────────────────────────────────────────────────────────
export const todayStr = () => new Date().toISOString().split('T')[0]

// ── CHECK-INS ─────────────────────────────────────────────────────────────────
export function useCheckIns(date: string) {
  const [checkIns, setCheckIns] = useState<CheckIn[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const q = query(collection(db, 'checkins'), where('date', '==', date))
    const unsub = onSnapshot(q, snap => {
      setCheckIns(snap.docs.map(d => ({ id: d.id, ...d.data() } as CheckIn)))
      setLoading(false)
    })
    return unsub
  }, [date])
  return { checkIns, loading }
}

export async function submitCheckIn(data: Omit<CheckIn, 'id'>) {
  const id = `${data.name.toLowerCase().replace(/\s/g, '_')}_${data.date}`
  await setDoc(doc(db, 'checkins', id), { ...data, createdAt: Date.now() })
}

// ── MARKETING STATUSES ────────────────────────────────────────────────────────
export function usePostStatuses(month: string) {
  const [statuses, setStatuses] = useState<Record<number, PostStatus['status']>>({})
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const q = query(collection(db, 'post_statuses'), where('month', '==', month))
    const unsub = onSnapshot(q, snap => {
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
  postId: number, status: PostStatus['status'], updatedBy: string, month: string
) {
  const id = `${month}_post_${postId}`
  await setDoc(doc(db, 'post_statuses', id), { postId, status, updatedBy, month, updatedAt: Date.now() })
}

// ── STOCK CONFIG ──────────────────────────────────────────────────────────────
export function useStockConfig() {
  const [config, setConfig] = useState<StockConfig>({ total: 0, locked: 0, packetsPerCarton: 12, updatedAt: 0 })
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'stock'), snap => {
      if (snap.exists()) setConfig(snap.data() as StockConfig)
      setLoading(false)
    })
    return unsub
  }, [])
  return { config, loading }
}

export async function updateStockConfig(config: Partial<StockConfig>) {
  const snap = await getDoc(doc(db, 'config', 'stock'))
  const existing = snap.exists() ? snap.data() : { total: 0, locked: 0, packetsPerCarton: 12 }
  await setDoc(doc(db, 'config', 'stock'), { ...existing, ...config, updatedAt: Date.now() })
}

// ── HELPER: packets ↔ cartons ─────────────────────────────────────────────────
export function toDisplay(packets: number, ppc: number) {
  const cartons = Math.floor(packets / ppc)
  const remaining = packets % ppc
  if (cartons === 0) return `${packets} pkts`
  if (remaining === 0) return `${cartons} cartons (${packets} pkts)`
  return `${cartons} cartons + ${remaining} pkts (${packets} pkts)`
}

// ── DEFAULT PRICE ─────────────────────────────────────────────────────────────
export async function getDefaultPrice(): Promise<number> {
  const { getDoc, doc } = await import('firebase/firestore')
  const snap = await getDoc(doc(db, 'config', 'stock'))
  return snap.exists() ? (snap.data().defaultPricePerPacket || 0) : 0
}

export async function setProductStock(productId: string, total: number) {
  const ref = doc(db, 'config', 'stock')
  const snap = await getDoc(ref)
  if (snap.exists()) {
    const current = snap.data() as StockConfig
    await updateDoc(ref, {
      [`productStock.${productId}.total`]: total,
      [`productStock.${productId}.locked`]: current.productStock?.[productId]?.locked ?? 0,
      updatedAt: Date.now(),
    })
  } else {
    await setDoc(ref, {
      total: 0, locked: 0, packetsPerCarton: 12,
      productStock: { [productId]: { total, locked: 0 } },
      updatedAt: Date.now(),
    })
  }
}

export async function setDefaultPrice(price: number) {
  const snap = await import('firebase/firestore')
  const existing = await (await snap.getDoc(snap.doc(db, 'config', 'stock'))).data() || {}
  await snap.setDoc(snap.doc(db, 'config', 'stock'), { ...existing, defaultPricePerPacket: price, updatedAt: Date.now() })
}
