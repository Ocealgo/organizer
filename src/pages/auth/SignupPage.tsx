import { useState } from 'react'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useTheme } from '../../context/ThemeContext'
import { Eyebrow, Field, Note, GhostButton, PrimaryButton, inputStyle } from '../../components/ui'

const SUPER_ADMIN_EMAIL = 'amalau14113@gmail.com'
interface Props { onSwitch: () => void }

export default function SignupPage({ onSwitch }: Props) {
  const { t } = useTheme()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const validate = () => {
    if (!form.name.trim()) return 'Enter your full name.'
    if (form.name.trim().length < 2) return 'That name looks too short.'
    if (!form.email.includes('@')) return 'Enter a valid email address.'
    if (form.password.length < 6) return 'Use at least six characters for the password.'
    if (form.password !== form.confirm) return 'The two passwords do not match.'
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
      if (e.code === 'auth/email-already-in-use') setError('An account already uses that email address.')
      else setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div style={{
      minHeight: '100vh', background: t.bg, display: 'flex', flexDirection: 'column',
      justifyContent: 'center', padding: '40px 24px',
    }}>
      <div style={{ width: '100%', maxWidth: 340, margin: '0 auto' }}>{children}</div>
    </div>
  )

  if (done) return shell(
    <>
      <div style={{ marginBottom: 6 }}><Eyebrow>Request sent</Eyebrow></div>
      <h1 style={{ fontSize: 22, fontWeight: 500, color: t.text, margin: 0 }}>
        Waiting for approval
      </h1>
      <div style={{ fontSize: 14, fontWeight: 400, color: t.text3, marginTop: 8, lineHeight: 1.6, marginBottom: 28 }}>
        An admin has to approve your account before you can sign in. You will be able to
        log in with the same email and password once they do.
      </div>
      <GhostButton onClick={onSwitch}>Back to sign in</GhostButton>
    </>
  )

  return shell(
    <>
      <div style={{ marginBottom: 6 }}><Eyebrow>Join the team</Eyebrow></div>
      <h1 style={{ fontSize: 26, fontWeight: 500, color: t.text, margin: 0, letterSpacing: '-0.01em' }}>
        Ocealgo
      </h1>
      <div style={{ fontSize: 14, fontWeight: 400, color: t.text3, marginTop: 5, marginBottom: 36 }}>
        Create your account
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Field label="Full name">
          <input type="text" value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="Murali Kumar" style={inputStyle(t)} />
        </Field>

        <Field label="Email">
          <input type="email" value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            placeholder="you@example.com" style={inputStyle(t)} />
        </Field>

        {([
          { label: 'Password', key: 'password' as const, show: showPass, toggle: () => setShowPass(!showPass), placeholder: 'At least six characters' },
          { label: 'Confirm password', key: 'confirm' as const, show: showConfirm, toggle: () => setShowConfirm(!showConfirm), placeholder: 'Type it again' },
        ]).map(f => (
          <Field key={f.key} label={f.label}>
            <div style={{ position: 'relative' }}>
              <input type={f.show ? 'text' : 'password'} value={form[f.key]}
                onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                style={{ ...inputStyle(t), paddingRight: 62 }} />
              <button className="oc-action" onClick={f.toggle}
                style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: t.text3,
                  fontSize: 13, fontWeight: 400, cursor: 'pointer', padding: 0,
                }}>
                {f.show ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>
        ))}

        {error && <Note tone="warn">{error}</Note>}

        <div>
          <PrimaryButton onClick={handleSignup} disabled={loading} style={{ width: '100%', padding: '13px 16px' }}>
            {loading ? 'Creating your account' : 'Request access'}
          </PrimaryButton>
        </div>

        <div style={{ fontSize: 13, fontWeight: 400, color: t.text3 }}>
          Already have an account?{' '}
          <button className="oc-action" onClick={onSwitch}
            style={{
              background: 'none', border: 'none', padding: 0,
              fontSize: 13, fontWeight: 400, color: t.text, cursor: 'pointer',
              textDecoration: 'underline', textUnderlineOffset: 3,
            }}>
            Sign in
          </button>
        </div>
      </div>
    </>
  )
}
