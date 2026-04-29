import { useState } from 'react'
import { UserRole } from './types'
import RoleSelect from './pages/RoleSelect'
import SalesView from './pages/sales/SalesView'
import MarketingView from './pages/marketing/MarketingView'
import AdminDashboard from './pages/admin/AdminDashboard'

export default function App() {
  const [user, setUser] = useState<UserRole | null>(null)

  if (!user) return <RoleSelect onSelect={setUser} />

  if (user === 'murali' || user === 'santhosh')
    return <SalesView name={user === 'murali' ? 'Murali' : 'Santhosh'} role={user} onBack={() => setUser(null)} />

  if (user === 'marketing')
    return <MarketingView onBack={() => setUser(null)} />

  return <AdminDashboard onBack={() => setUser(null)} />
}
