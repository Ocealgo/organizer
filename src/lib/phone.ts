/**
 * Indian mobile numbers, in the two shapes this app needs them.
 *
 * Reps type ten digits. Firebase Auth wants E.164. Keeping the conversion in
 * one place means the number a rep registers is byte-identical to the number
 * that later receives an OTP — and a mismatch there is invisible until someone
 * is locked out of their account at the worst moment.
 */

/** Ten digits, starting 6-9. The same rule the outlet forms already apply. */
export const isIndianMobile = (p: string) => /^[6-9]\d{9}$/.test(p.trim())

/** `9876543210` → `+919876543210`. Assumes the input already passed validation. */
export const toE164 = (p: string) => `+91${p.trim()}`

/** `+919876543210` → `9876543210`, for showing a number back to the person. */
export const fromE164 = (p: string) => p.replace(/^\+91/, '')

/** Strip anything that is not a digit and cap at ten, for onChange handlers. */
export const asTyped = (v: string) => v.replace(/\D/g, '').slice(0, 10)

/** `9876543210` → `98765 43210`. Easier to check at a glance before sending. */
export const pretty = (p: string) =>
  isIndianMobile(p) ? `${p.slice(0, 5)} ${p.slice(5)}` : p
