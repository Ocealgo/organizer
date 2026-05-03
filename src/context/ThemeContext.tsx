import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { AppTheme } from '../types'

interface ThemeContextType {
  theme: AppTheme
  toggle: () => void
  t: {
    bg: string; bg2: string; bg3: string
    text: string; text2: string; text3: string
    border: string; border2: string
    card: string; cardHover: string
    primary: string; primaryText: string
  }
}

const dark = {
  bg: '#0d1117', bg2: '#161b22', bg3: '#1e2530',
  text: '#f1f5f9', text2: '#94a3b8', text3: '#475569',
  border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
  card: '#161b22', cardHover: '#1e2530',
  primary: '#1a5c42', primaryText: '#6ee7b7',
}

const light = {
  bg: '#f8fafc', bg2: '#ffffff', bg3: '#f1f5f9',
  text: '#0f172a', text2: '#475569', text3: '#94a3b8',
  border: 'rgba(0,0,0,0.08)', border2: 'rgba(0,0,0,0.14)',
  card: '#ffffff', cardHover: '#f8fafc',
  primary: '#1a5c42', primaryText: '#1a5c42',
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

  useEffect(() => {
    try { localStorage.setItem(storageKey, theme) } catch {}
    document.body.style.background = theme === 'dark' ? '#0d1117' : '#f8fafc'
    document.body.style.color = theme === 'dark' ? '#f1f5f9' : '#0f172a'
  }, [theme, storageKey])

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  const t = theme === 'dark' ? dark : light

  return <ThemeContext.Provider value={{ theme, toggle, t }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
