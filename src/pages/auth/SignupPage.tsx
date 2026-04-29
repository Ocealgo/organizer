import { useState } from 'react'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase'

const SUPER_ADMIN_EMAIL = 'amalau14113@gmail.com'

interface Props { onSwitch: () => void }

export default function SignupPage({ onSwitch }: Props) {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const handleSignup = async () => {
    setError('')
    if (!form.name || !form.email || !form.password) return setError('All fields are required')
    if (form.password !== form.confirm) return setError('Passwords do not match')
    if (form.password.length < 6) return setError('Password must be at least 6 characters')

    setLoading(true)
    try {
      const { user } = await createUserWithEmailAndPassword(auth, form.email, form.password)
      const isSuperAdmin = form.email === SUPER_ADMIN_EMAIL
      await setDoc(doc(db, 'users', user.uid), {
        email: form.email,
        name: form.name,
        role: isSuperAdmin ? 'super_admin' : 'sales',
        status: isSuperAdmin ? 'approved' : 'pending',
        createdAt: Date.now(),
      })
      if (!isSuperAdmin) setDone(true)
    } catch (e: any) {
      if (e.code === 'auth/email-already-in-use') setError('Email already registered')
      else setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  if (done) return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg,#0d3d2e,#060a0f)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 24 }}>⏳</div>
      <div style={{ color: '#6ee7b7', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 8 }}>Request Sent!</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>Awaiting Approval</div>
      <div style={{ color: '#a7f3d0', fontSize: 14, lineHeight: 1.8, marginBottom: 32, maxWidth: 300 }}>
        Your account request has been sent to the admin team. You'll be able to log in once your account is approved. 🌿
      </div>
      <button onClick={onSwitch}
        style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '12px 32px', borderRadius: 50, fontSize: 14 }}>
        Back to Login
      </button>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg,#0d3d2e 0%,#060a0f 60%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
      <div style={{ marginBottom: 6, fontSize: 11, letterSpacing: 3, color: '#6ee7b7', textTransform: 'uppercase' }}>Join</div>
      <div style={{ fontSize: 34, fontWeight: 900, marginBottom: 4 }}>Ocealgo</div>
      <div style={{ color: '#6ee7b7', fontSize: 13, marginBottom: 36 }}>🌿 Create your account</div>

      <div style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[
          { label: 'Full Name', key: 'name', type: 'text', placeholder: 'e.g. Murali Kumar' },
          { label: 'Email', key: 'email', type: 'email', placeholder: 'your@email.com' },
          { label: 'Password', key: 'password', type: 'password', placeholder: 'Min 6 characters' },
          { label: 'Confirm Password', key: 'confirm', type: 'password', placeholder: 'Re-enter password' },
        ].map(f => (
          <div key={f.key}>
            <div style={{ fontSize: 11, color: '#6ee7b7', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>{f.label}</div>
            <input type={f.type} value={form[f.key as keyof typeof form]}
              onChange={e => setForm({ ...form, [f.key]: e.target.value })}
              placeholder={f.placeholder}
              style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '13px 16px', fontSize: 14, color: '#fff', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        ))}

        {error && (
          <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 10, padding: '10px 14px', color: '#fca5a5', fontSize: 13 }}>
            ⚠️ {error}
          </div>
        )}

        <button onClick={handleSignup} disabled={loading}
          style={{ background: loading ? '#475569' : 'linear-gradient(135deg,#0d3d2e,#1a5c42)', color: '#fff', border: 'none', borderRadius: 14, padding: '16px', fontSize: 15, fontWeight: 800, marginTop: 4, boxShadow: '0 8px 24px rgba(13,61,46,0.4)' }}>
          {loading ? 'Creating account...' : 'Request Access 🌿'}
        </button>

        <div style={{ textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          Already have an account?{' '}
          <span onClick={onSwitch} style={{ color: '#6ee7b7', cursor: 'pointer', fontWeight: 700 }}>Log in</span>
        </div>
      </div>
    </div>
  )
}
