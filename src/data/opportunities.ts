import { OutletVisit, Party, UnifiedAllocation } from '../types'

/**
 * Shops worth going back to, worked out from what reps already record.
 *
 * Every one of these signals was being captured and thrown away. Shelf counts
 * and competitor sightings are typed into every single visit and appeared in
 * exactly one place — a line inside an expanded visit in the field report —
 * never aggregated, never turned into anything anybody could act on. Order
 * history was only ever read per party, never as "who stopped buying".
 *
 * So this adds no new capture. It reads what is already there and turns it into
 * lists somebody can work.
 */

export type OpportunityKind =
  | 'lapsed'        // used to order, and stopped
  | 'zero_shelf'    // our product was counted at zero on their shelf
  | 'competitor'    // a rival brand was seen there
  | 'never_ordered' // visited, never bought
  | 'uncovered'     // nobody has been in a long time

export const OPPORTUNITY_LABEL: Record<OpportunityKind, string> = {
  lapsed: 'Stopped ordering',
  zero_shelf: 'Nothing on the shelf',
  competitor: 'A rival is in there',
  never_ordered: 'Visited, never ordered',
  uncovered: 'Nobody has been',
}

export const OPPORTUNITY_BLURB: Record<OpportunityKind, string> = {
  lapsed: 'They bought before and have gone quiet for longer than they usually do.',
  zero_shelf: 'The last count found none of ours on their shelf — they can reorder today.',
  competitor: 'A rival brand was recorded on the last visit, with what it sells for.',
  never_ordered: 'Somebody has been in, more than once in some cases, and nothing has ever been booked.',
  uncovered: 'On the network and not visited for a month or more.',
}

export interface Opportunity {
  party: Party
  kind: OpportunityKind
  /** One line saying why this shop is on this list. */
  why: string
  /** Days since the thing that put it here — the sort key within a list. */
  days: number
  lastVisitAt?: number
  lastOrderAt?: number
}

export interface OpportunityConfig {
  /** Fallbacks for a shop without enough history to have a rhythm of its own. */
  distributorDays: number
  retailerDays: number
  /** How long without a visit counts as uncovered. */
  uncoveredDays: number
}

export const DEFAULT_OPPORTUNITY_CONFIG: OpportunityConfig = {
  // A distributor buys on a tight cycle, so silence means more, sooner. A small
  // retailer can legitimately go two months between orders.
  distributorDays: 30,
  retailerDays: 60,
  uncoveredDays: 30,
}

const DAY = 86400000
const daysSince = (ts: number, now: number) => Math.floor((now - ts) / DAY)

/**
 * How long this shop normally leaves between orders.
 *
 * Its own rhythm beats any constant: a shop that ordered every fortnight for
 * six months is late at forty days, and one that orders quarterly is not late
 * at sixty. Needs three orders before there are two gaps to take a middle of —
 * below that there is no rhythm, only a coincidence.
 */
function ownCadenceDays(orderTimes: number[]): number | null {
  if (orderTimes.length < 3) return null
  const sorted = [...orderTimes].sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) gaps.push((sorted[i] - sorted[i - 1]) / DAY)
  gaps.sort((a, b) => a - b)
  const mid = Math.floor(gaps.length / 2)
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2
  // Half again on top, so ordinary variation is not called lapsing. Floored at
  // a week so a shop that orders daily is not flagged the moment it misses one.
  return Math.max(7, Math.round(median * 1.5))
}

export interface OpportunityInput {
  parties: Party[]
  /** Visits over the window being considered — the more, the better the signal. */
  visits: OutletVisit[]
  allocations: UnifiedAllocation[]
  config?: OpportunityConfig
  /** Only this rep's own work. Omit for the whole team. */
  uid?: string
  now?: number
}

export function findOpportunities(input: OpportunityInput): Opportunity[] {
  const cfg = input.config ?? DEFAULT_OPPORTUNITY_CONFIG
  const now = input.now ?? Date.now()

  // A visit that was abandoned never collected anything, including a shelf
  // count, so it is not evidence of having been anywhere.
  const visits = input.visits.filter(v => v.status !== 'abandoned')
  const orders = input.allocations.filter(a => a.status !== 'cancelled')

  const lastVisit = new Map<string, OutletVisit>()
  for (const v of visits) {
    const seen = lastVisit.get(v.partyId)
    if (!seen || v.punchInAt > seen.punchInAt) lastVisit.set(v.partyId, v)
  }

  const orderTimes = new Map<string, number[]>()
  for (const a of orders) {
    const list = orderTimes.get(a.partyId) ?? []
    list.push(a.createdAt || 0)
    orderTimes.set(a.partyId, list)
  }

  const out: Opportunity[] = []

  for (const party of input.parties) {
    if (!party.id) continue

    const v = lastVisit.get(party.id)
    const times = orderTimes.get(party.id) ?? []
    const lastOrderAt = times.length ? Math.max(...times) : undefined
    const lastVisitAt = v?.punchInAt

    // Whose shop this is, when a rep is looking at their own list. A shop
    // nobody has touched belongs to nobody, so it stays on everyone's.
    if (input.uid && v && v.uid !== input.uid) continue

    const base = { party, lastVisitAt, lastOrderAt }

    // ── stopped ordering ──────────────────────────────────────────────────
    if (lastOrderAt) {
      const fallback = party.type === 'distributor' ? cfg.distributorDays : cfg.retailerDays
      const threshold = ownCadenceDays(times) ?? fallback
      const quiet = daysSince(lastOrderAt, now)
      if (quiet > threshold) {
        out.push({
          ...base, kind: 'lapsed', days: quiet,
          why: ownCadenceDays(times)
            ? `${quiet} days quiet — they normally order about every ${Math.round((ownCadenceDays(times)! / 1.5))} days.`
            : `${quiet} days since their last order.`,
        })
      }
    }

    // ── nothing of ours on the shelf ──────────────────────────────────────
    // Only when somebody actually counted. An empty stock array means the rep
    // did not count, which is not the same as counting zero, and treating it
    // as zero would fill this list with shops nobody has looked at.
    if (v && v.stock?.length) {
      const total = v.stock.reduce((n, l) => n + (l.qtyOnShelf || 0), 0)
      if (total === 0) {
        out.push({
          ...base, kind: 'zero_shelf', days: daysSince(v.punchInAt, now),
          why: `Counted at zero ${daysSince(v.punchInAt, now)} days ago.`,
        })
      }
    }

    // ── a rival is in there ───────────────────────────────────────────────
    if (v && v.competitors?.length) {
      const named = v.competitors.filter(c => c.brand?.trim())
      if (named.length) {
        out.push({
          ...base, kind: 'competitor', days: daysSince(v.punchInAt, now),
          why: named
            .map(c => c.pricePerPack ? `${c.brand} at ₹${c.pricePerPack}` : c.brand)
            .join(', ') + '.',
        })
      }
    }

    // ── visited, never bought ─────────────────────────────────────────────
    if (v && !lastOrderAt) {
      const seen = visits.filter(x => x.partyId === party.id).length
      out.push({
        ...base, kind: 'never_ordered', days: daysSince(v.punchInAt, now),
        why: `${seen} ${seen === 1 ? 'visit' : 'visits'} on record and nothing ever booked.`,
      })
    }

    // ── nobody has been ───────────────────────────────────────────────────
    // Only for the team view: a rep's own list should not fill up with shops
    // that are simply somebody else's to cover.
    if (!input.uid) {
      const quiet = lastVisitAt ? daysSince(lastVisitAt, now) : Infinity
      if (quiet > cfg.uncoveredDays) {
        out.push({
          ...base, kind: 'uncovered', days: quiet === Infinity ? 9999 : quiet,
          why: lastVisitAt
            ? `Last visited ${quiet} days ago.`
            : 'No visit on record at all.',
        })
      }
    }
  }

  // Longest-neglected first within each list; the caller groups by kind.
  return out.sort((a, b) => b.days - a.days)
}

export function groupByKind(list: Opportunity[]): Record<OpportunityKind, Opportunity[]> {
  const out = {
    lapsed: [], zero_shelf: [], competitor: [], never_ordered: [], uncovered: [],
  } as Record<OpportunityKind, Opportunity[]>
  for (const o of list) out[o.kind].push(o)
  return out
}
