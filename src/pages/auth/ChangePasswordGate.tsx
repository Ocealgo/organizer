import { useState } from 'react'
import { signOut } from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useTheme } from '../../context/ThemeContext'
import { changePassword, accountMessage } from '../../auth/account'
import { Eyebrow, Field, Note, GhostButton, PrimaryButton, inputStyle } from '../../components/ui'

/**
 * The screen a rep lands on after somebody reset their password for them.
 *
 * A temporary password read down a phone line is known to two people. It stops
 * being a shared secret only when the owner replaces it, so that happens
 * before anything else — not as a suggestion in a settings screen somebody
 * will never open.
 *
 * The temporary one is asked for rather than assumed. The sign-in that got
 * here may have been days ago on a resumed session, and Firebase will refuse
 * to change a password without a recent one; asking is both what satisfies
 * that and what proves the person typing is the one who was told it.
 */
interface Props { uid: string; name: string; byName?: string }

export default function ChangePasswordGate({ uid, name, byName }: Props) {
  const { t } = useTheme()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setError('')
    if (!current) return setError('Enter the temporary password you were given.')
    if (next.length < 6) return setError('Use at least six characters.')
    if (next !== confirm) return setError('The two new passwords do not match.')
    if (next === current) return setError('Choose something other than the temporary one.')
    if (!auth.currentUser) return
    setBusy(true)
    try {
      await changePassword(auth.currentUser, current, next)
      // Only once the new password is really in place. Clearing the flag first
      // would drop the gate on a change that then failed.
      await updateDoc(doc(db, 'users', uid), { mustChangePassword: false })
    } catch (e) {
      setError(accountMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: t.bg, display: 'flex', flexDirection: 'column',
      justifyContent: 'center', padding: '40px 24px',
    }}>
      <div style={{ width: '100%', maxWidth: 340, margin: '0 auto' }}>
        <div style={{ marginBottom: 6 }}><Eyebrow>Before you carry on</Eyebrow></div>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: t.text, margin: 0 }}>
          Choose your own password
        </h1>
        <div style={{ fontSize: 14, color: t.text3, marginTop: 8, lineHeight: 1.6, marginBottom: 32 }}>
          {name.split(' ')[0]}, {byName ? `${byName} reset your password` : 'your password was reset'} and
          read you a temporary one. Somebody else knows it, so pick your own now.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Field label="Temporary password">
            <input type="password" autoComplete="current-password" value={current}
              onChange={e => setCurrent(e.target.value)}
              placeholder="The one you were read" style={inputStyle(t)} />
          </Field>
          <Field label="New password">
            <input type="password" autoComplete="new-password" value={next}
              onChange={e => setNext(e.target.value)}
              placeholder="At least six characters" style={inputStyle(t)} />
          </Field>
          <Field label="Confirm new password">
            <input type="password" autoComplete="new-password" value={confirm}
              onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && save()}
              placeholder="Type it again" style={inputStyle(t)} />
          </Field>

          {error && <Note tone="warn">{error}</Note>}

          <PrimaryButton onClick={save} disabled={busy} style={{ width: '100%', padding: '13px 16px' }}>
            {busy ? 'Saving' : 'Save and carry on'}
          </PrimaryButton>
          <GhostButton onClick={() => signOut(auth)}>Sign out</GhostButton>
        </div>
      </div>
    </div>
  )
}
