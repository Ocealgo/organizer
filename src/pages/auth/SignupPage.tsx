import { useState } from 'react'
import { createUserWithEmailAndPassword, type ConfirmationResult } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useTheme } from '../../context/ThemeContext'
import { sendLinkCode, phoneAuthMessage } from '../../auth/phoneAuth'
import { isIndianMobile, asTyped, toE164, pretty } from '../../lib/phone'
import { Eyebrow, Field, Note, GhostButton, PrimaryButton, inputStyle } from '../../components/ui'

const SUPER_ADMIN_EMAIL = 'amalau14113@gmail.com'
interface Props { onSwitch: () => void }

export default function SignupPage({ onSwitch }: Props) {
  const { t } = useTheme()
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // Verifying the number is a second step because it cannot be done first:
  // linking a phone requires an account to link it to. So the account is made,
  // then the code goes out, and only then is the number really on the account.
  const [code, setCode] = useState('')
  const [pending, setPending] = useState<ConfirmationResult | null>(null)
  const [unverified, setUnverified] = useState(false)

  const validate = () => {
    if (!form.name.trim()) return 'Enter your full name.'
    if (form.name.trim().length < 2) return 'That name looks too short.'
    if (!form.email.includes('@')) return 'Enter a valid email address.'
    if (!isIndianMobile(form.phone)) return 'Enter a 10-digit Indian mobile number.'
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
      // The number goes in at create time. The rules let a user change only
      // their own name afterwards, so there is no second chance to write it.
      await setDoc(doc(db, 'users', user.uid), {
        email: form.email,
        name: form.name.trim(),
        phone: toE164(form.phone),
        role: isSuperAdmin ? 'super_admin' : 'offline_sales',
        status: isSuperAdmin ? 'approved' : 'pending',
        createdAt: Date.now(),
      })
      if (isSuperAdmin) return
      try {
        setPending(await sendLinkCode(user, form.phone))
      } catch {
        // The account is real and usable by email even if the SMS never went.
        // Losing the whole signup over a texting problem would be worse than
        // carrying on without the number attached.
        setUnverified(true)
        setDone(true)
      }
    } catch (e: any) {
      if (e.code === 'auth/email-already-in-use') setError('An account already uses that email address.')
      else setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const confirmCode = async () => {
    setError('')
    if (code.trim().length < 6) return setError('Enter the six-digit code from the message.')
    if (!pending) return setError('That code has expired. Ask for a new one.')
    setLoading(true)
    try {
      await pending.confirm(code.trim())
      setDone(true)
    } catch (e) {
      setError(phoneAuthMessage(e))
    } finally {
      setLoading(false)
    }
  }

  /** Skipping leaves a working account that cannot be recovered by SMS. */
  const skipVerification = () => { setUnverified(true); setDone(true) }

  const shell = (children: React.ReactNode) => (
    <div style={{
      minHeight: 'var(--oc-screen)', background: t.bg, display: 'flex', flexDirection: 'column',
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
      {unverified && (
        <div style={{ marginBottom: 28 }}>
          <Note tone="warn">
            We could not verify {pretty(form.phone)}. Your account still works with your
            email and password, but you will not be able to reset it by SMS. Ask an admin
            to attach your number once you are approved.
          </Note>
        </div>
      )}
      <GhostButton onClick={onSwitch}>Back to sign in</GhostButton>
    </>
  )

  // Between account-created and number-verified. There is no going back to the
  // form from here — the account already exists — so the only ways out are
  // finishing or explicitly going without.
  if (pending) return shell(
    <>
      <div style={{ marginBottom: 6 }}><Eyebrow>One more step</Eyebrow></div>
      <h1 style={{ fontSize: 22, fontWeight: 500, color: t.text, margin: 0 }}>
        Confirm your number
      </h1>
      <div style={{ fontSize: 14, fontWeight: 400, color: t.text3, marginTop: 8, lineHeight: 1.6, marginBottom: 28 }}>
        We sent a six-digit code to {pretty(form.phone)}. Confirming it lets you sign in
        with your number and reset your password by SMS.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Field label="Code">
          <input type="text" inputMode="numeric" value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => e.key === 'Enter' && confirmCode()}
            placeholder="123456" style={inputStyle(t)} />
        </Field>
        {error && <Note tone="warn">{error}</Note>}
        <PrimaryButton onClick={confirmCode} disabled={loading} style={{ width: '100%', padding: '13px 16px' }}>
          {loading ? 'Checking' : 'Confirm'}
        </PrimaryButton>
        <GhostButton onClick={skipVerification}>Skip for now</GhostButton>
      </div>
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

        <Field label="Mobile number" hint="Indian numbers only. We text a code to confirm it, and it is how you reset a forgotten password.">
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
              fontSize: 14, fontWeight: 400, color: t.text3, pointerEvents: 'none',
            }}>+91</span>
            <input type="tel" inputMode="numeric" value={form.phone}
              onChange={e => setForm({ ...form, phone: asTyped(e.target.value) })}
              placeholder="9876543210"
              style={{ ...inputStyle(t), paddingLeft: 48 }} />
          </div>
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
