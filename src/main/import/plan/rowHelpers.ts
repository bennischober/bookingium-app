import type { ImportEntityRef, ImportPreviewRow } from '../../api/schemas/import.schema'
import { cleanText, emailDomain, isFreemailDomain, type ParsedPerson } from '../normalize'

/** Preview labels and texts the row loops of every list kind share */

export const personLabel = (person: { firstName: string; lastName: string }): string =>
  cleanText(`${person.firstName} ${person.lastName}`)

/** Preview row of a row that is not imported (names as written) */
export function notImported(
  rowNumber: number,
  status: 'excluded' | 'skipped',
  names: { primary?: string; company?: string; persons?: string[] },
  warnings: string[] = []
): ImportPreviewRow {
  const ref = (label: string): ImportEntityRef => ({ label, action: 'new' })
  return {
    rowNumber,
    status,
    primary: names.primary ? ref(names.primary) : null,
    company: names.company ? ref(names.company) : null,
    persons: (names.persons ?? []).filter(Boolean).map(ref),
    warnings
  }
}

/**
 * Name of a media outlet a row only gives an address for: the address's
 * domain ("redaktion@example.test" → "example.test"); at a freemail
 * provider the person's name, else the address itself
 */
export function outletName(email: string, person: ParsedPerson | undefined): string {
  const domain = emailDomain(email)
  if (!isFreemailDomain(domain)) return domain
  return person ? personLabel(person) : email.trim().toLowerCase()
}

export const nameFromEmailWarning = (name: string): string =>
  `Kein Name angegeben – nach der E-Mail-Adresse „${name}“ benannt`
