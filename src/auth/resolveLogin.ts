/**
 * One box, two kinds of username.
 *
 * A rep types either their email or their mobile number, and either way the
 * password is what actually signs them in. Firebase only knows how to take an
 * email, so a number has to become one first — and because that map is not
 * something the client may hold, the swap happens in a Cloud Function.
 *
 * See functions/index.js for why it cannot live here.
 */
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { isIndianMobile, asTyped } from '../lib/phone'

/** What the user typed, as one of the two things it might be. */
export type Identifier =
  | { kind: 'email'; email: string }
  | { kind: 'phone'; phone: string }
  | { kind: 'unusable' }

/**
 * An '@' is the only reliable tell. Numbers cannot contain one and emails
 * cannot omit one, so there is no input that is ambiguously both.
 */
export function readIdentifier(raw: string): Identifier {
  const trimmed = raw.trim()
  if (!trimmed) return { kind: 'unusable' }
  if (trimmed.includes('@')) return { kind: 'email', email: trimmed }
  const digits = asTyped(trimmed)
  return isIndianMobile(digits) ? { kind: 'phone', phone: digits } : { kind: 'unusable' }
}

/**
 * The email to sign in with, or null if there is nothing to sign in as.
 *
 * Null covers "no account has that number", "the account has no email" and
 * "the lookup failed" on purpose. Every one of them ends in the same message
 * as a wrong password, so a stranger cannot use this screen to work out which
 * of your reps is on the system.
 */
export async function emailForLogin(id: Identifier): Promise<string | null> {
  if (id.kind === 'email') return id.email
  if (id.kind === 'unusable') return null
  try {
    const call = httpsCallable<{ phone: string }, { email: string | null }>(functions, 'resolveLogin')
    const { data } = await call({ phone: id.phone })
    return data.email ?? null
  } catch {
    return null
  }
}
