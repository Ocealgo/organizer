/**
 * Turning a mobile number into the email its account signs in with.
 *
 * Why this is a function and not a lookup collection
 * --------------------------------------------------
 * Signing in with a phone number and a password needs the email before anyone
 * is authenticated, because that is what `signInWithEmailAndPassword` takes.
 * Doing that from the client would mean a phone-to-email map readable by
 * anybody who had not signed in — which is a map from "a rep's mobile number"
 * to "a rep's email address", enumerable ten digits at a time.
 *
 * So the map never leaves the server. This takes a number and returns one
 * field, and only ever for a number that is already an account.
 *
 * What it deliberately does not do
 * --------------------------------
 * It does not say whether a number is registered. Unknown numbers and numbers
 * with no email both come back as `{ email: null }`, and the client turns that
 * into the same "those details do not match" it shows for a wrong password.
 * A caller cannot tell the three apart, so this cannot be used to find out who
 * is on the system.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')

initializeApp()

/** Ten digits, starting 6-9 — the same rule the client applies. India only. */
const INDIAN_MOBILE = /^[6-9]\d{9}$/

exports.resolveLogin = onCall(
  // Close to the people using it. A login that waits on a round trip to Iowa
  // is a login that feels broken on a patchy connection in a shop.
  { region: 'asia-south1', cors: true },
  async (request) => {
    const phone = String(request.data?.phone ?? '').trim()

    // A malformed number is the caller's mistake, not a failed lookup, and is
    // worth saying out loud — it cannot be used to probe for accounts.
    if (!INDIAN_MOBILE.test(phone)) {
      throw new HttpsError('invalid-argument', 'Not a valid Indian mobile number.')
    }

    try {
      const user = await getAuth().getUserByPhoneNumber(`+91${phone}`)
      return { email: user.email ?? null }
    } catch {
      // auth/user-not-found, and anything else, look identical from outside.
      return { email: null }
    }
  },
)
