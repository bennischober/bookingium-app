/**
 * Address validation for composing mail - the ONE guard the core and the UI share.
 *
 * This is not an RFC-5322 address parser. It is a HEADER-INJECTION guard with a practical
 * shape check, and the two jobs must not be separated:
 *
 *   - shape: an address needs exactly one `@` with text on both sides, and a domain with at
 *     least one dot and no empty label. Without that, `a@b` and `a@.b.test` were accepted
 *     and the server rejected them at send time.
 *   - safety: none of the characters that can END a header or START another one may appear
 *     (`< > ( ) " , ; : @ \\` and whitespace). A newline in an address is a header
 *     injection: `a@b.test\r\nBcc: victim@example.test` would add a recipient.
 *
 * Deliberately permissive where it can be: non-ASCII (IDN) addresses are VALID and must stay
 * valid. Zod's `z.string().email()` rejects `user@exämple.test`, so it is the wrong tool here -
 * a user with an umlaut domain could not send mail at all.
 *
 * Dependency-free on purpose: the mail core imports nothing outside itself, so this lives here and
 * the renderer imports it by relative path. One implementation, no drift between the two.
 */

/**
 * Characters that can terminate a header value or begin a new header field.
 * NOTE: `@` is NOT here - every address needs one. It is refused separately, in the
 * local part and the domain, where it must not appear.
 */
// the C0 controls and DEL are the point: a newline in an address is header injection
/* eslint-disable no-control-regex */
const FORBIDDEN = /[\s<>()",;\\\u0000-\u001f\u007f]/

/** Non-ASCII is allowed (IDN), so the local part is anything but the forbidden set. */
const LOCAL = /^[^\s<>()",;:@\\\u0000-\u001f\u007f]+$/

/**
 * A domain label: letters, digits and hyphens, not starting or ending with a hyphen.
 * Non-ASCII is allowed here too (IDN), which is why this is not [a-z0-9-].
 */
const LABEL = /^[^\s<>()",;:@\\\u0000-\u001f\u007f.-](?:[^\s<>()",;:@\\\u0000-\u001f\u007f.]*[^\s<>()",;:@\\\u0000-\u001f\u007f.-])?$/

/**
 * True when the address may be put into a header.
 *
 * Rejects, in this order: an empty value, a forbidden character anywhere (the injection guard),
 * more than one `@`, an empty local part, and a domain without a dot or with an empty label.
 */
export function isValidEmail(email: string): boolean {
  const value = email
  if (value.length === 0) return false
  // the injection guard runs FIRST: a newline must never reach the shape checks
  if (FORBIDDEN.test(value)) return false
  const at = value.indexOf('@')
  if (at <= 0 || at !== value.lastIndexOf('@')) return false
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  if (!LOCAL.test(local)) return false
  // a domain needs at least two labels, so "a@b" is not a mail address
  const labels = domain.split('.')
  if (labels.length < 2) return false
  return labels.every((label) => label.length > 0 && LABEL.test(label))
}

/**
 * Why an address is refused, for the UI to show - or null when it is fine.
 *
 * The core throws its own German message; this exists so the compose field can explain the same
 * reason while typing instead of only after a failed send.
 */
/* eslint-enable no-control-regex */

export function addressProblem(email: string): string | null {
  if (email.length === 0) return 'Keine Adresse angegeben'
  if (FORBIDDEN.test(email)) return 'Enthält ein unerlaubtes Zeichen'
  const at = email.indexOf('@')
  if (at <= 0) return 'Es fehlt das @ oder der Name davor'
  if (at !== email.lastIndexOf('@')) return 'Mehr als ein @'
  const domain = email.slice(at + 1)
  if (!domain.includes('.')) return 'Die Domain braucht einen Punkt'
  if (domain.split('.').some((label) => label.length === 0)) return 'Die Domain hat ein leeres Feld'
  if (!isValidEmail(email)) return 'Keine gültige Adresse'
  return null
}
