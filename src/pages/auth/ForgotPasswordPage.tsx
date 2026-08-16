import { useState } from 'react'
import { signOut, updatePassword, sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../../firebase'
import { useTheme } from '../../context/ThemeContext'
import { sendSignInCode, confirmAsExistingUser, phoneAuthMessage } from '../../auth/phoneAuth'
import { isIndianMobile, asTyped, pretty } from '../../lib/phone'
import { Eyebrow, Field, Note, GhostButton, PrimaryButton, inputStyle } from '../../components/ui'
import type { ConfirmationResult } from 'firebase/auth'

/**
 * Resetting a forgotten password with an SMS code.
 *
 * Firebase has no "reset by OTP" call. What it has is phone sign-in, and a
 * password that can be changed by whoever is currently signed in. So the code
 * is not checked against the old password at all — proving you hold the number
 * on the account IS the reset. Enter code, you are signed in, set a new
 * password, and we sign you straight back out so the new one gets used.
 *
 * The sign-out at the end matters more than it looks. Without it somebody who
 * reset their password lands in the app in a session they opened by SMS, never
 * types the password they just chose, and forgets it again by next week.
 */
interface Props { onDone: (message?: string) => void }

type Step = 'number' | 'code' | 'password' | 'emailed'

export default function ForgotPasswordPage({ onDone }: Props) {
  const { t } = useTheme()
  const [step, setStep] = useState<Step>('number')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState<ConfirmationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fail = (msg: string) => { setError(msg); setLoading(false) }

  const send = async () => {
    setError('')
    if (!isIndianMobile(phone)) return setError('Enter the 10-digit mobile number on your account.')
    setLoading(true)
    try {
      setPending(await sendSignInCode(phone))
      setStep('code')
      setLoading(false)
    } catch (e) { fail(phoneAuthMessage(e)) }
  }

  const verify = async () => {
    setError('')
    if (code.trim().length < 6) return setError('Enter the six-digit code from the message.')
    if (!pending) return setError('That code has expired. Ask for a new one.')
    setLoading(true)
    try {
      await confirmAsExistingUser(pending, code.trim())
      setStep('password')
      setLoading(false)
    } catch (e: any) {
      // An unknown number is deliberately not spelled out. "No account uses
      // that number" tells anyone with a phone book which of your reps are on
      // the system, and this screen needs no sign-in to reach.
      if (e?.code === 'oc/unknown-number') {
        await signOut(auth).catch(() => {})
        fail('If that number is on an account, a code has been sent. Check your messages.')
        setStep('number')
      } else fail(phoneAuthMessage(e))
    }
  }

  const save = async () => {
    setError('')
    if (password.length < 6) return setError('Use at least six characters.')
    if (password !== confirm) return setError('The two passwords do not match.')
    setLoading(true)
    try {
      if (!auth.currentUser) throw new Error('session lost')
      await updatePassword(auth.currentUser, password)
      await signOut(auth)
      onDone('Password changed. Sign in with your new password.')
    } catch {
      fail('Could not change the password. Ask for a new code and try again.')
    }
  }

  // The free, always-available fallback. SMS can be out of quota, out of
  // credit, or simply not arriving in a shop with no signal; an emailed link
  // costs nothing and works everywhere, so it stays one tap away throughout.
  const emailInstead = async () => {
    setError('')
    if (!email.includes('@')) return setError('Enter the email address on your account.')
    setLoading(true)
    try {
      await sendPasswordResetEmail(auth, email.trim())
    } catch { /* deliberately silent — see below */ }
    // Always the same outcome, whether or not the address is on an account.
    // Anything else turns this box into a way to test who has an account.
    setStep('emailed')
    setLoading(false)
  }

  const shell = (children: React.ReactNode) => (
    <div style={{
      minHeight: '100vh', background: t.bg, display: 'flex', flexDirection: 'column',
      justifyContent: 'center', padding: '40px 24px',
    }}>
      <div style={{ width: '100%', maxWidth: 340, margin: '0 auto' }}>{children}</div>
    </div>
  )

  const heading = (eyebrow: string, title: string, sub: string) => (
    <>
      <div style={{ marginBottom: 6 }}><Eyebrow>{eyebrow}</Eyebrow></div>
      <h1 style={{ fontSize: 26, fontWeight: 500, color: t.text, margin: 0, letterSpacing: '-0.01em' }}>
        {title}
      </h1>
      <div style={{ fontSize: 14, fontWeight: 400, color: t.text3, marginTop: 5, marginBottom: 36, lineHeight: 1.6 }}>
        {sub}
      </div>
    </>
  )

  if (step === 'emailed') return shell(
    <>
      {heading('Check your email', 'Link sent',
        `If ${email.trim()} is on an account, a reset link is on its way. It expires in an hour.`)}
      <GhostButton onClick={() => onDone()}>Back to sign in</GhostButton>
    </>
  )

  if (step === 'password') return shell(
    <>
      {heading('Almost done', 'Choose a password', 'Your number checked out. Pick something you will remember.')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Field label="New password">
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="At least six characters" style={inputStyle(t)} />
        </Field>
        <Field label="Confirm password">
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
            placeholder="Type it again" style={inputStyle(t)} />
        </Field>
        {error && <Note tone="warn">{error}</Note>}
        <PrimaryButton onClick={save} disabled={loading} style={{ width: '100%', padding: '13px 16px' }}>
          {loading ? 'Saving' : 'Save password'}
        </PrimaryButton>
      </div>
    </>
  )

  if (step === 'code') return shell(
    <>
      {heading('Check your messages', 'Enter the code',
        `We sent a six-digit code to ${pretty(phone)}.`)}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Field label="Code">
          <input type="text" inputMode="numeric" value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => e.key === 'Enter' && verify()}
            placeholder="123456" style={inputStyle(t)} />
        </Field>
        {error && <Note tone="warn">{error}</Note>}
        <PrimaryButton onClick={verify} disabled={loading} style={{ width: '100%', padding: '13px 16px' }}>
          {loading ? 'Checking' : 'Continue'}
        </PrimaryButton>
        <GhostButton onClick={() => { setStep('number'); setCode(''); setError('') }}>
          Use a different number
        </GhostButton>
      </div>
    </>
  )

  return shell(
    <>
      {heading('Forgotten password', 'Reset it',
        'We will text a code to the number on your account.')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Field label="Mobile number">
          <input type="tel" inputMode="numeric" value={phone}
            onChange={e => setPhone(asTyped(e.target.value))}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="10-digit mobile number" style={inputStyle(t)} />
        </Field>
        {error && <Note tone="warn">{error}</Note>}
        <PrimaryButton onClick={send} disabled={loading} style={{ width: '100%', padding: '13px 16px' }}>
          {loading ? 'Sending' : 'Send code'}
        </PrimaryButton>

        <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 20 }}>
          <div style={{ fontSize: 13, color: t.text3, marginBottom: 14, lineHeight: 1.6 }}>
            No signal, or no number on your account? Get a link by email instead.
          </div>
          <Field label="Email">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && emailInstead()}
              placeholder="you@example.com" style={inputStyle(t)} />
          </Field>
          <div style={{ marginTop: 14 }}>
            <GhostButton onClick={emailInstead} disabled={loading}>Email me a link</GhostButton>
          </div>
        </div>

        <GhostButton onClick={() => onDone()}>Back to sign in</GhostButton>
      </div>
    </>
  )
}
