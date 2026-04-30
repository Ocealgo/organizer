import { useState, useEffect } from 'react'
import { collection, onSnapshot, updateDoc, doc } from 'firebase/firestore'
import { db } from '../../firebase'
import { CreditEntry } from '../../types'
import { useAuth } from '../../context/AuthContext'

interface Props { onBack: () => void }

export default function CreditBook({ onBack }: Props) {
  const { appUser } = useAuth()
  const [credits, setCredits] = useState<CreditEntry[]>([])
  const [updating, setUpdating] = useState<string | null>(null)
  const [filter, setFilter] = useState<'outstanding' | 'pending_approval' | 'settled'>('outstanding')

  const isAdmin = appUser?.role === 'super_admin' || appUser?.role === 'admin'

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'credits'), snap => {
      setCredits(snap.docs.map(d => ({ id: d.id, ...d.data() } as CreditEntry)).sort((a, b) => b.createdAt - a.createdAt))
    })
    return unsub
  }, [])

  const requestSettle = async (id: string) => {
    setUpdating(id)
    await updateDoc(doc(db, 'credits', id), {
      status: 'pending_approval',
      settledBy: appUser!.uid,
      settledByName: appUser!.name,
      settledAt: Date.now(),
    })
    setUpdating(null)
  }

  const approveSettle = async (id: string) => {
    setUpdating(id)
    await updateDoc(doc(db, 'credits', id), { status: 'settled' })
    setUpdating(null)
  }

  const rejectSettle = async (id: string) => {
    setUpdating(id)
    await updateDoc(doc(db, 'credits', id), { status: 'outstanding', settledBy: null, settledByName: null })
    setUpdating(null)
  }

  const filtered = credits.filter(c => c.status === filter)
  const totalOutstanding = credits.filter(c => c.status === 'outstanding').reduce((sum, c) => sum + c.amount, 0)
  const pendingApproval = credits.filter(c => c.status === 'pending_approval').length

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', paddingBottom: 40 }}>
      <div style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', padding: '24px 20px 16px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#ddd6fe', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 16 }}>← Back</button>
        <div style={{ color: '#ddd6fe', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Finance 💜</div>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>Credit Book</div>
        <div style={{ fontSize: 26, fontWeight: 900, color: '#fde68a', marginBottom: 4 }}>₹{totalOutstanding.toLocaleString()}</div>
        <div style={{ color: '#ddd6fe', fontSize: 12, marginBottom: 16 }}>outstanding credit</div>

        {pendingApproval > 0 && isAdmin && (
          <div style={{ background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '8px 14px', marginBottom: 12, fontSize: 12, color: '#fde68a' }}>
            ⚠️ {pendingApproval} settlement{pendingApproval > 1 ? 's' : ''} awaiting your approval
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          {([['outstanding', '⏳ Outstanding'], ['pending_approval', '🔔 Pending'], ['settled', '✅ Settled']] as const).map(([val, label]) => (
            <button key={val} onClick={() => setFilter(val)}
              style={{ flex: 1, background: filter === val ? 'rgba(255,255,255,0.2)' : 'transparent', color: filter === val ? '#fff' : 'rgba(255,255,255,0.45)', border: 'none', borderRadius: '10px 10px 0 0', padding: '9px 4px', fontSize: 10, fontWeight: 800 }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>
              {filter === 'outstanding' ? '💜' : filter === 'pending_approval' ? '🔔' : '✅'}
            </div>
            <div style={{ fontWeight: 700 }}>
              {filter === 'outstanding' ? 'No outstanding credits' : filter === 'pending_approval' ? 'No pending approvals' : 'No settled credits yet'}
            </div>
          </div>
        ) : filtered.map(c => (
          <div key={c.id} style={{ background: '#161b22', borderRadius: 14, padding: 16, border: `1px solid ${c.status === 'outstanding' ? 'rgba(124,58,237,0.3)' : c.status === 'pending_approval' ? 'rgba(245,158,11,0.3)' : 'rgba(22,163,74,0.2)'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 22 }}>{c.partyType === 'distributor' ? '🚚' : '🏪'}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{c.partyName}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{c.packets} packets • {new Date(c.createdAt).toLocaleDateString('en-IN')}</div>
              </div>
              <div style={{ fontWeight: 900, fontSize: 18, color: c.status === 'settled' ? '#16a34a' : '#fde68a' }}>
                ₹{c.amount.toLocaleString()}
              </div>
            </div>

            {c.status === 'outstanding' && (
              <button onClick={() => requestSettle(c.id!)} disabled={updating === c.id}
                style={{ width: '100%', background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.2)', color: '#16a34a', borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 800, opacity: updating === c.id ? 0.5 : 1 }}>
                {isAdmin ? '✅ Mark as Settled' : '📤 Request Settlement'}
              </button>
            )}

            {c.status === 'pending_approval' && (
              <div>
                <div style={{ fontSize: 12, color: '#d97706', marginBottom: 8 }}>🔔 Settlement requested by {c.settledByName}</div>
                {isAdmin && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => approveSettle(c.id!)} disabled={updating === c.id}
                      style={{ flex: 1, background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.2)', color: '#16a34a', borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 800 }}>
                      ✅ Approve
                    </button>
                    <button onClick={() => rejectSettle(c.id!)} disabled={updating === c.id}
                      style={{ flex: 1, background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.2)', color: '#dc2626', borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 800 }}>
                      ❌ Reject
                    </button>
                  </div>
                )}
              </div>
            )}

            {c.status === 'settled' && (
              <div style={{ fontSize: 12, color: '#16a34a' }}>✅ Settled on {c.settledAt ? new Date(c.settledAt).toLocaleDateString('en-IN') : '-'}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
