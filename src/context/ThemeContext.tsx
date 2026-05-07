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
  bg: '#0a0a0a', bg2: '#111111', bg3: '#1a1a1a',
  text: '#ffffff', text2: '#a0a0a0', text3: '#555555',
  border: 'rgba(255,255,255,0.07)', border2: 'rgba(255,255,255,0.13)',
  card: '#111111', cardHover: '#1a1a1a',
  primary: '#ffffff', primaryText: '#000000',
}

const light = {
  bg: '#ffffff', bg2: '#f5f5f5', bg3: '#eeeeee',
  text: '#000000', text2: '#555555', text3: '#999999',
  border: 'rgba(0,0,0,0.07)', border2: 'rgba(0,0,0,0.13)',
  card: '#f5f5f5', cardHover: '#eeeeee',
  primary: '#000000', primaryText: '#ffffff',
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
    document.body.style.background = theme === 'dark' ? '#0a0a0a' : '#ffffff'
    document.body.style.color = theme === 'dark' ? '#ffffff' : '#000000'
  }, [theme, storageKey])

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  const t = theme === 'dark' ? dark : light

  return <ThemeContext.Provider value={{ theme, toggle, t }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
