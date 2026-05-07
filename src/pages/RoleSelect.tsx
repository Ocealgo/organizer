import { UserRole } from '../types'

interface Props { onSelect: (role: UserRole) => void }

const ROLES = [
  { id: 'murali'    as UserRole, name: 'Murali',    role: 'Sales Team',     color: '#fff' },
  { id: 'santhosh'  as UserRole, name: 'Santhosh',  role: 'Sales Team',     color: '#fff' },
  { id: 'marketing' as UserRole, name: 'Marketing', role: 'Marketing Team', color: '#fff' },
  { id: 'admin'     as UserRole, name: 'Admin',     role: 'Founders View',  color: '#fff' },
]

export default function RoleSelect({ onSelect }: Props) {
  return (
    <div style={{ minHeight: '100vh', background: '#000000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
      <div style={{ marginBottom: 6, fontSize: 11, letterSpacing: 3, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Welcome to</div>
      <div style={{ fontSize: 38, fontWeight: 900, marginBottom: 4, letterSpacing: -1, color: '#fff' }}>Ocealgo</div>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, marginBottom: 44 }}>Team Dashboard</div>

      <div style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginBottom: 4, letterSpacing: 2, textTransform: 'uppercase' }}>Who are you?</div>
        {ROLES.map(r => (
          <button key={r.id} onClick={() => onSelect(r.id)}
            style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, color: '#fff', textAlign: 'left' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900, color: '#fff', border: '1px solid rgba(255,255,255,0.12)', flexShrink: 0 }}>
              {r.name[0]}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 17 }}>{r.name}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{r.role}</div>
            </div>
            <div style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.3)', fontSize: 22 }}>›</div>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 48, color: 'rgba(255,255,255,0.12)', fontSize: 11 }}>Powered by the ocean</div>
    </div>
  )
}
