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
  addedBy: string; addedByName: string; createdAt: number
 stock?: Record<string, number>   // productId → packets currently held

  // ── Sales Officer spec additions ──
  outletType?: OutletType
  /** Registered shop position. Captured on first visit, correctable by admin. */
  coordinates?: GeoPoint
  contactPersonName?: string       // hospitals / institutional
  contactPersonRole?: string
  creditLimit?: number             // distributors — checked before order booking
}

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
  id?: string; type: 'new_party' | 'credit_settlement' | 'low_stock' | 'stock_dispatched' | 'new_allocation' | 'visit_log_submitted' | 'leave_requested' | 'leave_approved' | 'visit_share_requested' | 'expense_submitted' | 'duty_auto_closed'
  message: string; relatedId: string; read: boolean; createdAt: number
  toUid?: string        // only that user sees it
  toRole?: 'admin_group' // only admin/super_admin see it
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
  outletIds: string[]
  assignedTo: string[]            // uids of officers who may select this beat
  active: boolean
  createdBy: string
  createdByName: string
  createdAt: number
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

/** Spec §5.2 — free-text remarks must reach this length before punch-out. */
export const MIN_REMARKS_LENGTH = 15

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
  allocationId?: string
  indentId?: string
  paymentTransactionId?: string

  // Category-specific mandatory fields (spec §3.2)
  contactPersonName?: string      // hospital
  sampleLogNote?: string          // hospital
  creditLimitChecked?: boolean    // distributor
  counterPresence?: boolean       // pharmacy
  customerFeedback?: string       // cosmetics

  // Compulsory remarks (spec §5)
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

/**
 * Spec §5.2, expressed once so the form, the punch-out button and any future
 * server-side check all agree. Returns null when the visit may be closed.
 */
export function validateVisitForPunchOut(v: Partial<OutletVisit>): string | null {
  if (!v.remarksCategory) return 'Select a visit outcome category.'
  if (NO_ORDER_CATEGORIES.includes(v.remarksCategory) && !v.remarksReason)
    return 'Select the specific no-order reason.'
  if ((v.remarksText ?? '').trim().length < MIN_REMARKS_LENGTH)
    return `Remarks must be at least ${MIN_REMARKS_LENGTH} characters describing the conversation.`
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
