export type UserRole =
  | 'super_admin' | 'admin' | 'sales_manager'
  | 'offline_sales' | 'online_sales'
  | 'offline_marketing' | 'online_marketing'

export type AccountStatus = 'pending' | 'approved' | 'rejected' | 'deactivated'

// ── PERMISSIONS ───────────────────────────────────────────────────────────────
// admin / super_admin implicitly hold every permission. sales_manager holds only
// what is explicitly set to true on their user document. Everyone else holds none.
// Enforced in firestore.rules as well as the UI — see can() in src/auth/permissions.ts
export type Permission =
  // screens
  | 'view_stock' | 'view_parties' | 'view_allocations' | 'view_products'
  | 'view_credit' | 'view_expenses' | 'view_leave' | 'view_reports'
  | 'view_workspace' | 'view_users'
  // actions
  | 'edit_parties' | 'delete_parties'
  | 'manage_products' | 'edit_stock'
  | 'dispatch_allocations' | 'mark_paid' | 'approve_payments'
  | 'approve_leave' | 'clear_expenses'
  | 'approve_sales_users'
  | 'assign_work'

export type PermissionMap = Partial<Record<Permission, boolean>>

export interface AppUser {
  uid: string; email: string; name: string
  /** E.164, e.g. `+919876543210`. Absent on accounts created before signup asked. */
  phone?: string
  role: UserRole; status: AccountStatus
  /** Set when someone else reset this password. Cleared once the owner picks their own. */
  mustChangePassword?: boolean
  passwordResetBy?: string; passwordResetByName?: string; passwordResetAt?: unknown
  createdAt: number; approvedAt?: number; approvedBy?: string
  permissions?: PermissionMap   // only meaningful for role === 'sales_manager'
}

export interface CheckIn {
  id?: string; name: string; role: 'sales'
  shops: number; orders: number
  did: string; doing: string; blocker: string
  date: string; createdAt: number
}

export interface PostStatus {
  postId: number; status: 'pending' | 'in-progress' | 'posted' | 'missed'
  updatedAt: number; updatedBy: string; month: string
}

export interface ContentPost {
  id: number; date: string; day: string; pillar: string
  format: 'Static Post' | 'Carousel' | 'Reel'; topic: string; week: number
}

// ── PARTY ─────────────────────────────────────────────────────────────────────
export type PartyType = 'distributor' | 'retailer'
export type PartyCategory = 'FMCG' | 'Pharma' | 'General Store' | 'Supermarket' | 'Online' | 'Other'

/**
 * Outlet channel, per the Sales Officer spec §3.2. Distinct from PartyCategory,
 * which is the older commercial grouping — this one drives which fields the
 * visit form makes mandatory.
 */
export type OutletType =
  | 'grocery'      // Groceries / Supermarkets
  | 'distributor'  // Distributors / Stockists
  | 'pharmacy'     // Medical shops / Pharmacies
  | 'cosmetics'    // Cosmetics shops
  | 'hospital'     // Hospitals / Clinics
  | 'general'      // General retail

export const OUTLET_TYPE_LABEL: Record<OutletType, string> = {
  grocery: 'Grocery / Supermarket',
  distributor: 'Distributor / Stockist',
  pharmacy: 'Medical shop / Pharmacy',
  cosmetics: 'Cosmetics shop',
  hospital: 'Hospital / Clinic',
  general: 'General retail',
}

/**
 * What counting their stock means, in the words of the place you are standing.
 *
 * A distributor has a godown, not a shelf, and asking a stockist what is "on
 * their shelf" gets you the two packets by the door rather than the eight
 * hundred out the back. Same field, same number, question the rep can answer.
 */
export const OUTLET_STOCK_LABEL: Record<OutletType, string> = {
  grocery: 'What is on their shelf',
  distributor: 'What they hold in the godown',
  pharmacy: 'What is on the counter',
  cosmetics: 'What is on the display',
  hospital: 'What they have in store',
  general: 'What is on their shelf',
}

/** A single position fix. `isMock` comes from Android's mock-provider flag. */
export interface GeoPoint {
  lat: number
  lng: number
  accuracy: number          // metres — reject or flag anything over ~100
  capturedAt: number
  capturedBy?: string
  isMock?: boolean
}

/**
 * Why a position was not recorded.
 *
 * A missing location is not one fact, it is four, and they ask for different
 * responses. `denied` is a decision a person made and can unmake. The other
 * three are the world being unhelpful — a basement, a dead chip, a market with
 * no sky. Stored apart because otherwise every one of them arrives at a report
 * as the same blank, and a rep who switched location off looks exactly like a
 * rep who spent the day indoors.
 *
 * Recorded, never enforced. Nothing in the app refuses to work over any of
 * these; they only make the gap legible.
 */
export type LocationIssue = 'denied' | 'unavailable' | 'timeout' | 'inaccurate'

/** Short enough to sit at the end of a line in a report. */
export const LOCATION_ISSUE_LABEL: Record<LocationIssue, string> = {
  denied: 'permission off',
  unavailable: 'no position',
  timeout: 'timed out',
  inaccurate: 'too vague',
}

export interface Party {
  id?: string; name: string; type: PartyType; category: PartyCategory
  phone: string; address: string; place: string
  pricePerPacket: number; packetsAllocated: number; cartonsAllocated: number
  lowStockThreshold: number
  underDistributorId?: string; underDistributorName?: string
  district?: string
  state?: string
  pincode?: string
  email?: string
  /**
   * The code this outlet carries on the beat sheet the office circulates —
   * `CFM004` and the like.
   *
   * It exists so a re-import is boring. Matching on the name works once and
   * then rots: a shop typed `AJU MEDICALS` this month and `Aju Medicals` next
   * either creates a duplicate or, worse, merges with a different shop whose
   * name happens to be close. A code assigned by whoever keeps the sheet is
   * stable in a way a hand-typed name never is, so the first import matches on
   * the name under review and stamps this, and every import after it is exact.
   *
   * Absent on anything added in the field, which has no sheet behind it.
   */
  outletCode?: string
  addedBy: string; addedByName: string; createdAt: number
 stock?: Record<string, number>   // productId → packets currently held

  // ── Sales Officer spec additions ──
  outletType?: OutletType
  /**
   * Registered shop position — and therefore its geofence, which is what
   * `distanceFromOutletM` on every visit is measured against.
   *
   * Anyone standing at the shop may correct it, because they are the best
   * source of truth about where it is and an office cannot be. Nothing is
   * blocked; everything is written down. See `coordinatesHistory`.
   */
  coordinates?: GeoPoint
  /** Who put the current pin where it is, so it is never anonymous. */
  coordinatesSetBy?: string
  coordinatesSetByName?: string
  coordinatesSetAt?: number
  /**
   * Every position this shop has ever had, newest last.
   *
   * A movable pin is a movable geofence: somebody who can drag it can quietly
   * relocate a shop to the spot they habitually punch in from, and every visit
   * after that reads as bang on the doorstep. Making the move visible is what
   * keeps it honest — the same trade the app makes everywhere else with
   * location. Capped at MAX_PIN_HISTORY so one shop cannot grow without bound.
   */
  coordinatesHistory?: PinChange[]
  contactPersonName?: string       // hospitals / institutional
  contactPersonRole?: string
}

/** How a shop's position came to be where it is. */
export type PinSource =
  | 'created'        // stamped when the outlet was added in the field
  | 'first_visit'    // registered by the first punch-in at a shop with no pin
  | 'standing_here'  // somebody at the shop said "it is here, not there"
  | 'map'            // placed or moved on a map, by someone who may be elsewhere

export const PIN_SOURCE_LABEL: Record<PinSource, string> = {
  created: 'registered when the outlet was added',
  first_visit: 'registered on the first visit',
  standing_here: 'set from where the person was standing',
  map: 'placed on the map',
}

/** One move of a shop's pin. */
export interface PinChange {
  at: number
  by: string
  byName: string
  /** Where it was. Absent for the first position a shop ever had. */
  from?: GeoPoint
  to: GeoPoint
  /** How far it moved, in metres. Absent for a first registration. */
  movedM?: number
  how: PinSource
}

/**
 * A move further than this raises an alert to the admin group.
 *
 * Set above the geofence radius on purpose. Nudging a pin across the road is
 * ordinary correction and should not cry wolf; moving a shop further than a
 * visit could ever have been judged against is a different act, and somebody
 * should see it happen rather than find it later.
 */
export const PIN_MOVE_ALERT_M = 150

/** Keeps one much-corrected shop from growing a document without end. */
export const MAX_PIN_HISTORY = 20

/**
 * A fix vaguer than this may be recorded as evidence of a visit, but must not
 * be allowed to *define* where a shop is.
 *
 * These are different jobs. "The rep was somewhere in this 800 m circle" is
 * still worth keeping about a visit. Writing the centre of that circle down as
 * the shop's position is a guess that every later visit is then measured
 * against — and until now nothing checked, so a single bad fix could brand
 * honest visits as out-of-geofence forever.
 */
export const MAX_PIN_ACCURACY_M = 100

// ── STOCK CONFIG ──────────────────────────────────────────────────────────────
export interface ProductStock {
  total: number    // packets company currently holds
  locked: number   // reserved for pending allocations
}

export interface StockConfig {
  packetsPerCarton: number
  updatedAt: number
 productStock?: Record<string, ProductStock>  // productId → stock
  // Legacy single-pool fields (kept for backward compat)
  total: number
  locked: number
}

// ── MONTHLY STOCK REQUEST ─────────────────────────────────────────────────────
export type RequestStatus = 'pending' | 'partial' | 'fulfilled'

export interface MonthlyRequest {
  id?: string
  partyId: string
  partyName: string
  partyType: PartyType
  month: string                  // YYYY-MM
  requestedPackets: number
  fulfilledPackets: number       // running total of dispatched
  status: RequestStatus
  notes: string
  requestedBy: string
  requestedByName: string
  createdAt: number
  updatedAt: number
}

// ── DISPATCH (Admin → Distributor/Retailer) ───────────────────────────────────
export type PaymentType = 'cash' | 'credit'
export type QuantityUnit = 'packets' | 'cartons'

// ── PAYMENT TRANSACTIONS ──────────────────────────────────────────────────────
// Applies only to direct customers: distributors + independent retailers
export type PaymentMethod = 'cash' | 'cheque' | 'bank_transfer' | 'upi'
export type CollectionType = 'direct_to_company' | 'collected_by_salesperson'
export type PaymentTxnStatus = 'pending_approval' | 'approved' | 'rejected'

export interface PaymentTransaction {
  id?: string
  partyId: string
  partyName: string
  partyType: PartyType
  amount: number
  paymentMethod: PaymentMethod
  collectionType: CollectionType
  collectedBy?: string
  collectedByName?: string
  notes?: string
  status: PaymentTxnStatus
  approvedBy?: string
  approvedByName?: string
  approvedAt?: number
  date: string
  createdAt: number
  appliedTo?: { allocId: string; amount: number }[]  // which allocs this payment was applied to (for reversal on cancel)
  confirmedAt?: number       // admin confirmation that cash reached company
  confirmedBy?: string
  confirmedByName?: string
}

/**
 * The part of a receipt that never landed on a bill.
 *
 * Settlement fills the oldest bills in turn and stops when they run out; the
 * receipt keeps the full amount while `appliedTo` keeps only the part that
 * found a home. The difference is an advance, and until somebody puts it
 * against a bill by hand it is recorded in no balance anywhere.
 *
 * Receipts written before `appliedTo` existed are skipped rather than counted.
 * Without a record of what a payment settled, its unapplied share is not
 * knowable — and treating "no record" as "applied to nothing" would report
 * every old receipt in the book as an advance.
 *
 * A rejected receipt holds nothing: its application was already unwound.
 */
export function unappliedAmount(p: PaymentTransaction): number {
  if (p.status === 'rejected' || !Array.isArray(p.appliedTo)) return 0
  const applied = p.appliedTo.reduce((s, a) => s + (a.amount || 0), 0)
  return Math.max(0, (p.amount || 0) - applied)
}

/** Money this party has handed over that is sitting against no bill. */
export function advanceHeld(payments: PaymentTransaction[]): number {
  return payments.reduce((s, p) => s + unappliedAmount(p), 0)
}

export interface Dispatch {
  id?: string
  partyId: string
  partyName: string
  partyType: PartyType
  requestId?: string             // linked monthly request
  packets: number
  cartons: number
  pricePerPacket: number
  totalAmount: number
  paymentType: PaymentType
  notes: string
  month: string
  fromType?: 'company' | 'distributor'
  fromId?: string
  fromName?: string
  dispatchedBy: string
  dispatchedByName: string
  dispatchedAt: number           // exact timestamp
  date: string
  createdAt: number
}

// ── STOCK MOVEMENT (Distributor → Retailer) ───────────────────────────────────
export interface StockMovement {
  id?: string
  fromId: string                 // 'us' | partyId
  fromName: string               // 'Ocealgo' | party name
  toPartyId: string
  toPartyName: string
  productId?: string
  productName?: string
  packets: number; cartons: number
  pricePerPacket: number; totalAmount: number
  paymentType: PaymentType; notes: string
  month: string; loggedBy: string; loggedByName: string
  date: string; createdAt: number
}

// ── CREDIT ────────────────────────────────────────────────────────────────────

// CreditEntry is legacy (pre-payment-transaction system). Kept for backward compat.
// New credit tracking uses PaymentTransaction + UnifiedAllocation.creditDueDate.
export interface CreditEntry {
  id?: string; partyId: string; partyName: string; partyType: PartyType
  deliveryId: string; packets: number; amount: number
  status: 'outstanding' | 'settled' | 'pending_approval'
  settledBy?: string; settledByName?: string; settledAt?: number; createdAt: number
}

// ── HOLIDAY ───────────────────────────────────────────────────────────────────
export interface Holiday {
  id?: string
  name: string
  date: string        // YYYY-MM-DD
  createdBy: string
  createdByName: string
  createdAt: number
}

// ── EXPENSE ───────────────────────────────────────────────────────────────────
export type AllowanceType = 'HQ' | 'EX' | 'OS'
export type ExpenseCategory =
  | 'bus_fare' | 'fuel' | 'food' | 'lodging' | 'printing' | 'other'
  // ── Sales Officer spec §4.1 ──
  | 'taxi' | 'toll' | 'parking'

/** Categories where the spec makes a bill photo compulsory. */
export const PROOF_REQUIRED_CATEGORIES: ExpenseCategory[] = [
  'taxi', 'bus_fare', 'lodging', 'toll', 'parking',
]

export interface ExpenseConfig {
  hq: number
  ex: number
  os: number
  /** ₹ per km, used to auto-calculate the fuel claim from the day's odometer. */
  ratePerKm?: number
  /** A food bill is required above this amount. */
  foodBillThreshold?: number
  updatedAt?: number
  updatedBy?: string
}

export interface ExpenseReport {
  id?: string
  userId: string
  userName: string
  /**
   * What the filer was when they filed. Decides who may sign the week off —
   * a manager's claim goes to an admin, not to another manager. Absent on
   * reports filed before managers could work in the field, and every one of
   * those belongs to an officer.
   */
  userRole?: UserRole
  weekStart: string
  weekEnd: string
  status: 'draft' | 'submitted' | 'cleared' | 'rejected'
  totalAmount: number
  /**
   * Declared as having nothing to claim, rather than simply never filed.
   * Without this a quiet week and a forgotten week are the same absence, and
   * a reviewer cannot tell them apart. Only meaningful while the total is
   * still zero — adding an entry later makes the declaration obsolete rather
   * than wrong, so nothing has to go back and unset it.
   */
  nilReturn?: boolean
  submittedAt?: number
  clearedAt?: number
  clearedBy?: string
  clearedByName?: string
  clearNote?: string
  createdAt: number
}

export interface ExpenseEntry {
  id?: string
  reportId: string
  userId: string
  date: string
  type: 'allowance' | 'variable'
  allowanceType?: AllowanceType
  category?: ExpenseCategory
  customLabel?: string
  amount: number
  notes?: string
  createdAt: number

  // ── Sales Officer spec §4.1 ──
  /** Storage path of the bill or receipt. Compulsory for PROOF_REQUIRED_CATEGORIES. */
  billPhotoPath?: string
  /** True when the amount came from distance × rate rather than being typed. */
  autoCalculated?: boolean
  distanceKm?: number

  /**
   * On an allowance: the day's metered distance, and what it pointed at.
   *
   * Written when the type was picked out from the duty session rather than
   * chosen cold — kept even when the rep overrode the suggestion, because
   * "the meter said 12 km and they claimed OS" is the interesting case and it
   * cannot be reconstructed later. The same reason the fuel rate is copied
   * onto its entry: a week cleared in March has to explain itself in
   * September, when the session may be archived and the rule may have moved.
   */
  allowanceFromKm?: number
  allowanceSuggested?: AllowanceType

  /**
   * Why money was spent on a day with no duty session at all.
   *
   * Reimbursements are not refused on a day nobody worked, because the days
   * that go wrong are exactly the expensive ones — a rep travelling the
   * evening before an outstation market, or one who broke down on the way and
   * never reached their territory to punch in. Refusing those would not stop
   * the spending, it would only move the argument to WhatsApp.
   *
   * So it is told, recorded and flagged rather than prevented, the same trade
   * an over-limit order gets. Present here means an admin should read the line
   * before clearing it.
   */
  noDutyReason?: string
  /**
   * The ₹/km in force when this was claimed, copied onto the entry rather than
   * looked up later. A manager changing the rate must not restate what has
   * already been claimed, and a cleared week has to still explain its own
   * arithmetic months afterwards.
   */
  ratePerKm?: number
  dutySessionId?: string
}

// ── ALERT ─────────────────────────────────────────────────────────────────────
export interface Alert {
  id?: string
  type:
    | 'new_party' | 'credit_settlement' | 'low_stock' | 'stock_dispatched'
    | 'new_allocation' | 'visit_log_submitted' | 'leave_requested'
    | 'leave_approved' | 'visit_share_requested' | 'expense_submitted'
    | 'duty_auto_closed' | 'party_pin_moved'
  message: string; relatedId: string; read: boolean; createdAt: number

  /**
   * Who this is for.
   *
   * `toUid` is one person and is how anything about *your* record reaches you
   * — your leave approved, your week cleared, a partner asking to share a
   * visit. Everything else is company business and goes to management.
   *
   * An alert carrying neither is not a broadcast. The bell used to treat it as
   * one, so every rep saw every party anybody added, every allocation raised
   * anywhere, and every visit log submitted by anyone. Untagged now means
   * management only — a forgotten tag hides something from people rather than
   * showing it to everyone, which is the direction a mistake should fail in.
   * `everyone` exists for the day something genuinely is for all hands.
   */
  toUid?: string
  toRole?: 'admin_group' | 'everyone'
}

// ── ALLOCATION ────────────────────────────────────────────────────────────────
export interface Allocation {
  id?: string
  partyId: string
  partyName: string
  partyType: PartyType
  packets: number
  cartons: number
  pricePerPacket: number
  month: string              // YYYY-MM
  notes: string
  status: 'active' | 'completed'
  createdBy: string
  createdByName: string
  createdAt: number
}

// ── WORKSPACE ─────────────────────────────────────────────────────────────────
export type ReminderType = 'manual' | 'low_stock' | 'dispatch' | 'credit_due' | 'allocation'
export type WorkspaceCategory = 'Finance' | 'Operations' | 'Sales' | 'Marketing' | 'General'

export interface Reminder {
  id?: string
  title: string
  date: string              // YYYY-MM-DD
  category: WorkspaceCategory
  type: ReminderType
  linkedId?: string
  linkedType?: string
  createdBy: string
  createdByName: string
  done: boolean
  createdAt: number
}

export interface ChecklistItem {
  id?: string
  title: string
  category: WorkspaceCategory
  completed: boolean
  completedAt?: number
  ownerId: string
  ownerName: string
  createdAt: number
}

export interface PinnedNote {
  id?: string
  content: string
  createdBy: string
  createdByName: string
  createdAt: number
  archived: boolean
}

// ── UNIFIED ALLOCATION ────────────────────────────────────────────────────────
export type AllocationStatus = 'pending' | 'sent' | 'paid' | 'overdue' | 'cancelled'

export interface UnifiedAllocation {
  id?: string
  fromType: 'company' | 'distributor'  // who is sending stock
  fromId: string                        // 'company' or distributor partyId
  fromName: string                      // 'Ocealgo' or distributor name
  partyId: string
  partyName: string
  partyType: PartyType
  productId: string
  productName: string
  packets: number
  cartons: number
  pricePerPacket: number
  totalAmount: number
  paymentType: PaymentType
  plannedDate: string          // date admin plans to send
  sentAt?: number              // timestamp when actually dispatched
  sentBy?: string
  sentByName?: string
  paidAt?: number              // timestamp when payment received
  status: AllocationStatus
  notes: string
  createdBy: string
  createdByName: string
  createdAt: number
  month: string                // YYYY-MM for grouping
  lockedAtCreation?: boolean   // true if company stock was locked at creation
  creditDueDate?: string       // YYYY-MM-DD — for credit allocs; auto-escalates to overdue when passed
  paidAmount?: number          // running total of payments applied to this alloc

  /**
   * Raised knowing it put the party past their credit limit.
   *
   * Recorded, not prevented. A distributor carrying a balance still trades,
   * and a rep standing in front of one cannot wait on the office to raise a
   * number — refusing the order would cost the sale rather than collect the
   * debt. So it goes through, the rep is told what they are doing before they
   * do it, an admin is told after, and the allocation carries the fact.
   */

  /**
   * How this order came about.
   *
   * An order taken standing in a shop and one taken over the phone from a desk
   * are the same document and were, until this, indistinguishable — so a rep
   * who never left home read identically in the order numbers to one who
   * walked thirty shops, while the visit numbers said the opposite and nothing
   * reconciled the two.
   *
   * Absent on orders raised before this existed. Do not read absence as
   * `field_visit`; it means nobody was asked.
   */
  channel?: OrderChannel
  /** The conversation this order came out of, when it was not a visit. */
  remoteContactId?: string
}

/** Where an order was taken. */
export type OrderChannel = 'field_visit' | 'phone' | 'whatsapp' | 'email' | 'office'

export const ORDER_CHANNEL_LABEL: Record<OrderChannel, string> = {
  field_visit: 'In the shop',
  phone: 'Over the phone',
  whatsapp: 'On WhatsApp',
  email: 'By email',
  office: 'At the office',
}

// ── PRODUCTS ──────────────────────────────────────────────────────────────────
export interface Product {
  id?: string
  name: string
  unitLabel: string             // e.g. "packets", "bottles", "units"
  defaultPricePerUnit: number
  unitsPerCarton: number
  active: boolean
  createdBy: string
  createdAt: number
}

// ── PARTY STATUS ──────────────────────────────────────────────────────────────
export type PartyStatus = 'prospect' | 'active' | 'inactive'

// ── VISIT LOG ─────────────────────────────────────────────────────────────────
export type VisitOutcome = 'interested' | 'not_interested' | 'follow_up'

export const NOT_INTERESTED_REASONS = [
  'Price too high',
  'Margin not enough',
  'Already has similar product',
  'Loyal to competitor',
  'Need more time',
  'Come back next month',
  'Shop too small',
  'Low footfall',
  'Product not relevant',
  'Other',
] as const

export type NotInterestedReason = typeof NOT_INTERESTED_REASONS[number]

export interface VisitEntry {
  partyId: string
  partyName: string
  isNew: boolean
  outcome?: VisitOutcome
  isRevisit?: boolean
  revisitLogId?: string          // points to revisit_logs doc — set on save
  notInterestedReason?: NotInterestedReason
  otherReason?: string
  productId?: string
  productName?: string
  allocationId?: string
  indentId?: string
  notes?: string
  sharedWith?: string[]
  loggedAt?: number              // unique per entry — prevents arrayUnion dedup
}

// ── RETAILER INDENT (Retailer → Distributor stock requisition) ────────────────
export type IndentStatus = 'requested' | 'fulfilled' | 'partial' | 'cancelled'

export interface RetailerIndent {
  id?: string
  distributorId: string
  distributorName: string
  retailerId: string
  retailerName: string
  productId: string
  productName: string
  requestedPackets: number
  fulfilledPackets: number
  status: IndentStatus
  requestedBy: string
  requestedByName: string
  requestedAt: number
  fulfilledAt?: number
  notes?: string
}

export interface DailyVisitLog {
  id?: string
  salesPersonId: string
  salesPersonName: string
  sharedWith?: string[]
  // uid → { parties: { partyId → acceptedAt timestamp } }
  // used to scope revisit log visibility to only parties shared before/at accept time
  sharedPartnerMeta?: Record<string, { parties: Record<string, number> }>
  date: string
  visits: VisitEntry[]
  endOfDayNote: string
  totalVisited: number
  totalInterested?: number
  totalNotInterested?: number
  createdAt: number
  updatedAt: number
  isNoEntry?: boolean
  auditLog?: VisitLogAuditEntry[]
}

export interface VisitShareRequest {
  id?: string
  fromUid: string
  fromName: string
  toUid: string
  toName: string
  date: string
  partyId: string
  partyName: string
  entries: VisitEntry[]
  originalLogId: string
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: number
  acceptedAt?: number
  rejectedAt?: number
}

// ── LEAVE RECORD ─────────────────────────────────────────────────────────────
export type LeaveType = 'full_day' | 'half_day'
export type LeaveStatus = 'pending_approval' | 'active' | 'unmark_requested' | 'removed' | 'rejected'

export const LEAVE_REASONS = ['Sick', 'Personal', 'Family', 'Other'] as const
export type LeaveReason = typeof LEAVE_REASONS[number]

export interface LeaveAuditEntry {
  action: 'leave_requested' | 'leave_approved' | 'leave_rejected' | 'admin_marked' | 'marked' | 'unmark_requested' | 'unmark_approved' | 'unmark_rejected'
  by: string
  byName: string
  at: number
}

export interface LeaveRecord {
  id?: string
  uid: string
  name: string
  role: UserRole
  date: string
  leaveType: LeaveType
  reason?: LeaveReason
  note?: string
  markedAt: number
  markedBy: string
  markedByName: string
  status: LeaveStatus
  unmarkRequestedAt?: number
  auditLog?: LeaveAuditEntry[]
}

// ── THEME ─────────────────────────────────────────────────────────────────────
export type AppTheme = 'dark' | 'light'

// ── REVISIT ACTIONS ───────────────────────────────────────────────────────────
export type RevisitActionType = 'stock_update' | 'new_order' | 'payment_collection' | 'relationship_visit' | 'no_longer_active'

export interface StockUpdateAction {
  type: 'stock_update'
  productId?: string
  productName?: string
  openingQty: number
  purchasedQty: number
  soldQty: number
  balanceQty: number
  balanceValue: number
  photoUrl?: string
  aiRead: boolean
  editedAt?: number
  editedBy?: string
  editedByName?: string
  correctionNote?: string
  originalValues?: { openingQty: number; purchasedQty: number; soldQty: number; balanceQty: number; balanceValue: number }
  removed?: boolean
  removedAt?: number
  removedBy?: string
  removedByName?: string
}

export interface NewOrderAction {
  type: 'new_order'
  productId: string
  productName: string
  quantity: number
  pricePerUnit: number
  totalAmount: number
  paymentType: 'cash' | 'credit'
  plannedDate: string
  allocationId?: string
}

export interface PaymentCollectionAction {
  type: 'payment_collection'
  amount: number
  notes: string
  status: 'pending_approval' | 'approved'
  approvedBy?: string
  approvedAt?: number
  transactionId?: string
}

export interface RelationshipVisitAction {
  type: 'relationship_visit'
  notes: string
}

export interface NoLongerActiveAction {
  type: 'no_longer_active'
  reason: string
}

export type RevisitAction =
  | StockUpdateAction
  | NewOrderAction
  | PaymentCollectionAction
  | RelationshipVisitAction
  | NoLongerActiveAction

export interface RevisitLog {
  id?: string
  partyId: string
  partyName: string
  partyType: PartyType
  salesPersonId: string
  salesPersonName: string
  date: string
  actions: RevisitAction[]
  notes: string
  createdAt: number
}

// ── VISIT LOG AUDIT ───────────────────────────────────────────────────────────
export type VisitLogAuditAction =
  | 'entry_added' | 'entry_edited' | 'entry_deleted'
  | 'stock_updated' | 'order_placed' | 'order_edited' | 'order_cancelled'
  | 'payment_collected' | 'payment_edited' | 'payment_deleted'
  | 'log_submitted' | 'log_edited_after_submit'

export interface VisitLogAuditEntry {
  action: VisitLogAuditAction
  by: string
  byName: string
  at: number
  partyId?: string
  partyName?: string
  detail?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// SALES OFFICER FIELD APP
// Implements the Sales Officer Mobile App functional specification.
// ═══════════════════════════════════════════════════════════════════════════

// ── DUTY SESSION (spec §2) ───────────────────────────────────────────────────
export type DutyStatus = 'active' | 'closed'

/**
 * Not every officer has a working odometer, and some have no vehicle at all.
 * The reading is recorded when it can be; otherwise the reason is, so the
 * absence is explained rather than looking like a skipped step.
 */
export type OdometerStatus = 'recorded' | 'not_working' | 'no_vehicle'

export const ODOMETER_STATUS_LABEL: Record<OdometerStatus, string> = {
  recorded: 'I can read my meter',
  not_working: 'My meter is not working',
  no_vehicle: 'I am not using a vehicle',
}

/**
 * One working day for one Sales Officer. Opened by the day punch-in and closed
 * by the punch-out. Everything else in the field app hangs off this.
 *
 * There is deliberately no "kind of day" recorded here. One was tried and it
 * was the wrong shape: asking at punch-in makes a rep forecast their day at
 * nine in the morning, and needs a second flow for when the forecast turns out
 * wrong. What a day was is legible afterwards from what is on it — visits,
 * contacts, distance — and is better derived at read time, which stays true
 * when a visit turns up late. A stored label would quietly contradict itself.
 *
 * A day worked from a desk is a punch-in with no vehicle, no visits and some
 * contacts. Every part of that is already recorded.
 */
export interface DutySession {
  id?: string
  uid: string
  name: string
  date: string                    // YYYY-MM-DD, local

  routeId?: string
  routeName?: string

  // Punch-in. Location is recorded when the device can supply it and simply
  // omitted when it cannot — it is evidence, never a gate.
  startAt: number
  startLocation?: GeoPoint
  /** Why there is no `startLocation`. Only ever set when there is none. */
  startLocationIssue?: LocationIssue
  startOdometerKm?: number
  startOdometerPhoto?: string     // Storage path
  /**
   * Whether that photo came from a camera the app controlled.
   *
   * False on the web app, which can only attach a file — there is no iOS
   * build, so reps on iPhone are always in that case, and a gallery picture of
   * yesterday's meter is indistinguishable from today's unless this says so.
   *
   * It is on the session as well as in the photo's Storage metadata because
   * the report reads sessions and should not have to fetch a file to find out
   * whether it can believe one. Same reason the fuel rate is copied onto its
   * expense entry.
   */
  startOdometerPhotoVerified?: boolean
  startBatteryPct?: number

  /** Whether a meter reading was possible at all. Defaults to 'recorded'. */
  odometerStatus?: OdometerStatus
  /** Why there is no reading. Required when odometerStatus is not 'recorded'. */
  odometerIssueNote?: string

  // Punch-out
  endAt?: number
  endLocation?: GeoPoint
  /** Why there is no `endLocation`. Only ever set when there is none. */
  endLocationIssue?: LocationIssue
  endOdometerKm?: number
  endOdometerPhoto?: string
  endOdometerPhotoVerified?: boolean
  endBatteryPct?: number
  /** Set when the meter could be read in the morning but not at close of day. */
  endOdometerIssueNote?: string

  /** endOdometerKm − startOdometerKm. What the officer claims. */
  claimedDistanceKm?: number
  /** Distance derived from the location trace. What actually happened. */
  trackedDistanceKm?: number
  /** Positive means the claim exceeds the trace. Flagged above 15% per spec §4.1. */
  distanceDeviationPct?: number

  outletsPlanned?: number
  outletsVisited?: number

  /**
   * Closed by the app rather than by the officer, because the day was left
   * open. There is no closing reading and no distance is claimed — the day is
   * tidied up, not completed. Kept as a distinct flag so a forgotten day never
   * reads in a report as a real day that happened to cover no ground.
   */
  autoClosed?: boolean
  autoClosedAt?: number

  status: DutyStatus
  createdAt: number
}

// ── LOCATION TRACE ───────────────────────────────────────────────────────────
/**
 * One position sample during a duty session. Written in batches from the device
 * buffer, not one document per fix. Subject to a retention policy — these are
 * the highest-volume documents in the system by an order of magnitude.
 */
export interface LocationPing {
  id?: string
  uid: string
  sessionId: string
  date: string
  lat: number
  lng: number
  accuracy: number
  at: number
  isMock?: boolean
}

// ── ROUTE / BEAT (spec §2.3) ─────────────────────────────────────────────────
export interface SalesRoute {
  id?: string
  name: string
  description?: string
  /**
   * The areas this beat covers, matching `Party.place`.
   *
   * A beat is areas before it is a list. Shops are seeded from the places and
   * then trimmed, which keeps the list explicit — nothing changes under the
   * manager's feet — while giving the screen a way to notice that a shop was
   * added in one of those areas later and offer it. A frozen list of ids
   * assumes the world is already in the database, and reps add shops all week.
   *
   * Plural because a real beat crosses boundaries: a rep working the north of
   * town covers three named places on a Tuesday, and nobody calls that three
   * beats.
   */
  places: string[]
  /**
   * Superseded by `places`. Beats written during the first day of this feature
   * have it; read as a single-entry list wherever it is all there is.
   */
  place?: string
  outletIds: string[]
  /**
   * Copied onto each day when the beat is assigned, never read from here
   * afterwards. See WorkPlan.targets for why.
   */
  defaultTargets?: PlanTargets
  /**
   * Left from the original spec: "uids of officers who may select this beat".
   * Superseded by WorkPlan, which says who is doing it and on which day.
   * Nothing reads it; kept so existing documents stay valid.
   */
  assignedTo: string[]
  active: boolean
  createdBy: string
  createdByName: string
  createdAt: number
}

/** A beat's areas, however old the document is. */
export function routePlaces(r: SalesRoute): string[] {
  if (r.places?.length) return r.places
  return r.place ? [r.place] : []
}

// ── VISIT OUTCOME TAXONOMY (spec §5.1) ───────────────────────────────────────
export type VisitOutcomeCategory =
  | 'order_booked'
  | 'no_order_stock_available'
  | 'no_order_commercial'
  | 'no_order_competitor'
  | 'no_order_operational'
  | 'institutional'

export const VISIT_OUTCOME_LABEL: Record<VisitOutcomeCategory, string> = {
  order_booked: 'Order booked',
  no_order_stock_available: 'No order — stock available',
  no_order_commercial: 'No order — commercial reason',
  no_order_competitor: 'No order — competitor action',
  no_order_operational: 'No order — operational',
  institutional: 'Institutional / hospital',
}

/** Second-level reason. Mandatory for every no-order outcome. */
export const VISIT_OUTCOME_REASONS: Record<VisitOutcomeCategory, readonly string[]> = {
  order_booked: [
    'Standard restock',
    'New product introduction',
    'Promotional scheme accepted',
  ],
  no_order_stock_available: [
    'Adequate inventory on hand',
    'Next order expected in the following cycle',
  ],
  no_order_commercial: [
    'Payment dispute',
    'Overdue credit balance',
    'Scheme margin dissatisfaction',
  ],
  no_order_competitor: [
    'Heavy competitor discounting',
    'Competitor gifting or scheme active',
    'Stocked with an alternative brand',
  ],
  no_order_operational: [
    'Key decision maker unavailable',
    'Shop closed during visit',
    'Stock delivery delayed',
    // A collection round is not a failed sales call. Without this a rep who
    // walked in purely to pick up money had to file the visit under a reason
    // that was not true, and every one of those visits read as a shop that
    // would not order.
    //
    // It says "came to collect" rather than "collected" on purpose: whether
    // any money actually arrived is recorded in the visit's money section,
    // truthfully and to the rupee. This field is the reason there was no
    // order, and that reason holds either way.
    'Came to collect payment',
  ],
  institutional: [
    'Product trial requested',
    'Procurement committee review',
    'Tender submitted',
  ],
} as const

/** Categories that count as a no-order visit. */
export const NO_ORDER_CATEGORIES: VisitOutcomeCategory[] = [
  'no_order_stock_available',
  'no_order_commercial',
  'no_order_competitor',
  'no_order_operational',
]

/**
 * How long a remark should be to be worth reading. A hint, not a gate.
 *
 * It used to be a gate: no punch-out until fifteen characters had been typed,
 * at every shop, twenty-odd times a day. A required free-text box asked that
 * often fills with "ok ok ok ok ok" — and a report full of those is worse than
 * one with gaps in it, because a gap is honest about being a gap. The outcome
 * dropdown is still required; it is one tap, and it is the structured field
 * every report actually counts.
 */
export const SUGGESTED_REMARKS_LENGTH = 15

// ── OUTLET VISIT (spec §3) ───────────────────────────────────────────────────
export type OutletPhotoKind =
  | 'shelf'          // groceries
  | 'display_strip'  // cosmetics
  | 'counter'        // pharmacies
  | 'godown'         // distributors
  | 'other'

export interface OutletPhoto {
  kind: OutletPhotoKind
  path: string                    // Storage path
  at: number
  location?: GeoPoint
}

export interface OutletStockLine {
  productId: string
  productName: string
  qtyOnShelf: number
}

export interface CompetitorObservation {
  brand: string
  present: boolean
  pricePerPack?: number
  schemeNote?: string
}

/**
 * `abandoned` is a visit that was punched into and never punched out of, swept
 * up when its duty session was. It is deliberately not `closed`: a closed visit
 * carries the compulsory outcome and remarks, and an abandoned one never
 * collected them, so counting the two together would overstate the day.
 */
export type VisitSessionStatus = 'open' | 'closed' | 'abandoned'

/**
 * One outlet visit inside a duty session. Opened by the outlet punch-in and
 * closed by the punch-out, which the app blocks until the mandatory remarks in
 * spec §5.2 are satisfied.
 */
export interface OutletVisit {
  id?: string
  sessionId: string               // parent DutySession
  uid: string
  name: string
  /**
   * What the visitor was at the time. Managers work outlets as well as
   * supervising them, so coverage counts every visit while per-person numbers
   * stay separable. Absent on visits logged before managers had a field mode.
   */
  role?: UserRole
  date: string

  partyId: string
  partyName: string
  outletType: OutletType

  // Punch-in. Location is captured for the record; it never blocks a visit.
  punchInAt: number
  punchInLocation?: GeoPoint
  /** Why there is no `punchInLocation`. Only ever set when there is none. */
  punchInLocationIssue?: LocationIssue
  /** Metres from the outlet's registered coordinates, when both are known. */
  distanceFromOutletM?: number
  /** Informational only — reported, not enforced. */
  withinGeofence?: boolean

  // Execution
  stock: OutletStockLine[]
  competitors: CompetitorObservation[]
  photos: OutletPhoto[]

  orderPlaced: boolean
  /** The first order placed here. Kept for readers written before there could be more than one. */
  allocationId?: string
  /** Every order placed during this visit — a shop orders more than one thing. */
  allocationIds?: string[]
  indentId?: string

  /**
   * Money taken off the counter during this visit.
   *
   * `paymentTransactionId` points at a `payment_transactions` document still
   * waiting on an admin's confirmation that the cash reached the company. The
   * amount and method are copied here too, so a day's collections can be read
   * off the field report without joining anything — and so the visit's own
   * account of what happened survives the transaction being rejected.
   */
  paymentTransactionId?: string
  paymentCollected?: number
  paymentMethod?: PaymentMethod

  // Category-specific mandatory fields (spec §3.2)
  contactPersonName?: string      // hospital
  sampleLogNote?: string          // hospital
  counterPresence?: boolean       // pharmacy
  customerFeedback?: string       // cosmetics

  /**
   * @deprecated A rep ticking "I checked their credit limit".
   *
   * Nothing ever read it. It was a proxy for "the rep should know the credit
   * position", written when the app could not show them one — so it recorded
   * that somebody said they looked, and never what they saw. The visit now
   * shows the real figures and captures them below, which is the thing the
   * tick was standing in for. Kept only so old visits still parse.
   */

  /**
   * The credit position as it actually stood when this visit closed.
   *
   * Numbers, not an assertion, and taken with no taps at all. They survive the
   * limit being changed afterwards, which is exactly when somebody wants to
   * know what it was on the day.
   */
  creditOutstandingAtVisit?: number

  // Visit outcome (spec §5). The category is required at punch-out; the
  // free text is not — see SUGGESTED_REMARKS_LENGTH for why it stopped being.
  remarksCategory?: VisitOutcomeCategory
  remarksReason?: string
  remarksText?: string

  // Punch-out
  punchOutAt?: number
  punchOutLocation?: GeoPoint
  /** Why there is no `punchOutLocation`. Only ever set when there is none. */
  punchOutLocationIssue?: LocationIssue
  durationMinutes?: number

  /** Set when the visit was swept up with an abandoned duty session. */
  abandonedAt?: number

  status: VisitSessionStatus
  createdAt: number
}

// ── REMOTE CONTACT ───────────────────────────────────────────────────────────
/**
 * A shop reached without going to it.
 *
 * Deliberately not an OutletVisit. A visit is a place you stood, evidenced by
 * a position, a geofence distance and a punch in and out; a contact is a
 * conversation, evidenced by nothing but the rep's word. Merging them would
 * destroy the one number that says whether anybody is actually going to shops,
 * because the cheap thing to fake would be counted alongside the expensive
 * thing that cannot be.
 *
 * So they are counted apart, always, and a contact is never coverage. What it
 * is good for is the half of the work that vanished entirely before: "called,
 * they will reorder after Onam" is real pipeline, and it was being lost.
 *
 * `contactPerson` is the closest thing to evidence this record can carry, and
 * the thing that settles an argument later — somebody at the shop is named as
 * having said it.
 */
export interface RemoteContact {
  id?: string
  uid: string
  name: string
  role: UserRole
  /** The duty session it belongs to, so a day's work reads as one thing. */
  sessionId: string
  date: string                    // YYYY-MM-DD, local

  partyId: string
  partyName: string
  channel: Exclude<OrderChannel, 'field_visit'>
  /** Who at the shop was actually spoken to. */
  contactPerson?: string

  /** The same outcome vocabulary a visit uses, so reports do not learn two. */
  outcomeCategory: VisitOutcomeCategory
  outcomeReason?: string
  remarks?: string

  /** Any orders raised out of this conversation. */
  allocationIds?: string[]

  at: number
  createdAt: number
}

/**
 * Spec §5.2, expressed once so the form, the punch-out button and any future
 * server-side check all agree. Returns null when the visit may be closed.
 */
export function validateVisitForPunchOut(v: Partial<OutletVisit>): string | null {
  if (!v.remarksCategory) return 'Select a visit outcome category.'
  if (NO_ORDER_CATEGORIES.includes(v.remarksCategory) && !v.remarksReason)
    return 'Select the specific no-order reason.'
  // Free-text remarks are not required. See SUGGESTED_REMARKS_LENGTH.
  return null
}

// ── STOCK LEDGER ─────────────────────────────────────────────────────────────
/**
 * Why a party's stock changed.
 *
 * `parties.stock` is a live counter with no memory, which makes "what did they
 * hold on the 1st" unanswerable. Every movement writes a line here instead, so
 * opening and closing balances for any period are read off the ledger rather
 * than inferred backwards from today — inference breaks the moment anyone
 * records a manual correction.
 */
export type StockMoveReason =
  |'dispatch_in'    // company → this party
  |'dispatch_out'   // this distributor → one of their retailers
  | 'indent_in'      // retailer received against an indent
  | 'indent_out'     // distributor sent against an indent
  | 'sale'           // sold off the shelf, seen on a revisit
  | 'adjustment'     // manual correction of the counted balance

export const STOCK_MOVE_LABEL: Record<StockMoveReason, string> = {
  dispatch_in: 'Received from Ocealgo',
  dispatch_out: 'Sent to a retailer',
  indent_in: 'Received against an indent',
  indent_out: 'Sent against an indent',
  sale: 'Sold',
  adjustment: 'Stock correction',
}

/** Movements that count as primary sales — company into the trade. */
export const PRIMARY_REASONS: StockMoveReason[] = ['dispatch_in']
/** Movements that count as secondary — out of a distributor, onward. */
export const SECONDARY_REASONS: StockMoveReason[] = ['dispatch_out', 'indent_out', 'sale']

export interface StockLedgerEntry {
  id?: string
  partyId: string
  partyName: string
  productId: string
  productName: string
  date: string            // YYYY-MM-DD, for period queries
  at: number
  /** Signed: positive into the party, negative out of it. The source of truth. */
  delta: number
  /** Best effort, written where the balance was already known. Audit aid only. */
  balanceAfter?: number
  reason: StockMoveReason
  refType?: 'allocation' | 'indent' | 'revisit'
  refId?: string
  byUid: string
  byName: string
  createdAt: number
}

// ── WORK PLANNING ─────────────────────────────────────────────────────────────

/**
 * What a day is aiming at.
 *
 * Deliberately two numbers. Every extra target is another thing a rep is
 * measured on and another column in a grid nobody then reads, and these are
 * the two the business actually steers by.
 */
export interface PlanTargets {
  /** Shops visited — all of them, beat or not. */
  visits?: number
  /** Rupee value of orders raised. Raised, not dispatched or paid. */
  orderValue?: number
}

/**
 * A day's assignment for one person.
 *
 * The document id is `${uid}_${date}`, which makes assigning idempotent and
 * makes two plans for the same rep-day structurally impossible rather than
 * merely unlikely.
 *
 * `targets` is copied from the beat when the day is assigned and then left
 * alone. If it were read from the beat at display time, editing a beat in
 * November would quietly rewrite what September was measured against — the
 * same reason a visit stores what the shop owed on the day rather than looking
 * it up later.
 */
export interface WorkPlan {
  id?: string
  uid: string
  /** Denormalised so the board can render without joining users. */
  name: string
  date: string                    // YYYY-MM-DD, local
  routeId?: string
  routeName?: string
  targets?: PlanTargets
  /** Anything the beat cannot say — "start at the far end", "chase Anand". */
  note?: string
  assignedBy: string
  assignedByName: string
  createdAt: number
  updatedAt?: number
}

/** Deterministic id: one plan per person per day, enforced by the key itself. */
export function workPlanId(uid: string, date: string): string {
  return `${uid}_${date}`
}

/**
 * How a planned day actually went.
 *
 * Derived at read time from the beat and the visits, never stored — so it
 * corrects itself when a visit is logged late or a beat is edited, and there
 * is no second copy to disagree with the first.
 *
 * `extra` is not a deviation and is never coloured as one. A rep who visited
 * three shops that were not on the list has done more work, not less, and if
 * some of them were new they were prospecting, which is the most valuable
 * thing they can do all day. Only `missed` is worth a manager's attention, and
 * even that is a question rather than a verdict.
 */
export interface PlanOutcome {
  plannedIds: string[]
  coveredIds: string[]
  missedIds: string[]
  extraIds: string[]
  /** How many of the extras were shops created that same day. */
  newShops: number
  visits: number
  orderValue: number
}
