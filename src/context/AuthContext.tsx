import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { onAuthStateChanged, User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { onSnapshot } from '../data/live'
import { auth, db } from '../firebase'
import { AppUser } from '../types'

interface AuthContextType {
  firebaseUser: User | null
  appUser: AppUser | null
  loading: boolean
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  firebaseUser: null,
  appUser: null,
  loading: true,
  refreshUser: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  // One-shot re-read. The live listener below normally keeps things current;
  // this stays for callers that want to force a fetch.
  const refreshUser = async () => {
    if (!firebaseUser) return
    const snap = await getDoc(doc(db, 'users', firebaseUser.uid))
    setAppUser(snap.exists() ? ({ uid: firebaseUser.uid, ...snap.data() } as AppUser) : null)
  }

  useEffect(() => {
    // Subscribe to the user's own document rather than reading it once.
    // Without this, anything an admin changes — approving a pending signup,
    // switching a role, tuning a sales manager's permissions, deactivating an
    // account — only takes effect after the user manually reloads the page.
    let unsubDoc: (() => void) | undefined

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user)

      unsubDoc?.()
      unsubDoc = undefined

      if (!user) {
        setAppUser(null)
        setLoading(false)
        return
      }

      unsubDoc = onSnapshot(
        doc(db, 'users', user.uid),
        (snap) => {
          setAppUser(snap.exists() ? ({ uid: user.uid, ...snap.data() } as AppUser) : null)
          setLoading(false)
        },
        (err) => {
          // Never leave the app stuck on the loading screen.
          console.error('[AuthContext] user document listener failed', err)
          setAppUser(null)
          setLoading(false)
        },
      )
    })

    return () => {
      unsubDoc?.()
      unsubAuth()
    }
  }, [])

  return (
    <AuthContext.Provider value={{ firebaseUser, appUser, loading, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
