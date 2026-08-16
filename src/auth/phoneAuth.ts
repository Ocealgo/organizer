/**
 * The SMS side of signing in.
 *
 * Firebase will not send an OTP from the web without a reCAPTCHA to prove the
 * request came from a browser and not a script running up somebody's SMS bill.
 * The verifier is invisible — nobody sees a puzzle — but it is stateful: once
 * it has been spent on a send it has to be thrown away before the next one, or
 * the second send fails with a stale-token error that reads like a network
 * problem and sends you looking in the wrong place.
 *
 * So: one verifier per send, always torn down. The cost of recreating it is
 * nothing next to the cost of debugging the alternative.
 */
import {
  RecaptchaVerifier, signInWithPhoneNumber, linkWithPhoneNumber, deleteUser,
  PhoneAuthProvider, linkWithCredential, updatePhoneNumber,
  type ConfirmationResult, type User,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { toE164 } from '../lib/phone'

/** The reCAPTCHA needs somewhere in the DOM to live, even when invisible. */
const CONTAINER_ID = 'oc-recaptcha'

function container() {
  let el = document.getElementById(CONTAINER_ID)
  if (!el) {
    el = document.createElement('div')
    el.id = CONTAINER_ID
    document.body.appendChild(el)
  }
  return el
}

async function withVerifier<T>(run: (v: RecaptchaVerifier) => Promise<T>): Promise<T> {
  const verifier = new RecaptchaVerifier(auth, container(), { size: 'invisible' })
  try {
    return await run(verifier)
  } finally {
    // Clearing is not optional. See the note at the top of this file.
    try { verifier.clear() } catch { /* already gone */ }
  }
}

/** Send a code to a number, to sign in as whoever owns it. */
export const sendSignInCode = (tenDigits: string): Promise<ConfirmationResult> =>
  withVerifier(v => signInWithPhoneNumber(auth, toE164(tenDigits), v))

/** Send a code to attach a number to the account that is already signed in. */
export const sendLinkCode = (user: User, tenDigits: string): Promise<ConfirmationResult> =>
  withVerifier(v => linkWithPhoneNumber(user, toE164(tenDigits), v))

/**
 * Send a code to a number somebody wants to put ON their account.
 *
 * The code goes to the NEW number, never the one already registered. Texting
 * the old one would only prove they own the number they are trying to replace,
 * which they demonstrated by being signed in — it says nothing about whether
 * the new one is theirs. Get a digit wrong under that scheme and the account's
 * only recovery route now points at a stranger's handset.
 */
export const sendPhoneChangeCode = (tenDigits: string): Promise<string> =>
  withVerifier(v => new PhoneAuthProvider(auth).verifyPhoneNumber(toE164(tenDigits), v))

/**
 * Put the freshly-verified number on the account.
 *
 * Linking and updating are different calls for what a user experiences as one
 * action, so the difference is decided here rather than at every call site.
 */
export async function attachPhone(user: User, verificationId: string, code: string) {
  const credential = PhoneAuthProvider.credential(verificationId, code)
  if (user.phoneNumber) await updatePhoneNumber(user, credential)
  else await linkWithCredential(user, credential)

  // The rules check the users document against the phone number on the auth
  // token, and the token still carries the old one — or none — until it is
  // refreshed. Without this the write that follows is denied, which looks like
  // a permissions bug and is really a staleness one.
  await user.getIdToken(true)
}

/**
 * Confirm a code, and refuse to be signed in as a stranger.
 *
 * Phone sign-in does not fail on an unknown number — it cheerfully creates a
 * brand new account. That account has a fresh uid, no users document, no role
 * and no data, so the app would bounce straight back to the sign-in screen
 * with no explanation while a junk account accumulated in the project.
 *
 * Confirming and then checking is the only order available: the uid does not
 * exist until the code is accepted. So if there is no user document behind the
 * number, the account we just caused to exist is deleted again before anyone
 * sees it. Deletion needs a recent sign-in, which is exactly what just
 * happened, so this is the one moment it is guaranteed to work.
 */
export async function confirmAsExistingUser(
  confirmation: ConfirmationResult,
  code: string,
): Promise<User> {
  const { user } = await confirmation.confirm(code)
  const known = await getDoc(doc(db, 'users', user.uid))
  if (!known.exists()) {
    await deleteUser(user).catch(() => { /* leave it; the sign-out still protects the session */ })
    throw Object.assign(new Error('unknown-number'), { code: 'oc/unknown-number' })
  }
  return user
}

/**
 * What went wrong, in words a rep can act on.
 *
 * Firebase's own messages name internal concepts — credentials, verification
 * IDs, quota projects — none of which mean anything to somebody standing in a
 * shop wondering why the code has not arrived.
 */
export function phoneAuthMessage(e: any): string {
  switch (e?.code) {
    case 'auth/invalid-phone-number':
      return 'That does not look like a valid mobile number.'
    case 'auth/invalid-verification-code':
      return 'That code is not right. Check the message and type it again.'
    case 'auth/code-expired':
      return 'That code has expired. Ask for a new one.'
    case 'auth/too-many-requests':
      return 'Too many attempts from this device. Wait a few minutes and try again.'
    case 'auth/quota-exceeded':
      return 'We cannot send any more codes right now. Try again later, or sign in with your email.'
    case 'auth/credential-already-in-use':
    case 'auth/account-exists-with-different-credential':
      return 'That number is already registered to another account.'
    case 'auth/provider-already-linked':
      return 'This account already has a number attached.'
    case 'auth/network-request-failed':
      return 'No connection. Check your signal and try again.'
    default:
      return 'Something went wrong sending the code. Try again.'
  }
}
