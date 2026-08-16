/**
 * Proving it is still you, before changing something that matters.
 *
 * Firebase requires a recent sign-in before a password or a phone number can
 * be changed, and typing the current password is how that is satisfied here.
 *
 * It is worth being clear why it is the password and not a texted code. The
 * realistic threat to a signed-in account is an unlocked handset — left on a
 * counter, borrowed, taken. That person already has the session. A code sent
 * to the phone arrives on the same phone they are holding, so it proves the
 * phone is near the phone and nothing else. The password is the one factor
 * they do not have, so it is the one worth asking for.
 *
 * A forgotten password is the opposite case: nobody is signed in, and holding
 * the number is the only evidence available. That flow is in
 * ForgotPasswordPage and rightly does use a code.
 */
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword, type User } from 'firebase/auth'

/** Throws on a wrong password; resolves having refreshed the sign-in. */
export async function reauthenticate(user: User, currentPassword: string) {
  if (!user.email) throw Object.assign(new Error('no email'), { code: 'oc/no-email' })
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword))
}

export async function changePassword(user: User, currentPassword: string, next: string) {
  await reauthenticate(user, currentPassword)
  await updatePassword(user, next)
}

/** What went wrong, in words somebody can act on. */
export function accountMessage(e: any): string {
  switch (e?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'That is not your current password.'
    case 'auth/weak-password':
      return 'That password is too easy to guess. Use at least six characters.'
    case 'auth/requires-recent-login':
      return 'For safety, sign out and back in before changing this.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/network-request-failed':
      return 'No connection. Check your signal and try again.'
    case 'oc/no-email':
      return 'This account has no email address, so the password cannot be changed here.'
    default:
      return 'Could not save that. Try again.'
  }
}
