import {
  collection, doc, writeBatch, getDocs, query, where,
  Transaction, WriteBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import {
  StockLedgerEntry, StockMoveReason,
  PRIMARY_REASONS, SECONDARY_REASONS,
} from '../types'
import { localDateStr } from '../utils/date'

/**
 * The stock ledger.
 *
 * `parties.stock` answers "how much do they hold now". It cannot answer "how
 * much did they hold on the 1st", and back-computing that from today's balance
 * breaks silently the moment anyone records a manual correction. Every movement
 * therefore writes a signed line here, and period balances are read off the
 * ledger instead of inferred.
 *
 * Lines are written in the same batch or transaction as the stock change they
 * describe, so the two cannot drift apart.
 */

export interface StockMoveInput {
  partyId: string
  partyName: string
  productId: string
  productName: string
  /** Signed: positive into the party, negative out of it. */
  delta: number
  reason: StockMoveReason
  balanceAfter?: number
  refType?: StockLedgerEntry['refType']
  refId?: string
  byUid: string
  byName: string
  /** Defaults to today. Pass the dispatch date when back-dating a movement. */
  date?: string
}

function toEntry(m: StockMoveInput): Omit<StockLedgerEntry, 'id'> {
  const now = Date.now()
  return {
    partyId: m.partyId,
    partyName: m.partyName,
    productId: m.productId,
    productName: m.productName,
    date: m.date ?? localDateStr(),
    at: now,
    delta: m.delta,
    ...(m.balanceAfter !== undefined ? { balanceAfter: m.balanceAfter } : {}),
    reason: m.reason,
    ...(m.refType ? { refType: m.refType } : {}),
    ...(m.refId ? { refId: m.refId } : {}),
    byUid: m.byUid,
    byName: m.byName,
    createdAt: now,
  }
}

/** Queue a ledger line inside an existing transaction. */
export function ledgerInTransaction(tx: Transaction, move: StockMoveInput): void {
  tx.set(doc(collection(db, 'stock_ledger')), toEntry(move))
}

/** Queue a ledger line inside an existing batch. */
export function ledgerInBatch(batch: WriteBatch, move: StockMoveInput): void {
  batch.set(doc(collection(db, 'stock_ledger')), toEntry(move))
}

/** Standalone write, for movements that are not already part of a batch. */
export async function recordStockMoves(moves: StockMoveInput[]): Promise<void> {
  if (moves.length === 0) return
  const batch = writeBatch(db)
  moves.forEach(m => ledgerInBatch(batch, m))
  await batch.commit()
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface PeriodStock {
  opening: number
  primary: number     // in from the company
  secondary: number   // out of the party — to retailers or off the shelf
  closing: number
}

/**
 * Opening, primary, secondary and closing for every party and product in a
 * period. Opening is the sum of every delta before the period began, which is
 * exact as long as the ledger is complete — which it is from the day it was
 * introduced.
 *
 * Keyed `partyId::productId`.
 */
export async function periodStock(from: string, to: string): Promise<Map<string, PeriodStock>> {
  const [beforeSnap, duringSnap] = await Promise.all([
    getDocs(query(collection(db, 'stock_ledger'), where('date', '<', from))),
    getDocs(query(collection(db, 'stock_ledger'),
      where('date', '>=', from), where('date', '<=', to))),
  ])

  const out = new Map<string, PeriodStock>()
  const touch = (k: string) => {
    if (!out.has(k)) out.set(k, { opening: 0, primary: 0, secondary: 0, closing: 0 })
    return out.get(k)!
  }

  beforeSnap.docs.forEach(d => {
    const e = d.data() as StockLedgerEntry
    touch(`${e.partyId}::${e.productId}`).opening += e.delta
  })

  duringSnap.docs.forEach(d => {
    const e = d.data() as StockLedgerEntry
    const row = touch(`${e.partyId}::${e.productId}`)
    if (PRIMARY_REASONS.includes(e.reason)) row.primary += e.delta
    else if (SECONDARY_REASONS.includes(e.reason)) row.secondary += Math.abs(e.delta)
    else row.opening += e.delta   // corrections fold into the opening position
  })

  out.forEach(row => { row.closing = row.opening + row.primary - row.secondary })
  return out
}
