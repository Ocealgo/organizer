import { useState } from 'react'
import { signOut, updatePassword, sendPasswordResetEmail } from 'firebase/auth'
import { auth, app } from '../../firebase'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { useTheme } from '../../context/ThemeContext'
import { sendSignInCode, confirmAsExistingUser, phoneAuthMessage } from '../../auth/phoneAuth'
import { readIdentifier } from '../../auth/resolveLogin'
import { pretty } from '../../lib/phone'
import { Eyebrow, Field, Note, GhostButton, PrimaryButton, inputStyle } from '../../components/ui'
import type { ConfirmationResult } from 'firebase/auth'

/**
 * Getting back in when the password is gone.
 *
 * Same box as the sign-in screen: whichever of the two things a rep registered
 * with, they type that. What happens next differs because the two channels
 * differ, not because the app wants them to.
 *
 *   a number → a six-digit code, checked here
 *   an email → a link, opened from the inbox
 *
 * Firebase has no reset-by-code call. What it has is phone sign-in, and a
 * password that can be changed by whoever is currently signed in — so proving
 * you hold the number IS the reset. Enter the code, you are signed in, choose
 * a password, and we sign you straight back out so the new one gets used.
 *
 * That sign-out matters more than it looks. Without it, somebody who just
 * reset their password lands in the app in a session they opened by SMS, never
 * types the password they chose, and has forgotten it again by next week.
 */
interface Props { onDone: (message?: string) => void }

type Step = 'identify' | 'code' | 'password' | 'emailed' | 'asked'

export default function ForgotPasswordPage({ onDone }: Props) {
  const { t } = useTheme()
  const [step, setStep] = useState<Step>('identify')
  const [identifier, setIdentifier] = useState('')
  const [phone, setPhone] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState<ConfirmationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fail = (msg: string) => { setError(msg); setLoading(false) }

  const start = async () => {
    setError('')
    const id = readIdentifier(identifier)
    if (id.kind === 'unusable')
      return setError('Enter the email address or 10-digit mobile number on your account.')

    setLoading(true)
    if (id.kind === 'email') {
      try {
        await sendPasswordResetEmail(auth, id.email)
      } catch { /* deliberately silent — see below */ }
      // The same outcome either way, whether or not that address is on an
      // account. Anything else turns this box into a way to test who has one.
      setSentTo(id.email)
      setStep('emailed')
      setLoading(false)
      return
    }

    try {
      setPending(await sendSignInCode(id.phone))
      setPhone(id.phone)
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
      // An unregistered number is not spelled out. "No account uses that
      // number" tells anyone with a phone book which of your reps are on the
      // system, and this screen takes no sign-in to reach.
      if (e?.code === 'oc/unknown-number') {
        await signOut(auth).catch(() => {})
        setPending(null)
        setCode('')
        setStep('identify')
        fail('That code did not work. Check the number and try again.')
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

  /**
   * The third way back in, for when the other two do not work.
   *
   * An SMS that never arrives and an inbox nobody reads leave a rep with no
   * route at all — which today means ringing somebody and hoping they are
   * free. This puts the same ask in front of whoever is actually allowed to
   * answer it, and the reply is identical whether or not the number is on the
   * system: it has to be, or this becomes a way to find out who works here.
   */
  const askForHelp = async () => {
    setError('')
    const digits = identifier.replace(/\D/g, '').slice(-10)
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return setError('Enter your 10-digit mobile number to ask for help.')
    }
    setLoading(true)
    try {
      const fn = httpsCallable(getFunctions(app, 'asia-south1'), 'requestPasswordReset')
      await fn({ phone: digits })
    } catch {
      // A failure here must not tell the caller anything either.
    }
    setLoading(false)
    setStep('asked')
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
        `If ${sentTo} is on an account, a reset link is on its way. It expires in an hour.`)}
      <GhostButton onClick={() => onDone()}>Back to sign in</GhostButton>
    </>
  )

  if (step === 'password') return shell(
    <>
      {heading('Almost done', 'Choose a password', 'Your number checked out. Pick something you will remember.')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Field label="New password">
          <input type="password" autoComplete="new-password" value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="At least six characters" style={inputStyle(t)} />
        </Field>
        <Field label="Confirm password">
          <input type="password" autoComplete="new-password" value={confirm}
            onChange={e => setConfirm(e.target.value)}
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
        `We sent a six-digit code to +91 ${pretty(phone)}.`)}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Field label="Code">
          <input type="text" inputMode="numeric" autoComplete="one-time-code" value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => e.key === 'Enter' && verify()}
            placeholder="123456" style={inputStyle(t)} />
        </Field>
        {error && <Note tone="warn">{error}</Note>}
        <PrimaryButton onClick={verify} disabled={loading} style={{ width: '100%', padding: '13px 16px' }}>
          {loading ? 'Checking' : 'Continue'}
        </PrimaryButton>
        <GhostButton onClick={() => { setStep('identify'); setCode(''); setError('') }}>
          Start again
        </GhostButton>
      </div>
    </>
  )

  if (step === 'asked') return shell(
    <>
      {heading('Asked', 'Somebody will sort it out',
        'If that number is on the system, the people who can reset it have been told. They will give you a temporary password, and you will be asked to choose your own the moment you sign in.')}
      <GhostButton onClick={() => onDone()}>Back to sign in</GhostButton>
    </>
  )

  return shell(
    <>
      {heading('Forgotten password', 'Reset it',
        'Give us whichever you registered with. A number gets a code, an email gets a link.')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Field label="Email or mobile number">
          <input type="text" autoComplete="username" value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && start()}
            placeholder="you@example.com or 9876543210" style={inputStyle(t)} />
        </Field>
        {error && <Note tone="warn">{error}</Note>}
        <PrimaryButton onClick={start} disabled={loading} style={{ width: '100%', padding: '13px 16px' }}>
          {loading ? 'Sending' : 'Continue'}
        </PrimaryButton>
        <GhostButton onClick={() => onDone()}>Back to sign in</GhostButton>

        <div style={{ borderTop: `0.5px solid ${t.border}`, paddingTop: 20 }}>
          <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.6, marginBottom: 12 }}>
            No code arriving, and no email you can open? Ask the people who can reset it
            for you — put your mobile number in above first.
          </div>
          <GhostButton onClick={askForHelp} disabled={loading}>
            {loading ? 'Asking…' : 'Ask for a reset'}
          </GhostButton>
        </div>
      </div>
    </>
  )
}
