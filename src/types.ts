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
}

// ── STOCK CONFIG ──────────────────────────────────────────────────────────────
export interface StockConfig {
  total: number; locked: number; packetsPerCarton: number; updatedAt: number
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
  id?: string; type: 'new_party' | 'credit_settlement' | 'low_stock' | 'stock_dispatched'
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
export type AllocationStatus = 'pending' | 'sent' | 'paid' | 'overdue'

export interface UnifiedAllocation {
  id?: string
  partyId: string
  partyName: string
  partyType: PartyType
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
  notInterestedReason?: NotInterestedReason
  otherReason?: string
  productId?: string
  productName?: string
  allocationId?: string
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
}

// ── THEME ─────────────────────────────────────────────────────────────────────
export type AppTheme = 'dark' | 'light'
