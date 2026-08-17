/**
 * The SMS side of signing in.
 *
 * Firebase will not send an OTP from the web without a reCAPTCHA to prove the
 * request came from a browser and not a script running up somebody's SMS bill.
 * The verifier is invisible — nobody sees a puzzle — but it is stateful, and
 * so is the element it renders into.
 *
 * One verifier, rendered once, reset between uses
 * -----------------------------------------------
 * This was originally a fresh verifier and a fresh element per send, which is
 * the obvious way to write it and is wrong twice over.
 *
 * `verifier.clear()` releases the verifier but leaves grecaptcha's widget in
 * the node, and grecaptcha will not render twice into the same node — so a
 * shared element works once per page load and then throws "reCAPTCHA has
 * already been rendered in this element" forever.
 *
 * Worse, building the verifier inside the click handler and executing it
 * immediately runs the challenge in an async continuation, after the user
 * gesture that started it has lapsed, against a widget that may not have
 * finished rendering. That yields a token the server rejects as
 * INVALID_APP_CREDENTIAL while every setting in the console looks correct —
 * an expensive thing to debug, because nothing about the message points here.
 *
 * So: one verifier for the life of the page, `render()`ed before anything uses
 * it, and reset after each send so the next one gets a fresh challenge rather
 * than a spent token. This is the shape the Firebase documentation uses, and
 * the reasons it uses it are the two paragraphs above.
 */
import {
  RecaptchaVerifier, signInWithPhoneNumber, linkWithPhoneNumber, deleteUser,
  PhoneAuthProvider, linkWithCredential, updatePhoneNumber,
  type ConfirmationResult, type User,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { toE164 } from '../lib/phone'

declare global {
  interface Window { grecaptcha?: { reset: (widgetId: number) => void } }
}

let ready: Promise<{ verifier: RecaptchaVerifier; widgetId: number }> | null = null

/**
 * The page's one verifier, built and rendered on first use.
 *
 * Parked off-screen rather than `display: none`: grecaptcha measures and
 * executes inside this element, and an element with no box at all is a
 * category of thing it has historically objected to.
 */
function ensureVerifier() {
  if (!ready) {
    ready = (async () => {
      const host = document.createElement('div')
      host.id = 'oc-recaptcha'
      host.style.position = 'absolute'
      host.style.left = '-9999px'
      host.style.top = '0'
      document.body.appendChild(host)

      const verifier = new RecaptchaVerifier(auth, host, { size: 'invisible' })
      // Rendering up front rather than letting the first verify() do it. A
      // challenge executed against a half-rendered widget is where the bad
      // tokens come from.
      const widgetId = await verifier.render()
      return { verifier, widgetId }
    })().catch((e) => {
      // Never cache a broken verifier — the next attempt should get to build
      // a new one rather than inheriting this failure for the whole session.
      ready = null
      throw e
    })
  }
  return ready
}

/**
 * A probe for when a send fails and the console settings all look right.
 *
 * Run `__phoneDebug()` from the browser console. It builds a verifier, renders
 * it, solves the challenge and reports the token — and stops there. It
 * deliberately does not send: an invisible reCAPTCHA hands back the same token
 * until it is reset, so solving here and then sending would present a
 * twice-used token and fail for a reason the probe itself created.
 *
 * A long token means the browser half works and the server is refusing it.
 * No token, or a short one, means the failure is here and the console settings
 * are a red herring. Those two point at completely different places, and the
 * error Firebase returns does not distinguish them.
 */
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__phoneDebug = async (tenDigits?: string) => {
    const host = document.createElement('div')
    host.style.position = 'absolute'
    host.style.left = '-9999px'
    document.body.appendChild(host)
    try {
      const probe = new RecaptchaVerifier(auth, host, { size: 'invisible' })
      const widgetId = await probe.render()
      const token = await probe.verify()
      console.log('[phoneDebug] widget id   :', widgetId)
      console.log('[phoneDebug] token length:', token ? token.length : '(none)')

      if (!tenDigits) {
        console.log('[phoneDebug] pass a number to also try the send, e.g. __phoneDebug("9876543210")')
        return
      }

      // Straight at the REST endpoint with a token solved seconds ago, with
      // none of this file's machinery in the way. If this is refused too then
      // the fault is in the project and no amount of client work will move it;
      // if it succeeds, the fault is mine and it is in what the SDK sends.
      const key = (auth.app.options as { apiKey?: string }).apiKey
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber: toE164(tenDigits), recaptchaToken: token }),
        },
      )
      console.log('[phoneDebug] raw send status:', res.status)
      console.log('[phoneDebug] raw send body  :', await res.text())
    } catch (e) {
      console.error('[phoneDebug] failed before producing a token:', e)
    } finally {
      host.remove()
    }
  }
}

async function withVerifier<T>(run: (v: RecaptchaVerifier) => Promise<T>): Promise<T> {
  const { verifier, widgetId } = await ensureVerifier()
  try {
    return await run(verifier)
  } finally {
    // The token is single-use whether or not the send worked. Left unreset,
    // the next attempt presents a spent challenge and is refused for reasons
    // that have nothing to do with the number being typed.
    try { window.grecaptcha?.reset(widgetId) } catch { /* nothing to reset */ }
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
  // Always leave the raw code somewhere findable. The friendly strings below
  // are for the rep holding the phone; this line is for whoever they ring.
  // eslint-disable-next-line no-console
  console.error('[phoneAuth]', e?.code ?? 'no-code', e)

  switch (e?.code) {
    // ── Project not set up yet ──────────────────────────────────────────────
    // These are not the user's fault and cannot be retried into working, so
    // they say what is actually wrong instead of "try again".
    case 'auth/operation-not-allowed':
      return 'Text messages are not switched on for this app yet. An admin needs to enable Phone sign-in in Firebase.'
    case 'auth/billing-not-enabled':
      return 'Text messages need billing enabled on the Firebase project. Ask an admin.'
    case 'auth/unauthorized-domain':
      return 'This address is not on the app\'s allowed list in Firebase. Ask an admin.'
    // These two look alike and are not. Splitting them is the difference
    // between checking one setting and checking four.
    case 'auth/captcha-check-failed':
      return 'Firebase rejected this page as an unrecognised address. The domain you are on needs adding to the authorised list. Ask an admin.'
    case 'auth/invalid-app-credential':
      return 'Firebase would not accept this app\'s credentials. Usually the API key is restricted to other addresses, or App Check is enforced without this app registered. Ask an admin.'
    case 'auth/app-not-authorized':
      return 'This build is not authorised for Firebase sign-in. Ask an admin.'

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
      // The code goes in the message on purpose. An unrecognised failure that
      // says only "something went wrong" cannot be diagnosed by the person who
      // hit it or by the person they report it to, and this is exactly the
      // path where nobody yet knows what is wrong.
      return e?.code
        ? `Could not send the code (${e.code}). Try again, or tell an admin that code.`
        : 'Could not send the code. Try again.'
  }
}
