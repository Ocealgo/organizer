import { useState } from 'react'
import { signOut } from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useTheme } from '../../context/ThemeContext'
import { sendPhoneChangeCode, attachPhone, phoneAuthMessage } from '../../auth/phoneAuth'
import { isIndianMobile, asTyped, toE164, pretty } from '../../lib/phone'
import { Eyebrow, Field, Note, GhostButton, PrimaryButton, inputStyle } from '../../components/ui'

/**
 * The wall between an account with no mobile number and the app.
 *
 * A number is mandatory, and mandatory has to mean continuously rather than
 * only at the instant of signing up. Enforcing it only on the signup form
 * leaves two holes: everybody who registered before the form asked, and
 * anybody whose confirmation SMS failed and who was let through rather than
 * having their new account thrown away.
 *
 * Both walk into this on their next sign-in, so the rule becomes true of the
 * whole staff list rather than of new rows in it. There is no way past except
 * finishing or signing out — a gate with a way around it is decoration.
 *
 * No current password is asked for here, unlike changing a number from the
 * profile page. There is nothing yet to protect: the account has no number, so
 * there is no recovery route for a borrowed handset to redirect.
 */
interface Props { name: string }

export default function AddPhoneGate({ name }: Props) {
  const { t } = useTheme()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [verificationId, setVerificationId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async () => {
    setError('')
    if (!isIndianMobile(phone)) return setError('Enter a 10-digit Indian mobile number.')
    setBusy(true)
    try {
      setVerificationId(await sendPhoneChangeCode(phone))
    } catch (e) {
      setError(phoneAuthMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    setError('')
    if (code.trim().length < 6) return setError('Enter the six-digit code from the message.')
    if (!auth.currentUser) return
    setBusy(true)
    try {
      await attachPhone(auth.currentUser, verificationId, code.trim())
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { phone: toE164(phone) })
      // Nothing to navigate to. AuthContext sees the account has a number now
      // and App stops rendering this screen on the next pass.
    } catch (e) {
      setError(phoneAuthMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      minHeight: 'var(--oc-screen)', background: t.bg, display: 'flex', flexDirection: 'column',
      justifyContent: 'center', padding: '40px 24px',
    }}>
      <div style={{ width: '100%', maxWidth: 340, margin: '0 auto' }}>
        <div style={{ marginBottom: 6 }}><Eyebrow>One thing first</Eyebrow></div>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: t.text, margin: 0 }}>
          Add your mobile number
        </h1>
        <div style={{ fontSize: 14, color: t.text3, marginTop: 8, lineHeight: 1.6, marginBottom: 32 }}>
          {name.split(' ')[0]}, every account needs a number on it. It is how you get back
          in if you forget your password, and it is the other way to sign in.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {!verificationId ? (
            <>
              <Field label="Mobile number" hint="Indian numbers only. We text a code to confirm it.">
                <div style={{ position: 'relative' }}>
                  <span style={{
                    position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 14, color: t.text3, pointerEvents: 'none',
                  }}>+91</span>
                  <input type="tel" inputMode="numeric" value={phone}
                    onChange={e => setPhone(asTyped(e.target.value))}
                    onKeyDown={e => e.key === 'Enter' && send()}
                    placeholder="9876543210"
                    style={{ ...inputStyle(t), paddingLeft: 48 }} />
                </div>
              </Field>
              {error && <Note tone="warn">{error}</Note>}
              <PrimaryButton onClick={send} disabled={busy} style={{ width: '100%', padding: '13px 16px' }}>
                {busy ? 'Sending' : 'Send code'}
              </PrimaryButton>
            </>
          ) : (
            <>
              <Field label="Code" hint={`Sent to +91 ${pretty(phone)}.`}>
                <input type="text" inputMode="numeric" autoComplete="one-time-code" value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={e => e.key === 'Enter' && confirm()}
                  placeholder="123456" style={inputStyle(t)} />
              </Field>
              {error && <Note tone="warn">{error}</Note>}
              <PrimaryButton onClick={confirm} disabled={busy} style={{ width: '100%', padding: '13px 16px' }}>
                {busy ? 'Saving' : 'Confirm'}
              </PrimaryButton>
              <GhostButton onClick={() => { setVerificationId(''); setCode(''); setError('') }}>
                Use a different number
              </GhostButton>
            </>
          )}

          <GhostButton onClick={() => signOut(auth)}>Sign out</GhostButton>
        </div>
      </div>
    </div>
  )
}
