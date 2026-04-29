export type UserRole = 'super_admin' | 'admin' | 'sales' | 'marketing'
export type AccountStatus = 'pending' | 'approved' | 'rejected'

export interface AppUser {
  uid: string
  email: string
  name: string
  role: UserRole
  status: AccountStatus
  createdAt: number
  approvedAt?: number
  approvedBy?: string
}

export interface CheckIn {
  id?: string
  name: string
  role: 'sales'
  shops: number
  orders: number
  did: string
  doing: string
  blocker: string
  date: string
  createdAt: number
}

export interface PostStatus {
  postId: number
  status: 'pending' | 'in-progress' | 'posted' | 'missed'
  updatedAt: number
  updatedBy: string
  month: string
}

export interface ContentPost {
  id: number
  date: string
  day: string
  pillar: string
  format: 'Static Post' | 'Carousel' | 'Reel'
  topic: string
  week: number
}
