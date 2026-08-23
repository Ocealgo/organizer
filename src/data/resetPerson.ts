import {
  collection, query, where, getDocs, getDoc, doc, updateDoc,
  writeBatch, deleteDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import { UnifiedAllocation, PaymentTransaction, Party } from '../types'

/**
 * Erase one person's trail, and put back what it moved.
 *
 * The point is a rep account you can hand out, run a real day through, and
 * hand back clean — so this cannot simply delete rows. A rep's work changes
 * things that are not theirs: an order locks company stock, a dispatch moves
 * packets onto a shop's shelf, a collection writes paidAmount onto bills that
 * somebody else raised. Delete the rows alone and the stock is short, the
 * locks are held against orders that no longer exist, and money is owed by
 * nobody. So every record is unwound before it is removed.
 *
 * Order matters and is not negotiable:
 *
 *   1. payments   — restore paidAmount before the bills can disappear
 *   2. orders     — release locks, return dispatched stock, then delete
 *   3. everything else, which owns no shared state
 *   4. parties    — last, because steps 1 and 2 read their stock
 *
 * Run survey() first. It reads and counts and touches nothing, and it is the
 * only chance to see that a shop about to be deleted has a colleague's orders
 * against it.
 */

/** Where each collection keeps "who did this". */
const OWNED: { col: string; field: string; label: string }[] = [
  { col: 'outlet_visits', field: 'uid', label: 'Visits' },
  { col: 'duty_sessions', field: 'uid', label: 'Duty days' },
  { col: 'remote_contacts', field: 'uid', label: 'Phone and WhatsApp contacts' },
  { col: 'revisit_logs', field: 'salesPersonId', label: 'Visit logs (old app)' },
  { col: 'visit_logs', field: 'salesPersonId', label: 'Check-in logs (old app)' },
  { col: 'expense_entries', field: 'userId', label: 'Expense claims' },
  { col: 'expense_reports', field: 'userId', label: 'Expense submissions' },
  { col: 'leave_records', field: 'uid', label: 'Leave records' },
  { col: 'retailer_indents', field: 'requestedBy', label: 'Order requests' },
  { col: 'visit_share_requests', field: 'fromUid', label: 'Shared visits' },
  { col: 'alerts', field: 'toUid', label: 'Their notifications' },
]

export interface ResetSurvey {
  counts: { label: string; n: number }[]
  allocations: UnifiedAllocation[]
  payments: PaymentTransaction[]
  parties: Party[]
  /** Money the rep collected, in rupees — the number worth reading twice. */
  collected: number
  /** Bills raised by somebody else that this rep's payments touched. */
  foreignBillsTouched: number
  /** Their shops that other people have traded with. Deleting these orphans that work. */
  partiesUsedByOthers: { id: string; name: string; why: string }[]
  /** Stock that will go back to the company, per product. */
  stockReturned: Record<string, number>
  total: number
}

const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0)

async function byField<T>(col: string, field: string, uid: string): Promise<T[]> {
  const snap = await getDocs(query(collection(db, col), where(field, '==', uid)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as T)
}

/** Read-only. Counts what would go, and what it would disturb. */
export async function survey(uid: string): Promise<ResetSurvey> {
  const counts: { label: string; n: number }[] = []
  let total = 0

  for (const { col, field, label } of OWNED) {
    const rows = await byField<{ id: string }>(col, field, uid)
    counts.push({ label, n: rows.length })
    total += rows.length
  }

  const allocations = await byField<UnifiedAllocation>('allocations_v2', 'createdBy', uid)
  const payments = await byField<PaymentTransaction>('payment_transactions', 'collectedBy', uid)
  const parties = await byField<Party>('parties', 'addedBy', uid)
  counts.push({ label: 'Orders raised', n: allocations.length })
  counts.push({ label: 'Payments collected', n: payments.length })
  counts.push({ label: 'Shops added', n: parties.length })
  total += allocations.length + payments.length + parties.length

  const collected = payments
    .filter(p => p.status !== 'rejected')
    .reduce((s, p) => s + num(p.amount), 0)

  // A payment applies oldest bill first across the whole shop, so it lands on
  // whatever was owed — frequently an order somebody else raised. Those bills
  // survive; only their balance is put back.
  const ownIds = new Set(allocations.map(a => a.id))
  const foreignBillsTouched = new Set(
    payments.flatMap(p => (Array.isArray(p.appliedTo) ? p.appliedTo : []))
      .map(a => a.allocId)
      .filter(id => !ownIds.has(id)),
  ).size

  // Stock the company gets back: anything company-supplied that actually went out.
  const stockReturned: Record<string, number> = {}
  for (const a of allocations) {
    const fromCompany = a.fromType === 'company' || !a.fromType
    const dispatched = ['sent', 'overdue', 'paid'].includes(a.status)
    if (fromCompany && dispatched && a.productId) {
      stockReturned[a.productId] = (stockReturned[a.productId] || 0) + num(a.packets)
    }
  }

  // Their shops that other people have worked. This is the one the preview
  // exists for: deleting these leaves a colleague's orders and receipts
  // pointing at a shop that is not there any more.
  const partiesUsedByOthers: { id: string; name: string; why: string }[] = []
  for (const p of parties) {
    if (!p.id) continue
    const otherAllocs = (await getDocs(query(
      collection(db, 'allocations_v2'), where('partyId', '==', p.id),
    ))).docs.filter(d => (d.data() as any).createdBy !== uid).length
    const otherPays = (await getDocs(query(
      collection(db, 'payment_transactions'), where('partyId', '==', p.id),
    ))).docs.filter(d => (d.data() as any).collectedBy !== uid).length
    const otherVisits = (await getDocs(query(
      collection(db, 'outlet_visits'), where('partyId', '==', p.id),
    ))).docs.filter(d => (d.data() as any).uid !== uid).length

    if (otherAllocs || otherPays || otherVisits) {
      const bits = [
        otherAllocs && `${otherAllocs} order${otherAllocs > 1 ? 's' : ''}`,
        otherPays && `${otherPays} payment${otherPays > 1 ? 's' : ''}`,
        otherVisits && `${otherVisits} visit${otherVisits > 1 ? 's' : ''}`,
      ].filter(Boolean).join(', ')
      partiesUsedByOthers.push({ id: p.id, name: p.name, why: `${bits} by other people` })
    }
  }

  return {
    counts: counts.filter(c => c.n > 0),
    allocations, payments, parties,
    collected, foreignBillsTouched, partiesUsedByOthers, stockReturned, total,
  }
}

export interface ResetProgress { step: string }

/**
 * Do it. Survey first — this repeats the reads, but it is the destructive
 * pass and must work from what is there now rather than from a snapshot the
 * operator has been staring at for a minute.
 */
export async function resetPerson(
  uid: string,
  onProgress?: (p: ResetProgress) => void,
): Promise<string[]> {
  const done: string[] = []
  const say = (s: string) => onProgress?.({ step: s })

  // ── 1. Payments: give the money back to the bills ────────────────────────
  say('Restoring bills this person settled')
  const payments = await byField<PaymentTransaction>('payment_transactions', 'collectedBy', uid)
  const today = new Date().toLocaleDateString('en-CA')
  for (const p of payments) {
    if (p.status === 'rejected') continue          // already unwound
    for (const applied of (Array.isArray(p.appliedTo) ? p.appliedTo : [])) {
      const ref = doc(db, 'allocations_v2', applied.allocId)
      const snap = await getDoc(ref)
      if (!snap.exists()) continue                 // bill already gone
      const a = snap.data() as UnifiedAllocation
      const back = Math.max(0, num((a as any).paidAmount) - num(applied.amount))
      const dueDate = (a as any).creditDueDate
      await updateDoc(ref, {
        paidAmount: back,
        // A bill that was settled is owed again. Overdue or merely sent is
        // decided by its due date, the same way the credit book decides it.
        ...(a.status === 'paid'
          ? { status: dueDate && dueDate < today ? 'overdue' : 'sent', paidAt: null }
          : {}),
      })
    }
  }
  done.push(`${payments.length} payment${payments.length === 1 ? '' : 's'} reversed`)

  // ── 2. Orders: unlock, return the stock, then delete ─────────────────────
  say('Returning stock and removing orders')
  const allocations = await byField<UnifiedAllocation>('allocations_v2', 'createdBy', uid)
  const stockDelta: Record<string, { total: number; locked: number }> = {}
  const partyDelta: Record<string, Record<string, number>> = {}

  const bump = (pid: string, key: 'total' | 'locked', by: number) => {
    stockDelta[pid] = stockDelta[pid] || { total: 0, locked: 0 }
    stockDelta[pid][key] += by
  }
  const bumpParty = (partyId: string, pid: string, by: number) => {
    partyDelta[partyId] = partyDelta[partyId] || {}
    partyDelta[partyId][pid] = (partyDelta[partyId][pid] || 0) + by
  }

  for (const a of allocations) {
    const fromCompany = a.fromType === 'company' || !a.fromType
    const pid = a.productId
    const packets = num(a.packets)
    if (!pid || packets <= 0) continue

    if (a.status === 'pending') {
      // Never went anywhere; it is only holding a reservation.
      if (fromCompany && (a as any).lockedAtCreation) bump(pid, 'locked', -packets)
    } else if (['sent', 'overdue', 'paid'].includes(a.status)) {
      if (fromCompany) {
        bump(pid, 'total', packets)              // back into the company pool
        bumpParty(a.partyId, pid, -packets)      // off the shop's shelf
      } else {
        // A distributor supplied their own retailer: reverse both sides.
        if ((a as any).fromId) bumpParty((a as any).fromId, pid, packets)
        bumpParty(a.partyId, pid, -packets)
      }
    }
    // 'cancelled' released its lock when it was cancelled. Nothing owed back.
  }

  if (Object.keys(stockDelta).length > 0) {
    const stockSnap = await getDoc(doc(db, 'config', 'stock'))
    const cur = (stockSnap.data() as any)?.productStock || {}
    const update: Record<string, unknown> = { updatedAt: Date.now() }
    for (const [pid, d] of Object.entries(stockDelta)) {
      const now = cur[pid] || { total: 0, locked: 0 }
      // Clamped: a lock may already have been released by hand, and stock can
      // have moved on since. Never write a negative into the stock config.
      update[`productStock.${pid}.total`] = Math.max(0, num(now.total) + d.total)
      update[`productStock.${pid}.locked`] = Math.max(0, num(now.locked) + d.locked)
    }
    await updateDoc(doc(db, 'config', 'stock'), update)
    done.push(`stock returned for ${Object.keys(stockDelta).length} product(s)`)
  }

  const deletedPartyIds = new Set((await byField<Party>('parties', 'addedBy', uid)).map(p => p.id))
  for (const [partyId, products] of Object.entries(partyDelta)) {
    if (deletedPartyIds.has(partyId)) continue     // about to be deleted anyway
    const ref = doc(db, 'parties', partyId)
    const snap = await getDoc(ref)
    if (!snap.exists()) continue
    const cur = (snap.data() as any).stock || {}
    const update: Record<string, unknown> = {}
    for (const [pid, by] of Object.entries(products)) {
      update[`stock.${pid}`] = Math.max(0, num(cur[pid]) + by)
    }
    await updateDoc(ref, update)
  }

  await deleteAll(allocations.map(a => a.id!), 'allocations_v2')
  done.push(`${allocations.length} order${allocations.length === 1 ? '' : 's'} deleted`)

  await deleteAll(payments.map(p => p.id!), 'payment_transactions')

  // ── 3. Everything that owns no shared state ──────────────────────────────
  for (const { col, field, label } of OWNED) {
    say(`Deleting ${label.toLowerCase()}`)
    const rows = await byField<{ id: string }>(col, field, uid)
    if (rows.length === 0) continue
    await deleteAll(rows.map(r => r.id), col)
    done.push(`${rows.length} ${label.toLowerCase()}`)
  }

  // ── 4. Their shops, last — the steps above read their stock ──────────────
  say('Deleting shops this person added')
  const parties = await byField<Party>('parties', 'addedBy', uid)
  await deleteAll(parties.map(p => p.id!), 'parties')
  if (parties.length) done.push(`${parties.length} shop${parties.length === 1 ? '' : 's'} deleted`)

  return done
}

/** Firestore caps a batch at 500; 499 leaves room to be wrong about that. */
async function deleteAll(ids: string[], col: string) {
  const clean = ids.filter(Boolean)
  for (let i = 0; i < clean.length; i += 499) {
    const batch = writeBatch(db)
    clean.slice(i, i + 499).forEach(id => batch.delete(doc(db, col, id)))
    await batch.commit()
  }
}

/** Exported for the one case a caller may want without the rest. */
export { deleteDoc }
