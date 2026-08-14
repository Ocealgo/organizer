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

interface ThemeContextType {
  theme: AppTheme
  toggle: () => void
  t: ThemeTokens
}

const dark: ThemeTokens = {
  bg: '#0d1117', bg2: '#161b22', bg3: '#1e2530',
  text: '#f1f5f9', text2: '#94a3b8', text3: '#475569',
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
  text: '#0f172a', text2: '#475569', text3: '#94a3b8',
  border: 'rgba(0,0,0,0.08)', border2: 'rgba(0,0,0,0.14)',
  card: '#ffffff', cardHover: '#f8fafc',
  primary: '#1a5c42', primaryText: '#1a5c42',
  accent: '#0f766e',
  warn: '#b45309',
  tint: 'rgba(15,23,42,0.04)',
  hover: 'rgba(15,23,42,0.03)',
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark', toggle: () => {},
  t: dark,
})

export function ThemeProvider({ children, userId }: { children: ReactNode; userId?: string }) {
  const storageKey = userId ? `ocealgo_theme_${userId}` : 'ocealgo_theme'
  const [theme, setTheme] = useState<AppTheme>(() => {
    try { return (localStorage.getItem(storageKey) as AppTheme) || 'dark' } catch { return 'dark' }
  })

  const t = theme === 'dark' ? dark : light

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

  return <ThemeContext.Provider value={{ theme, toggle, t }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
