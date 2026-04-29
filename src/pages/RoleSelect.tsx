import { UserRole } from '../types'

interface Props { onSelect: (role: UserRole) => void }

const ROLES = [
  { id: 'murali'    as UserRole, name: 'Murali',    role: 'Sales Team',     emoji: '🤝', color: '#0891b2' },
  { id: 'santhosh'  as UserRole, name: 'Santhosh',  role: 'Sales Team',     emoji: '🤝', color: '#0891b2' },
  { id: 'marketing' as UserRole, name: 'Marketing', role: 'Marketing Team', emoji: '📣', color: '#7c3aed' },
  { id: 'admin'     as UserRole, name: 'Admin',     role: 'Founders View',  emoji: '👑', color: '#d97706' },
]

export default function RoleSelect({ onSelect }: Props) {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg,#0d3d2e 0%,#060a0f 65%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
      <div style={{ marginBottom: 6, fontSize: 11, letterSpacing: 3, color: '#6ee7b7', textTransform: 'uppercase' }}>Welcome to</div>
      <div style={{ fontSize: 38, fontWeight: 900, marginBottom: 4, letterSpacing: -1 }}>Ocealgo</div>
      <div style={{ color: '#6ee7b7', fontSize: 14, marginBottom: 44 }}>🌿 Team Dashboard</div>

      <div style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, color: '#475569', textAlign: 'center', marginBottom: 4, letterSpacing: 2, textTransform: 'uppercase' }}>Who are you?</div>
        {ROLES.map(r => (
          <button key={r.id} onClick={() => onSelect(r.id)}
            style={{ background: 'rgba(255,255,255,0.05)', border: `1.5px solid ${r.color}44`, borderRadius: 16, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, color: '#fff', textAlign: 'left', transition: 'background 0.2s' }}
            onMouseEnter={e => (e.currentTarget.style.background = `${r.color}15`)}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: `${r.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, border: `1px solid ${r.color}44`, flexShrink: 0 }}>{r.emoji}</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 17 }}>{r.name}</div>
              <div style={{ fontSize: 12, color: r.color, marginTop: 2 }}>{r.role}</div>
            </div>
            <div style={{ marginLeft: 'auto', color: '#334155', fontSize: 22 }}>›</div>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 48, color: 'rgba(255,255,255,0.15)', fontSize: 11 }}>🌿 Powered by the ocean</div>
    </div>
  )
}
