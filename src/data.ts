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
  'Brand Story':         '#7c3aed',
  'Ingredient Education':'#0891b2',
  'Mom Relatability':    '#db2777',
  'Ingredient Science':  '#0891b2',
  'Trust & Safety':      '#059669',
  'Festival':            '#d97706',
  'Why Ocealgo':         '#1a5c42',
  'Comparison':          '#dc2626',
  'Myth Busting':        '#7c3aed',
  'FAQ':                 '#059669',
  'Sustainability':      '#16a34a',
  'Trust / FAQ':         '#059669',
  'Product Deep Dive':   '#0891b2',
  'Conversion / CTA':    '#d97706',
}

export const FORMAT_EMOJI: Record<string, string> = {
  'Static Post': '🖼️',
  'Carousel':    '📱',
  'Reel':        '🎬',
}

export const STATUS_CONFIG = {
  pending:      { label: 'Pending',     color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', emoji: '⏳' },
  'in-progress':{ label: 'In Progress', color: '#d97706', bg: 'rgba(217,119,6,0.1)',   emoji: '🔄' },
  posted:       { label: 'Posted',      color: '#16a34a', bg: 'rgba(22,163,74,0.1)',    emoji: '✅' },
  missed:       { label: 'Missed',      color: '#dc2626', bg: 'rgba(220,38,38,0.1)',    emoji: '❌' },
} as const

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
]
