import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { AppTheme } from '../types'

interface ThemeTokens {
  bg: string; bg2: string; bg3: string
  text: string; text2: string; text3: string
  border: string; border2: string
  card: string; cardHover: string
  primary: string; primaryText: string
  accent: string; warn: string; tint: string; hover: string
}

/**
 * How big everything is, as a whole.
 *
 * Text, padding and buttons scale together rather than the type alone. A rep
 * who cannot read a 13px label usually cannot hit a 34px chip either, and
 * growing the words while leaving the targets where they are fixes the half of
 * the problem that gets reported and not the half that gets sworn at.
 *
 * Kept to three steps because this is a preference, not a slider: somebody
 * standing in a shop should be able to set it once and never think about it.
 */
export type TextScale = 'normal' | 'large' | 'larger'

export const TEXT_SCALE_VALUE: Record<TextScale, number> = {
  normal: 1,
  large: 1.15,
  larger: 1.3,
}

export const TEXT_SCALE_LABEL: Record<TextScale, string> = {
  normal: 'Normal',
  large: 'Large',
  larger: 'Larger',
}

interface ThemeContextType {
  theme: AppTheme
  toggle: () => void
  t: ThemeTokens
  scale: TextScale
  setScale: (s: TextScale) => void
}

/**
 * Text colours are measured, not chosen by eye.
 *
 * `text3` used to be #475569 in dark and #94a3b8 in light, which scored 2.03
 * and 2.27 against the surfaces they sat on — under half of the 4.5:1 that
 * normal-size text needs, and the direct cause of "the subtext is unreadable".
 * The replacements clear 4.5 with a little margin while staying visibly dimmer
 * than text2, so the three-step hierarchy survives:
 *
 *   dark   text 17.3   text2 6.01   text3 4.75
 *   light  text 17.1   text2 6.70   text3 4.80
 *
 * Ratios are against the worst surface each token appears on — bg3 in dark,
 * tint-over-bg in light — so they hold everywhere, not just on the page
 * background. Recompute before changing any of these.
 */
const dark: ThemeTokens = {
  bg: '#0d1117', bg2: '#161b22', bg3: '#1e2530',
  text: '#f1f5f9', text2: '#94a3b8', text3: '#8190a6',
  border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
  card: '#161b22', cardHover: '#1e2530',
  primary: '#1a5c42', primaryText: '#6ee7b7',
  // Colour is reserved for meaning: accent = links, warn = needs action.
  accent: '#6ee7b7',
  warn: '#e0a458',
  tint: 'rgba(255,255,255,0.045)',
  hover: 'rgba(255,255,255,0.035)',
}

const light: ThemeTokens = {
  bg: '#f8fafc', bg2: '#ffffff', bg3: '#f1f5f9',
  text: '#0f172a', text2: '#475569', text3: '#5b6b81',
  border: 'rgba(0,0,0,0.08)', border2: 'rgba(0,0,0,0.14)',
  card: '#ffffff', cardHover: '#f8fafc',
  primary: '#1a5c42', primaryText: '#1a5c42',
  accent: '#0f766e',
  // #b45309 came to 4.44 on tint — a hair under, and warn is the one colour
  // that carries meaning on its own.
  warn: '#a1490a',
  tint: 'rgba(15,23,42,0.04)',
  hover: 'rgba(15,23,42,0.03)',
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark', toggle: () => {},
  t: dark,
  scale: 'normal', setScale: () => {},
})

export function ThemeProvider({ children, userId }: { children: ReactNode; userId?: string }) {
  const storageKey = userId ? `ocealgo_theme_${userId}` : 'ocealgo_theme'
  const scaleKey = userId ? `ocealgo_scale_${userId}` : 'ocealgo_scale'
  const [theme, setTheme] = useState<AppTheme>(() => {
    try { return (localStorage.getItem(storageKey) as AppTheme) || 'dark' } catch { return 'dark' }
  })
  const [scale, setScale] = useState<TextScale>(() => {
    try {
      const saved = localStorage.getItem(scaleKey) as TextScale
      return saved in TEXT_SCALE_VALUE ? saved : 'normal'
    } catch { return 'normal' }
  })

  const t = theme === 'dark' ? dark : light

  useEffect(() => {
    try { localStorage.setItem(scaleKey, scale) } catch {}
    // Read by the one CSS rule that zooms #root, and by --oc-screen, which
    // divides 100vh back down. Without that division a full-height page is
    // 1.3 screens tall at the largest step, because viewport units resolve
    // against the real viewport and do not know they are inside a zoom.
    document.documentElement.style.setProperty(
      '--oc-zoom', String(TEXT_SCALE_VALUE[scale]),
    )
  }, [scale, scaleKey])

  useEffect(() => {
    try { localStorage.setItem(storageKey, theme) } catch {}
    document.body.style.background = t.bg
    document.body.style.color = t.text
    // Exposed as CSS variables so :hover and :focus-visible can be themed —
    // inline styles cannot express pseudo-classes.
    const root = document.documentElement.style
    root.setProperty('--oc-text', t.text)
    root.setProperty('--oc-text2', t.text2)
    root.setProperty('--oc-hover', t.hover)
    root.setProperty('--oc-accent', t.accent)
    root.setProperty('--oc-border', t.border)
  }, [theme, storageKey, t])

  const toggle = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark')

  return (
    <ThemeContext.Provider value={{ theme, toggle, t, scale, setScale }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
