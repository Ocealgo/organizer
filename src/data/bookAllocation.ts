import { addDoc, collection, doc, increment, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import {
  AllocationStatus, AppUser, OrderChannel, Party, PaymentType, Product,
} from '../types'

/**
 * Raising an order, wherever it is raised from.
 *
 * There are two places an order starts: the Allocations screen, at a desk,
 * with every term on show; and inside a shop, mid-visit, with the shortest set
 * of questions that still produces a real order. Both write the same document
 * and both have to have the same consequences — and until this existed they
 * did not.
 *
 * The visit path wrote `lockedAtCreation: true` and never locked anything, so
 * every order booked in a shop overstated what the company still had
 * available, and two reps could promise the same packets to different shops on
 * the same morning. It also skipped the credit due date, which is what ages an
 * unpaid bill into `overdue`, so those orders never aged; and it raised no
 * alert, so nobody was told.
 *
 * None of that was a decision. It was a second implementation drifting from
 * the first, which is what a second implementation does.
 */

export interface BookOrderArgs {
  party: Party
  product: Product
  /** In packets, already converted from cartons by the caller. */
  packets: number
  /** Null means the company is supplying it. */
  supplier: Party | null
  /** Per packet. Ignored when a distributor supplies it — see below. */
  pricePerPacket: number
  paymentType: PaymentType
  /** YYYY-MM-DD. Ignored when a distributor supplies it. */
  plannedDate: string
  /** YYYY-MM-DD. Only meaningful for a company order on credit. */
  creditDueDate?: string
  notes?: string
  by: AppUser
  /** Packets per carton, for the alert wording. */
  packetsPerCarton: number
  /**
   * Set when the caller has established this order takes the party past their
   * credit limit and the person raising it has said to go ahead anyway.
   */
  overCreditLimit?: boolean
  /** Where the order was taken. Defaults to the shop floor. */
  channel?: OrderChannel
}

/**
 * Stock moving from a distributor to their own retailer is not the company's
 * sale. The company does not price it, does not put it on anybody's credit,
 * does not schedule it and — the part that was wrong — does not lock stock it
 * is not sending. Ocealgo's own supply does all four.
 */
export async function bookAllocation(args: BookOrderArgs): Promise<string> {
  const {
    party, product, packets, supplier, paymentType, plannedDate,
    creditDueDate, notes, by, packetsPerCarton, overCreditLimit, channel,
  } = args

  const fromCompany = !supplier
  const price = fromCompany ? args.pricePerPacket : 0
  const planned = fromCompany ? plannedDate : new Date().toISOString().slice(0, 10)
  const cartons = Math.floor(packets / (product.unitsPerCarton || packetsPerCarton || 1))

  const ref = await addDoc(collection(db, 'allocations_v2'), {
    fromType: fromCompany ? 'company' : 'distributor',
    fromId: fromCompany ? 'company' : supplier!.id!,
    fromName: fromCompany ? 'Ocealgo' : supplier!.name,
    partyId: party.id!, partyName: party.name, partyType: party.type,
    productId: product.id!, productName: product.name,
    packets, cartons,
    pricePerPacket: price, totalAmount: packets * price,
    paymentType: fromCompany ? paymentType : 'cash',
    plannedDate: planned,
    // What ages an unpaid bill into `overdue`. Without it a credit order sits
    // "sent" forever and never reaches anybody's attention.
    ...(fromCompany && paymentType === 'credit' && creditDueDate ? { creditDueDate } : {}),
    status: 'pending' as AllocationStatus,
    notes: notes ?? '',
    createdBy: by.uid, createdByName: by.name,
    createdAt: Date.now(), month: planned.slice(0, 7),
    lockedAtCreation: fromCompany,
    ...(overCreditLimit ? { overCreditLimit: true } : {}),
    // Always written, so absence means "raised before anyone was asked" rather
    // than "raised in a shop". A report that guesses the difference is worse
    // than one that admits it does not know.
    channel: channel ?? 'field_visit',
  })

  // Only now, and only for company stock: the flag above is a claim about
  // this, and the two must not be able to disagree.
  if (fromCompany) {
    await updateDoc(doc(db, 'config', 'stock'), {
      [`productStock.${product.id!}.locked`]: increment(packets),
      updatedAt: Date.now(),
    })
  }

  await addDoc(collection(db, 'alerts'), {
    type: 'new_allocation',
    message: `New allocation: ${packets} ${product.unitLabel} of ${product.name} to ${party.name}, from ${fromCompany ? 'Ocealgo' : supplier!.name}`,
    relatedId: ref.id, toRole: 'admin_group',
    read: false, createdAt: Date.now(),
  })

  // Its own alert, because it is its own event. Somebody in the office should
  // hear that a limit was crossed on the day it was crossed, rather than find
  // it in a balance a month later.
  if (overCreditLimit) {
    await addDoc(collection(db, 'alerts'), {
      type: 'credit_limit_exceeded',
      message: `${by.name} booked ₹${(packets * price).toLocaleString('en-IN')} for ${party.name}, which is past their credit limit`,
      relatedId: ref.id, toRole: 'admin_group',
      read: false, createdAt: Date.now(),
    })
  }

  // An outlet that has ordered is no longer a prospect.
  await updateDoc(doc(db, 'parties', party.id!), { status: 'active' })

  return ref.id
}

/**
 * Undo one, while it is still only pending.
 *
 * Company stock goes back the moment the order does. `lockedAtCreation` is
 * what decides whether there is anything to give back, so a legacy order that
 * never locked anything does not hand back packets it never took.
 */
export async function cancelAllocation(
  alloc: { id: string; productId?: string; packets: number; fromType: string; lockedAtCreation?: boolean },
): Promise<void> {
  await updateDoc(doc(db, 'allocations_v2', alloc.id), { status: 'cancelled' as AllocationStatus })
  if (alloc.fromType === 'company' && alloc.lockedAtCreation && alloc.productId) {
    await updateDoc(doc(db, 'config', 'stock'), {
      [`productStock.${alloc.productId}.locked`]: increment(-alloc.packets),
      updatedAt: Date.now(),
    })
  }
}
