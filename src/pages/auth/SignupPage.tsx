import { useState } from 'react'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase'

const SUPER_ADMIN_EMAIL = 'amalau14113@gmail.com'
interface Props { onSwitch: () => void }

const inputStyle = {
  width: '100%',
  background: 'rgba(255,255,255,0.06)',
  border: '1.5px solid rgba(255,255,255,0.13)',
  borderRadius: 12,
  padding: '13px 16px',
  fontSize: 14,
  color: '#fff',
  outline: 'none',
  boxSizing: 'border-box' as const,
}

export default function SignupPage({ onSwitch }: Props) {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const validate = () => {
    if (!form.name.trim()) return 'Full name is required'
    if (form.name.trim().length < 2) return 'Enter a valid name'
    if (!form.email.includes('@')) return 'Enter a valid email address'
    if (form.password.length < 6) return 'Password must be at least 6 characters'
    if (form.password !== form.confirm) return 'Passwords do not match'
    return null
  }

  const handleSignup = async () => {
    setError('')
    const err = validate()
    if (err) return setError(err)
    setLoading(true)
    try {
      const { user } = await createUserWithEmailAndPassword(auth, form.email, form.password)
      const isSuperAdmin = form.email === SUPER_ADMIN_EMAIL
      await setDoc(doc(db, 'users', user.uid), {
        email: form.email,
        name: form.name.trim(),
        role: isSuperAdmin ? 'super_admin' : 'offline_sales',
        status: isSuperAdmin ? 'approved' : 'pending',
        createdAt: Date.now(),
      })
      if (!isSuperAdmin) setDone(true)
    } catch (e: any) {
      if (e.code === 'auth/email-already-in-use') setError('This email is already registered')
      else setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (done) return (
    <div style={{ minHeight: '100vh', background: '#000000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 8 }}>Request Sent!</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 12, color: '#fff' }}>Awaiting Approval</div>
      <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, lineHeight: 1.8, marginBottom: 32, maxWidth: 300 }}>
        Your account request has been sent to the admin team. You'll be able to log in once approved.
      </div>
      <button onClick={onSwitch}
        style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '12px 32px', borderRadius: 50, fontSize: 14 }}>
        Back to Login
      </button>
    </div>
  )

  const fields = [
    { label: 'Full Name', key: 'name', type: 'text', placeholder: 'e.g. Murali Kumar' },
    { label: 'Email', key: 'email', type: 'email', placeholder: 'your@email.com' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#000000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
      <div style={{ marginBottom: 6, fontSize: 11, letterSpacing: 3, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase' }}>Join</div>
      <div style={{ fontSize: 34, fontWeight: 900, marginBottom: 4, color: '#fff' }}>Ocealgo</div>
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 36 }}>Create your account</div>
      <div style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {fields.map(f => (
          <div key={f.key}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>{f.label}</div>
            <input type={f.type} value={form[f.key as keyof typeof form]}
              onChange={e => setForm({ ...form, [f.key]: e.target.value })}
              placeholder={f.placeholder}
              style={inputStyle} />
          </div>
        ))}

        {/* Password with show/hide */}
        {[
          { label: 'Password', key: 'password', show: showPass, toggle: () => setShowPass(!showPass), placeholder: 'Min 6 characters' },
          { label: 'Confirm Password', key: 'confirm', show: showConfirm, toggle: () => setShowConfirm(!showConfirm), placeholder: 'Re-enter password' },
        ].map(f => (
          <div key={f.key}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>{f.label}</div>
            <div style={{ position: 'relative' }}>
              <input type={f.show ? 'text' : 'password'} value={form[f.key as keyof typeof form]}
                onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                style={{ ...inputStyle, paddingRight: 52 }} />
              <button onClick={f.toggle}
                style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 12, cursor: 'pointer', padding: 0, fontWeight: 700 }}>
                {f.show ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
        ))}

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', color: '#ef4444', fontSize: 13 }}>
            {error}
          </div>
        )}
        <button onClick={handleSignup} disabled={loading}
          style={{ background: loading ? 'rgba(255,255,255,0.08)' : '#ffffff', color: '#000000', border: 'none', borderRadius: 14, padding: '16px', fontSize: 15, fontWeight: 800, marginTop: 4 }}>
          {loading ? 'Creating account...' : 'Request Access'}
        </button>
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
          Already have an account?{' '}
          <span onClick={onSwitch} style={{ color: '#ffffff', cursor: 'pointer', fontWeight: 700 }}>Log in</span>
        </div>
      </div>
    </div>
  )
}
