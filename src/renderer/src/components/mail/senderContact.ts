/** "Kontakt anlegen" from a mail's sender: what the new person starts with (pure, unit-tested) */

export type ContactPrefill = { firstName: string; lastName: string; email: string }

/**
 * Splits a sender's display name into first and last name. "Last, First" is read
 * the other way round; quotes around the name go. A name that is only the address
 * (or empty) gives no name: guessing one from the address would often be wrong.
 */
export function contactPrefillFromSender(sender: { name: string; email: string }): ContactPrefill {
  const email = sender.email.trim().toLowerCase()
  const name = sender.name
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!name || name.includes('@')) return { firstName: '', lastName: '', email }

  const parts = name.split(',')
  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
    return { firstName: parts[1].trim(), lastName: parts[0].trim(), email }
  }
  const words = name.split(' ')
  if (words.length === 1) return { firstName: name, lastName: '', email }
  return { firstName: words.slice(0, -1).join(' '), lastName: words[words.length - 1], email }
}
