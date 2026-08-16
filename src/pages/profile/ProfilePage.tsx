import { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { sendPhoneChangeCode, attachPhone, phoneAuthMessage } from '../../auth/phoneAuth'
import { reauthenticate, changePassword, accountMessage } from '../../auth/account'
import { isIndianMobile, asTyped, toE164, fromE164, pretty } from '../../lib/phone'
import {
  PageHeader, Section, Field, Note, GhostButton, PrimaryButton, inputStyle,
} from '../../components/ui'

/**
 * Your own account: the name on it, the number that recovers it, the password
 * that opens it.
 *
 * Both of the changes here ask for the current password first. See
 * src/auth/account.ts for why that is the check rather than a texted code.
 */
interface Props { onBack: () => void }

/** Where the phone flow has got to. Nothing else on the page has steps. */
type PhoneStep = 'idle' | 'password' | 'number' | 'code'

export default function ProfilePage({ onBack }: Props) {
  const { t } = useTheme()
  const { appUser, firebaseUser } = useAuth()

  const [name, setName] = useState(appUser?.name ?? '')
  const [savingName, setSavingName] = useState(false)
  const [nameNote, setNameNote] = useState('')
  const [nameError, setNameError] = useState('')

  const [phoneStep, setPhoneStep] = useState<PhoneStep>('idle')
  const [phonePassword, setPhonePassword] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [phoneCode, setPhoneCode] = useState('')
  const [verificationId, setVerificationId] = useState('')
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [phoneError, setPhoneError] = useState('')
  const [phoneNote, setPhoneNote] = useState('')

  const [pwOpen, setPwOpen] = useState(false)
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwNote, setPwNote] = useState('')

  // The auth record is the truth about the number, not the users document —
  // the document is a copy kept for admins to read. If they ever disagree it
  // is the copy that is wrong, so this shows the original.
  const currentPhone = firebaseUser?.phoneNumber ?? null

  const saveName = async () => {
    setNameError(''); setNameNote('')
    const trimmed = name.trim()
    if (trimmed.length < 2) return setNameError('That name looks too short.')
    if (!firebaseUser) return
    setSavingName(true)
    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), { name: trimmed })
      setNameNote('Saved.')
    } catch {
      setNameError('Could not save that. Try again.')
    } finally {
      setSavingName(false)
    }
  }

  const resetPhoneFlow = () => {
    setPhoneStep('idle'); setPhonePassword(''); setNewPhone('')
    setPhoneCode(''); setVerificationId(''); setPhoneError('')
  }

  const confirmPassword = async () => {
    setPhoneError('')
    if (!phonePassword) return setPhoneError('Enter your current password.')
    if (!auth.currentUser) return
    setPhoneBusy(true)
    try {
      await reauthenticate(auth.currentUser, phonePassword)
      setPhoneStep('number')
    } catch (e) {
      setPhoneError(accountMessage(e))
    } finally {
      setPhoneBusy(false)
    }
  }

  const sendCode = async () => {
    setPhoneError('')
    if (!isIndianMobile(newPhone)) return setPhoneError('Enter a 10-digit Indian mobile number.')
    if (currentPhone && toE164(newPhone) === currentPhone)
      return setPhoneError('That is already the number on your account.')
    setPhoneBusy(true)
    try {
      setVerificationId(await sendPhoneChangeCode(newPhone))
      setPhoneStep('code')
    } catch (e) {
      setPhoneError(phoneAuthMessage(e))
    } finally {
      setPhoneBusy(false)
    }
  }

  const confirmCode = async () => {
    setPhoneError(''); setPhoneNote('')
    if (phoneCode.trim().length < 6) return setPhoneError('Enter the six-digit code from the message.')
    if (!auth.currentUser) return
    setPhoneBusy(true)
    try {
      await attachPhone(auth.currentUser, verificationId, phoneCode.trim())
      // Only now is the number really on the account, and only now will the
      // rules accept it into the copy an admin reads.
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { phone: toE164(newPhone) })
      setPhoneNote(`Your number is now +91 ${pretty(newPhone)}.`)
      resetPhoneFlow()
    } catch (e) {
      setPhoneError(phoneAuthMessage(e))
    } finally {
      setPhoneBusy(false)
    }
  }

  const savePassword = async () => {
    setPwError(''); setPwNote('')
    if (!pw.current) return setPwError('Enter your current password.')
    if (pw.next.length < 6) return setPwError('Use at least six characters.')
    if (pw.next !== pw.confirm) return setPwError('The two new passwords do not match.')
    if (pw.next === pw.current) return setPwError('That is the password you already have.')
    if (!auth.currentUser) return
    setPwBusy(true)
    try {
      await changePassword(auth.currentUser, pw.current, pw.next)
      setPw({ current: '', next: '', confirm: '' })
      setPwOpen(false)
      setPwNote('Password changed.')
    } catch (e) {
      setPwError(accountMessage(e))
    } finally {
      setPwBusy(false)
    }
  }

  const stack = { display: 'flex', flexDirection: 'column' as const, gap: 16 }

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 56 }}>
      <PageHeader
        eyebrow="Yours"
        title="Your account"
        subtitle="Your name, the number that gets you back in, and your password."
        onBack={onBack}
      />

      <div style={{ padding: '24px 20px 48px', display: 'flex', flexDirection: 'column', gap: 36 }}>

        <Section label="Details">
          <div style={stack}>
            <Field label="Full name">
              <input type="text" value={name}
                onChange={e => { setName(e.target.value); setNameNote('') }}
                onKeyDown={e => e.key === 'Enter' && saveName()}
                style={inputStyle(t)} />
            </Field>
            <Field label="Email" hint="Set by whoever created your account. Ask an admin to change it.">
              <input type="email" value={appUser?.email ?? ''} disabled
                style={{ ...inputStyle(t), color: t.text3 }} />
            </Field>
            {nameError && <Note tone="warn">{nameError}</Note>}
            {nameNote && <Note>{nameNote}</Note>}
            <div>
              <GhostButton onClick={saveName} disabled={savingName || name.trim() === appUser?.name}>
                {savingName ? 'Saving' : 'Save name'}
              </GhostButton>
            </div>
          </div>
        </Section>

        <Section label="Mobile number">
          <div style={stack}>
            <div style={{ fontSize: 15, color: currentPhone ? t.text : t.text3 }}>
              {currentPhone ? `+91 ${pretty(fromE164(currentPhone))}` : 'No number on this account yet.'}
            </div>
            <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.6 }}>
              This is what a forgotten password is sent to, and it is the other way to
              sign in. Indian numbers only.
            </div>

            {phoneNote && <Note>{phoneNote}</Note>}

            {phoneStep === 'idle' && (
              <div>
                <GhostButton onClick={() => { setPhoneStep('password'); setPhoneNote('') }}>
                  {currentPhone ? 'Change number' : 'Add a number'}
                </GhostButton>
              </div>
            )}

            {phoneStep === 'password' && (
              <>
                <Field label="Current password" hint="So that a borrowed phone cannot change where your codes go.">
                  <input type="password" autoComplete="current-password" value={phonePassword}
                    onChange={e => setPhonePassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && confirmPassword()}
                    placeholder="Your password" style={inputStyle(t)} />
                </Field>
                {phoneError && <Note tone="warn">{phoneError}</Note>}
                <div style={{ display: 'flex', gap: 12 }}>
                  <PrimaryButton onClick={confirmPassword} disabled={phoneBusy}>
                    {phoneBusy ? 'Checking' : 'Continue'}
                  </PrimaryButton>
                  <GhostButton onClick={resetPhoneFlow}>Cancel</GhostButton>
                </div>
              </>
            )}

            {phoneStep === 'number' && (
              <>
                <Field label="New mobile number" hint="We text a code to this number to prove it is yours.">
                  <div style={{ position: 'relative' }}>
                    <span style={{
                      position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
                      fontSize: 14, color: t.text3, pointerEvents: 'none',
                    }}>+91</span>
                    <input type="tel" inputMode="numeric" value={newPhone}
                      onChange={e => setNewPhone(asTyped(e.target.value))}
                      onKeyDown={e => e.key === 'Enter' && sendCode()}
                      placeholder="9876543210"
                      style={{ ...inputStyle(t), paddingLeft: 48 }} />
                  </div>
                </Field>
                {phoneError && <Note tone="warn">{phoneError}</Note>}
                <div style={{ display: 'flex', gap: 12 }}>
                  <PrimaryButton onClick={sendCode} disabled={phoneBusy}>
                    {phoneBusy ? 'Sending' : 'Send code'}
                  </PrimaryButton>
                  <GhostButton onClick={resetPhoneFlow}>Cancel</GhostButton>
                </div>
              </>
            )}

            {phoneStep === 'code' && (
              <>
                <Field label="Code" hint={`Sent to +91 ${pretty(newPhone)}.`}>
                  <input type="text" inputMode="numeric" autoComplete="one-time-code" value={phoneCode}
                    onChange={e => setPhoneCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    onKeyDown={e => e.key === 'Enter' && confirmCode()}
                    placeholder="123456" style={inputStyle(t)} />
                </Field>
                {phoneError && <Note tone="warn">{phoneError}</Note>}
                <div style={{ display: 'flex', gap: 12 }}>
                  <PrimaryButton onClick={confirmCode} disabled={phoneBusy}>
                    {phoneBusy ? 'Saving' : 'Confirm'}
                  </PrimaryButton>
                  <GhostButton onClick={resetPhoneFlow}>Cancel</GhostButton>
                </div>
              </>
            )}
          </div>
        </Section>

        <Section label="Password">
          <div style={stack}>
            {pwNote && <Note>{pwNote}</Note>}

            {!pwOpen ? (
              <div>
                <GhostButton onClick={() => { setPwOpen(true); setPwNote('') }}>Change password</GhostButton>
              </div>
            ) : (
              <>
                <Field label="Current password">
                  <input type="password" autoComplete="current-password" value={pw.current}
                    onChange={e => setPw({ ...pw, current: e.target.value })}
                    placeholder="Your password" style={inputStyle(t)} />
                </Field>
                <Field label="New password">
                  <input type="password" autoComplete="new-password" value={pw.next}
                    onChange={e => setPw({ ...pw, next: e.target.value })}
                    placeholder="At least six characters" style={inputStyle(t)} />
                </Field>
                <Field label="Confirm new password">
                  <input type="password" autoComplete="new-password" value={pw.confirm}
                    onChange={e => setPw({ ...pw, confirm: e.target.value })}
                    onKeyDown={e => e.key === 'Enter' && savePassword()}
                    placeholder="Type it again" style={inputStyle(t)} />
                </Field>
                {pwError && <Note tone="warn">{pwError}</Note>}
                <div style={{ display: 'flex', gap: 12 }}>
                  <PrimaryButton onClick={savePassword} disabled={pwBusy}>
                    {pwBusy ? 'Saving' : 'Save password'}
                  </PrimaryButton>
                  <GhostButton onClick={() => {
                    setPwOpen(false); setPw({ current: '', next: '', confirm: '' }); setPwError('')
                  }}>Cancel</GhostButton>
                </div>
              </>
            )}
          </div>
        </Section>

      </div>
    </div>
  )
}
