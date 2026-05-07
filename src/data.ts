import { ContentPost } from './types'

export const MAY_POSTS: ContentPost[] = [
  { id: 1,  date: 'May 1',  day: 'Fri', pillar: 'Brand Story',         format: 'Static Post', topic: 'Why Ocealgo was born — origin story',               week: 1 },
  { id: 2,  date: 'May 4',  day: 'Mon', pillar: 'Ingredient Education', format: 'Carousel',    topic: 'Five ingredients. All on purpose.',                  week: 1 },
  { id: 3,  date: 'May 6',  day: 'Wed', pillar: 'Mom Relatability',     format: 'Reel',        topic: 'Reading labels at midnight',                         week: 1 },
  { id: 4,  date: 'May 7',  day: 'Thu', pillar: 'Ingredient Science',   format: 'Carousel',    topic: 'Why the ocean? Seaweed science deep dive',           week: 1 },
  { id: 5,  date: 'May 9',  day: 'Sat', pillar: 'Trust & Safety',       format: 'Static Post', topic: '8–12 times a day — manufacturing credentials',       week: 1 },
  { id: 6,  date: 'May 10', day: 'Sun', pillar: 'Festival',             format: 'Static Post', topic: "Mother's Day — 'To the mum who always checks'",      week: 2 },
  { id: 7,  date: 'May 11', day: 'Mon', pillar: 'Why Ocealgo',          format: 'Static Post', topic: "Don't wait for the rash to decide",                  week: 2 },
  { id: 8,  date: 'May 12', day: 'Tue', pillar: 'Comparison',           format: 'Static Post', topic: 'Ingredient list comparison — us vs them',            week: 2 },
  { id: 9,  date: 'May 14', day: 'Thu', pillar: 'Myth Busting',         format: 'Reel',        topic: 'More ingredients ≠ better product',                  week: 2 },
  { id: 10, date: 'May 16', day: 'Sat', pillar: 'FAQ',                  format: 'Carousel',    topic: '5 questions every parent asks — answered',           week: 3 },
  { id: 11, date: 'May 18', day: 'Mon', pillar: 'Ingredient Education', format: 'Static Post', topic: 'Aloe vera — the science, not the marketing',         week: 3 },
  { id: 12, date: 'May 19', day: 'Tue', pillar: 'Comparison',           format: 'Reel',        topic: 'Hypoallergenic is unregulated — derm tested is not', week: 3 },
  { id: 13, date: 'May 21', day: 'Thu', pillar: 'Mom Relatability',     format: 'Reel',        topic: 'Messy mornings. Quick changes. That one wipe.',      week: 4 },
  { id: 14, date: 'May 23', day: 'Sat', pillar: 'Sustainability',       format: 'Static Post', topic: 'Seaweed grows back in days — sustainability creds',  week: 4 },
  { id: 15, date: 'May 25', day: 'Mon', pillar: 'Trust / FAQ',          format: 'Static Post', topic: '3 things we will never compromise on',               week: 4 },
  { id: 16, date: 'May 26', day: 'Tue', pillar: 'Ingredient Education', format: 'Reel',        topic: 'Coconut oil — gimmick or skin science?',             week: 4 },
  { id: 17, date: 'May 28', day: 'Thu', pillar: 'Product Deep Dive',    format: 'Carousel',    topic: "Parent's guide to baby wipes by skin type",          week: 4 },
  { id: 18, date: 'May 30', day: 'Sat', pillar: 'Conversion / CTA',    format: 'Reel',        topic: 'Peace of mind — final month CTA reel',               week: 4 },
]

export const PILLAR_COLORS: Record<string, string> = {
  'Brand Story':         '#6b7280',
  'Ingredient Education':'#6b7280',
  'Mom Relatability':    '#6b7280',
  'Ingredient Science':  '#6b7280',
  'Trust & Safety':      '#22c55e',
  'Festival':            '#f59e0b',
  'Why Ocealgo':         '#6b7280',
  'Comparison':          '#6b7280',
  'Myth Busting':        '#6b7280',
  'FAQ':                 '#6b7280',
  'Sustainability':      '#22c55e',
  'Trust / FAQ':         '#22c55e',
  'Product Deep Dive':   '#6b7280',
  'Conversion / CTA':    '#f59e0b',
}

export const STATUS_CONFIG = {
  pending:      { label: 'Pending',     color: '#6b7280', bg: 'rgba(107,114,128,0.1)' },
  'in-progress':{ label: 'In Progress', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)'  },
  posted:       { label: 'Posted',      color: '#22c55e', bg: 'rgba(34,197,94,0.1)'   },
  missed:       { label: 'Missed',      color: '#ef4444', bg: 'rgba(239,68,68,0.1)'   },
} as const
