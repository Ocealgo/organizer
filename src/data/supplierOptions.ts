import { Party, UnifiedAllocation } from '../types'

/**
 * Who could supply this shop, in the order somebody standing in it would guess.
 *
 * A retailer often buys from more than one distributor — a main one, and a
 * second when the first is out of stock or carries a different line. The party
 * record holds only one `underDistributorId`, so on a shop like that the
 * pre-selected supplier was simply wrong about half the time, and a default
 * that is wrong half the time teaches people to stop reading defaults.
 *
 * Rather than declare the second link and give somebody another list to keep
 * current, this reads what actually happened. Every allocation already records
 * the supplier that was chosen for it, so "who has supplied this shop before,
 * and how recently" is free, needs no admin, and cannot go stale. It is also
 * better evidence than the link itself: an order booked last month says more
 * about who serves this shop than a field somebody set once at signup.
 *
 * The declared parent still leads, because it is a deliberate statement about
 * whose account this is and money settles somewhere specific. Evidence orders
 * everything behind it.
 */

export interface SupplierOption {
  /** '' means Ocealgo itself. */
  value: string
  label: string
}

const monthOf = (ts: number) =>
  new Date(ts).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })

/** The most recent time each distributor actually supplied this shop. */
function lastSuppliedBy(allocations: UnifiedAllocation[]): Map<string, number> {
  const seen = new Map<string, number>()
  for (const a of allocations) {
    if (a.fromType !== 'distributor' || a.status === 'cancelled') continue
    const at = a.createdAt || 0
    if (at > (seen.get(a.fromId) ?? 0)) seen.set(a.fromId, at)
  }
  return seen
}

export function supplierOptions(
  allParties: Party[],
  shop: Party | null,
  allocations: UnifiedAllocation[],
): SupplierOption[] {
  const parentId = shop?.underDistributorId
  const last = lastSuppliedBy(allocations)

  // Never the shop itself: a distributor does not supply itself, and offering
  // it invites an allocation that goes nowhere.
  const distributors = allParties.filter(p => p.type === 'distributor' && p.id !== shop?.id)

  const rank = (p: Party) =>
    p.id === parentId ? 0 : last.has(p.id!) ? 1 : 2

  const ordered = [...distributors].sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    if (ra !== rb) return ra - rb
    // Among those who have actually supplied them, most recent first.
    if (ra === 1) return (last.get(b.id!) ?? 0) - (last.get(a.id!) ?? 0)
    return a.name.localeCompare(b.name)
  })

  return [
    { value: '', label: 'Ocealgo — direct from the company' },
    ...ordered.map(p => ({
      value: p.id!,
      // The reason it is where it is, said out loud. A rep choosing between
      // two distributors should not have to remember which one came last.
      label: p.id === parentId
        ? `${p.name} — their distributor`
        : last.has(p.id!)
          ? `${p.name} — supplied them ${monthOf(last.get(p.id!)!)}`
          : p.name,
    })),
  ]
}

/**
 * What to start on.
 *
 * The declared parent when there is one, because it is somebody's deliberate
 * statement. Failing that the distributor who most recently supplied them,
 * which is the best guess available. Failing both, Ocealgo — which is also the
 * right answer for a distributor being visited in their own right.
 */
export function defaultSupplierId(
  shop: Party | null,
  allocations: UnifiedAllocation[],
): string {
  if (shop?.underDistributorId) return shop.underDistributorId
  const last = lastSuppliedBy(allocations)
  let best = '', bestAt = 0
  last.forEach((at, id) => { if (at > bestAt) { best = id; bestAt = at } })
  return best
}
