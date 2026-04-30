import { useState } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from './firebase'
import { AuthProvider, useAuth } from './context/AuthContext'
import LoginPage from './pages/auth/LoginPage'
import SignupPage from './pages/auth/SignupPage'
import SalesView from './pages/sales/SalesView'
import MarketingView from './pages/marketing/MarketingView'
import AdminDashboard from './pages/admin/AdminDashboard'
import UserManagement from './pages/admin/UserManagement'
import NotificationBell from './components/NotificationBell'

function AppContent() {
  const { firebaseUser, appUser, loading } = useAuth()
  const [authScreen, setAuthScreen] = useState<'login' | 'signup'>('login')
  const [showUserMgmt, setShowUserMgmt] = useState(false)

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#060a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 40 }}>🌿</div>
      <div style={{ color: '#6ee7b7', fontSize: 13, letterSpacing: 2 }}>Loading Ocealgo...</div>
    </div>
  )

  if (!firebaseUser || !appUser) {
    if (authScreen === 'signup') return <SignupPage onSwitch={() => setAuthScreen('login')} />
    return <LoginPage onSwitch={() => setAuthScreen('signup')} />
  }

  if (appUser.status === 'pending' || appUser.status === 'rejected') return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg,#0d3d2e,#060a0f)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 56, marginBottom: 20 }}>{appUser.status === 'pending' ? '⏳' : '❌'}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>
        {appUser.status === 'pending' ? 'Awaiting Approval' : 'Access Rejected'}
      </div>
      <div style={{ color: '#a7f3d0', fontSize: 14, lineHeight: 1.8, marginBottom: 32, maxWidth: 300 }}>
        {appUser.status === 'pending'
          ? 'Your account is pending admin approval. Please check back later.'
          : 'Your account request was rejected. Please contact the admin team.'}
      </div>
      <button onClick={() => signOut(auth)}
        style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '12px 32px', borderRadius: 50, fontSize: 14 }}>
        Sign Out
      </button>
    </div>
  )

  if (showUserMgmt) return <UserManagement onBack={() => setShowUserMgmt(false)} />

  const handleLogout = () => signOut(auth)
  const isAdmin = appUser.role === 'super_admin' || appUser.role === 'admin'

  return (
    <div>
      <div style={{ background: '#0d1117', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: '#6ee7b7', fontSize: 12, fontWeight: 700 }}>🌿 Ocealgo</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <NotificationBell />
          {isAdmin && (
            <button onClick={() => setShowUserMgmt(true)}
              style={{ background: 'rgba(217,119,6,0.15)', border: '1px solid rgba(217,119,6,0.3)', color: '#d97706', borderRadius: 10, padding: '6px 12px', fontSize: 11, fontWeight: 700 }}>
              👥 Users
            </button>
          )}
          <button onClick={handleLogout}
            style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.2)', color: '#dc2626', borderRadius: 10, padding: '6px 12px', fontSize: 11, fontWeight: 700 }}>
            Sign Out
          </button>
        </div>
      </div>
      {appUser.role === 'sales' && <SalesView name={appUser.name} role="sales" onBack={handleLogout} />}
      {appUser.role === 'marketing' && <MarketingView onBack={handleLogout} />}
      {isAdmin && <AdminDashboard onBack={handleLogout} />}
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
