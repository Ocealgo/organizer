import { useState } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase'

interface Props { onSwitch: () => void }

export default function LoginPage({ onSwitch }: Props) {
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPass, setShowPass] = useState(false)

  const handleLogin = async () => {
    setError('')
    if (!form.email || !form.password) return setError('Please fill in all fields')
    setLoading(true)
    try {
      const { user } = await signInWithEmailAndPassword(auth, form.email, form.password)
      const snap = await getDoc(doc(db, 'users', user.uid))
      if (snap.exists()) {
        const data = snap.data()
        if (data.status === 'pending') {
          await auth.signOut()
          setError('Your account is pending admin approval. Please wait.')
        } else if (data.status === 'rejected') {
          await auth.signOut()
          setError('Your account request was rejected. Contact admin.')
        }
      }
    } catch (e: any) {
      if (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password') setError('Invalid email or password')
      else if (e.code === 'auth/user-not-found') setError('No account found with this email')
      else setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg,#0d3d2e 0%,#060a0f 60%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
      <div style={{ marginBottom: 6, fontSize: 11, letterSpacing: 3, color: '#6ee7b7', textTransform: 'uppercase' }}>Welcome back</div>
      <div style={{ fontSize: 34, fontWeight: 900, marginBottom: 4 }}>Ocealgo</div>
      <div style={{ color: '#6ee7b7', fontSize: 13, marginBottom: 36 }}>🌿 Team Dashboard</div>
      <div style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 11, color: '#6ee7b7', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>Email</div>
          <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
            placeholder="your@email.com"
            style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '13px 16px', fontSize: 14, color: '#fff', outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#6ee7b7', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>Password</div>
          <div style={{ position: 'relative' }}>
            <input type={showPass ? 'text' : 'password'} value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="Your password"
              style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '13px 48px 13px 16px', fontSize: 14, color: '#fff', outline: 'none', boxSizing: 'border-box' }} />
            <button onClick={() => setShowPass(!showPass)}
              style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748b', fontSize: 18, cursor: 'pointer', padding: 0 }}>
              {showPass ? '🙈' : '👁️'}
            </button>
          </div>
        </div>
        {error && (
          <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 10, padding: '10px 14px', color: '#fca5a5', fontSize: 13 }}>
            ⚠️ {error}
          </div>
        )}
        <button onClick={handleLogin} disabled={loading}
          style={{ background: loading ? '#475569' : 'linear-gradient(135deg,#0d3d2e,#1a5c42)', color: '#fff', border: 'none', borderRadius: 14, padding: '16px', fontSize: 15, fontWeight: 800, marginTop: 4, boxShadow: '0 8px 24px rgba(13,61,46,0.4)' }}>
          {loading ? 'Logging in...' : 'Log In 🌿'}
        </button>
        <div style={{ textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          Don't have an account?{' '}
          <span onClick={onSwitch} style={{ color: '#6ee7b7', cursor: 'pointer', fontWeight: 700 }}>Request access</span>
        </div>
      </div>
    </div>
  )
}
