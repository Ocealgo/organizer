export type UserRole = 'super_admin' | 'admin' | 'offline_sales' | 'online_sales' | 'offline_marketing' | 'online_marketing'
export type AccountStatus = 'pending' | 'approved' | 'rejected'

export interface AppUser {
  uid: string; email: string; name: string
  role: UserRole; status: AccountStatus
  createdAt: number; approvedAt?: number; approvedBy?: string
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

export interface Party {
  id?: string; name: string; type: PartyType; category: PartyCategory
  phone: string; address: string; place: string
  pricePerPacket: number; packetsAllocated: number; cartonsAllocated: number
  lowStockThreshold: number
  underDistributorId?: string; underDistributorName?: string
  addedBy: string; addedByName: string; createdAt: number
  stock?: Record<string, number>   // productId → packets currently held
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
  packets: number; cartons: number
  pricePerPacket: number; totalAmount: number
  paymentType: PaymentType; notes: string
  month: string; loggedBy: string; loggedByName: string
  date: string; createdAt: number
}

// ── CREDIT ────────────────────────────────────────────────────────────────────
export interface CreditEntry {
  id?: string; partyId: string; partyName: string; partyType: PartyType
  deliveryId: string; packets: number; amount: number
  status: 'outstanding' | 'settled' | 'pending_approval'
  settledBy?: string; settledByName?: string; settledAt?: number; createdAt: number
}

// ── EXPENSE ───────────────────────────────────────────────────────────────────
export type ExpenseCategory = 'travel' | 'food' | 'misc' | 'marketing' | 'operations'

export interface Expense {
  id?: string; amount: number; category: ExpenseCategory
  note: string; addedBy: string; addedByName: string; date: string; createdAt: number
}

// ── ALERT ─────────────────────────────────────────────────────────────────────
export interface Alert {
  id?: string; type: 'new_party' | 'credit_settlement' | 'low_stock' | 'stock_dispatched' | 'new_allocation' | 'visit_log_submitted'
  message: string; relatedId: string; read: boolean; createdAt: number
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
  outcome: VisitOutcome
  isRevisit?: boolean
  revisitLogId?: string          // points to revisit_logs doc — set on save
  notInterestedReason?: NotInterestedReason
  otherReason?: string
  productId?: string
  productName?: string
  allocationId?: string
  indentId?: string
  notes?: string
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
  date: string
  visits: VisitEntry[]
  endOfDayNote: string
  totalVisited: number
  totalInterested: number
  totalNotInterested: number
  createdAt: number
  updatedAt: number
  isNoEntry?: boolean
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
  openingQty: number
  purchasedQty: number
  soldQty: number
  balanceQty: number
  balanceValue: number
  photoUrl?: string
  aiRead: boolean
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
