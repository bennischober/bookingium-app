/** The form side of a contact's further addresses (pure, unit-tested) */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Why one further address cannot be saved, or undefined. Empty rows are fine:
 * the main process drops them.
 */
export function otherEmailProblem(
  value: string,
  index: number,
  primary: string,
  others: readonly string[]
): string | undefined {
  const email = value.trim().toLowerCase()
  if (!email) return undefined
  if (!EMAIL.test(email)) return 'Ungültige E-Mail-Adresse'
  if (email === primary.trim().toLowerCase()) return 'Das ist schon die Haupt-Adresse'
  const first = others.findIndex((other) => other.trim().toLowerCase() === email)
  if (first !== -1 && first < index) return 'Diese Adresse steht schon in der Liste'
  return undefined
}

/**
 * "Als Haupt-Adresse": the further address at `index` becomes the primary one and
 * the old primary takes its place (or the row goes, when there was none).
 */
export function promoteOtherEmail(
  primary: string,
  others: readonly string[],
  index: number
): { email: string; otherEmails: string[] } {
  const promoted = others[index] ?? ''
  const rest = [...others]
  if (primary.trim()) rest[index] = primary
  else rest.splice(index, 1)
  return { email: promoted, otherEmails: rest }
}

/** Whether the contact part of a form holds anything worth saving */
export function contactHasValues(contact: Record<string, unknown>): boolean {
  return Object.values(contact).some((value) => {
    if (typeof value === 'string') return value.trim().length > 0
    if (Array.isArray(value)) return value.some((v) => typeof v === 'string' && v.trim())
    return value === true
  })
}
