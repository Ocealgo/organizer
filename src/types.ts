export type UserRole = 'murali' | 'santhosh' | 'marketing' | 'admin'

export interface CheckIn {
  id?: string
  name: string
  role: 'sales'
  shops: number
  orders: number
  did: string
  doing: string
  blocker: string
  date: string // YYYY-MM-DD
  createdAt: number
}

export interface PostStatus {
  postId: number
  status: 'pending' | 'in-progress' | 'posted' | 'missed'
  updatedAt: number
  updatedBy: string
  month: string // e.g. "2026-05"
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
