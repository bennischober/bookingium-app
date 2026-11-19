import type { CompanyKind } from '../../api/schemas/company.schema'
import { normalizeGenres } from '../../api/schemas/genres'
import type { ImportPreview } from '../../api/schemas/import.schema'
import type { VenueKind } from '../../api/schemas/venue.schema'

/**
 * What an import plan holds: the records to create or complete (drafts), and the helpers
 * that merge a row's values into a draft without overwriting what an earlier row set
 */

export interface AddressDraft {
  street: string
  streetNumber: string
  zipCode: string
  city: string
  state: string
  country: string
  countryCode: string
}

export interface ContactDraft {
  // Primary address
  email: string
  // Further addresses (contact_email), never the primary one
  emails: string[]
  phone: string
  mobilePhone: string
  homepage: string
}

export interface DraftBase {
  key: string
  // Record already in the app: only its empty fields get filled
  existingId: number | null
  firstRow: number
  notes: string[]
  contact: ContactDraft
}

export interface VenueDraft extends DraftBase {
  name: string
  normName: string
  kind: VenueKind
  capacity: number | null
  /** #245: lower end of a range ("500-1000"), null for one number */
  capacityMin: number | null
  // "Rock, Metal" (normalizeGenres)
  genres: string
  address: AddressDraft
  companyKey: string | null
  // person key → role
  members: Map<string, string>
}

export interface CompanyDraft extends DraftBase {
  name: string
  // Only for companies the import creates
  kind: CompanyKind
  genres: string
  vatId: string
  taxNumber: string
  address: AddressDraft
  members: Map<string, string>
}

export interface PersonDraft extends DraftBase {
  firstName: string
  lastName: string
  // ISO date or ''
  birthday: string
  address: AddressDraft
}

export interface BandDraft extends DraftBase {
  name: string
  genre: string
  founded: string
  // Bands always belong to an existing company (business rule)
  companyId: number
  managementCompanyId: number | null
  responsiblePersonKey: string | null
  members: Map<string, string>
}

// A record that takes an address of the file: what "Als Verteiler speichern"
// puts into the list (#154)
export interface ListMemberDraft {
  type: 'person' | 'company' | 'venue'
  // Draft key within its type
  key: string
}

export interface ImportPlan {
  preview: ImportPreview
  venues: VenueDraft[]
  bands: BandDraft[]
  companies: CompanyDraft[]
  persons: PersonDraft[]
  // In row order, each record once
  listMembers: ListMemberDraft[]
}

export interface ExistingRecords {
  venues: Array<{ id: number; name: string; city: string }>
  bands: Array<{ id: number; name: string }>
  companies: Array<{ id: number; name: string }>
  /** #248: a person is also found by an email address, not only by the full name */
  persons: Array<{ id: number; firstName: string; lastName: string; emails?: string[] }>
}

export const emptyAddress = (): AddressDraft => ({
  street: '',
  streetNumber: '',
  zipCode: '',
  city: '',
  state: '',
  country: '',
  countryCode: ''
})

export const emptyContact = (): ContactDraft => ({
  email: '',
  emails: [],
  phone: '',
  mobilePhone: '',
  homepage: ''
})

/** Adds addresses to a contact: the first becomes its primary one, the rest further ones */
export function addEmails(contact: ContactDraft, emails: string[]): void {
  for (const email of emails) {
    const key = email.trim().toLowerCase()
    if (!key) continue
    if (!contact.email) contact.email = email
    else if (
      contact.email.toLowerCase() !== key &&
      !contact.emails.some((other) => other.toLowerCase() === key)
    ) {
      contact.emails.push(email)
    }
  }
}

/** Merges genre tags into a draft ("Rock" + "Metal, rock" → "Rock, Metal") */
export function addGenres(target: { genres: string }, ...values: string[]): void {
  target.genres = normalizeGenres([target.genres, ...values].join(','))
}

/** Sets each empty field of `target` from `values` (first value wins) */
export function fill<T extends object>(target: T, values: Partial<T>): void {
  for (const [field, value] of Object.entries(values) as Array<[keyof T, T[keyof T]]>) {
    if (value !== '' && value !== null && value !== undefined && !target[field]) {
      target[field] = value
    }
  }
}

export function addNotes(target: DraftBase, notes: string[]): void {
  for (const note of notes) {
    if (note && !target.notes.includes(note)) target.notes.push(note)
  }
}
