import { injectable, inject } from 'tsyringe'
import { ContactListRepository, type VenueSource } from '../repositories/ContactListRepository'
import { splitGenres } from '../api/schemas/venue.schema'
import {
  ContactListFilters,
  RECIPIENT_TYPE_LABELS,
  type ContactListFilterOptionsDto,
  type ContactListRecipientDto,
  type ContactListResultDto,
  type RecipientType,
  type SaveContactListInput,
  type SavedContactListDto
} from '../api/schemas/contactList.schema'
import { toCsv } from '../csv/csv'

// Mailing lists (Verteiler). Recipients come from venues and festivals: the
// venue's own address, its Ansprechpartner and its Veranstalter (owning
// company). The filters apply to the venue; an address is on the list when
// at least one of its venues matches. Addresses marked "Keine Werbung" (on
// any contact with that address) are listed separately and never mailed.

const lower = (value: string): string => value.trim().toLowerCase()

/** "7, 80 ; 1" -> ['7', '80', '1'] */
function zipPrefixes(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((prefix) => prefix.trim())
    .filter(Boolean)
}

/** Venue tags plus the genres of the bands that played there, lower-case */
function genreTags(venue: VenueSource): Set<string> {
  const tags = splitGenres(venue.genres)
  for (const booking of venue.bookings) tags.push(...splitGenres(booking.bandGenre))
  return new Set(tags.map(lower))
}

export function venueMatches(venue: VenueSource, filters: ContactListFilters): boolean {
  if (filters.kinds.length > 0 && !filters.kinds.some((kind) => kind === venue.kind)) return false
  if (
    filters.countryCodes.length > 0 &&
    !filters.countryCodes.some((code) => lower(code) === lower(venue.countryCode))
  ) {
    return false
  }
  if (
    filters.states.length > 0 &&
    !filters.states.some((state) => lower(state) === lower(venue.state))
  ) {
    return false
  }
  const prefixes = zipPrefixes(filters.zipPrefixes)
  if (prefixes.length > 0 && !prefixes.some((prefix) => venue.zipCode.trim().startsWith(prefix))) {
    return false
  }
  // A bound excludes venues without a known capacity
  if (
    filters.capacityMin !== null &&
    (venue.capacity === null || venue.capacity < filters.capacityMin)
  ) {
    return false
  }
  if (
    filters.capacityMax !== null &&
    (venue.capacity === null || venue.capacity > filters.capacityMax)
  ) {
    return false
  }
  if (filters.genres.length > 0) {
    const tags = genreTags(venue)
    if (!filters.genres.some((genre) => tags.has(lower(genre)))) return false
  }
  if (filters.booked !== 'all') {
    const booked = venue.bookings.some(
      (booking) => filters.bandId === null || booking.bandId === filters.bandId
    )
    if (booked !== (filters.booked === 'booked')) return false
  }
  return true
}

interface Candidate {
  type: RecipientType
  email: string
  name: string
  firstName: string
  lastName: string
  company: string
  role: string
}

function candidates(venue: VenueSource, types: RecipientType[]): Candidate[] {
  const wanted = (type: RecipientType) => types.length === 0 || types.includes(type)
  const list: Candidate[] = []
  if (wanted('venue')) {
    list.push({
      type: 'venue',
      email: venue.email,
      name: venue.name,
      firstName: '',
      lastName: '',
      company: '',
      role: ''
    })
  }
  if (wanted('member')) {
    for (const member of venue.members) {
      list.push({
        type: 'member',
        email: member.email,
        name: `${member.firstName} ${member.lastName}`.trim(),
        firstName: member.firstName,
        lastName: member.lastName,
        company: '',
        role: member.role
      })
    }
  }
  if (wanted('promoter') && venue.promoter) {
    list.push({
      type: 'promoter',
      email: venue.promoter.email,
      name: venue.promoter.name,
      firstName: '',
      lastName: '',
      company: venue.promoter.name,
      role: ''
    })
  }
  // Something that looks like an address; the rest can't be mailed anyway
  return list.filter((candidate) => /^[^\s@]+@[^\s@]+$/.test(candidate.email.trim()))
}

/** Recipients of the matching venues, one per address, sorted by name */
export function buildContactList(
  venues: VenueSource[],
  filters: ContactListFilters,
  noAdvertising: Set<string>
): ContactListResultDto {
  const byEmail = new Map<string, ContactListRecipientDto>()
  for (const venue of venues) {
    if (!venueMatches(venue, filters)) continue
    for (const candidate of candidates(venue, filters.recipientTypes)) {
      const key = lower(candidate.email)
      let row = byEmail.get(key)
      if (!row) {
        row = {
          email: candidate.email.trim(),
          name: candidate.name,
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          company: candidate.company,
          types: [],
          venues: [],
          city: venue.city,
          country: venue.country || venue.countryCode,
          capacity: venue.capacity
        }
        byEmail.set(key, row)
      } else if (!row.firstName && candidate.firstName) {
        // A person's name says more than the venue's
        row.name = candidate.name
        row.firstName = candidate.firstName
        row.lastName = candidate.lastName
      }
      if (!row.company) row.company = candidate.company
      if (!row.types.includes(candidate.type)) row.types.push(candidate.type)
      const known = row.venues.find((entry) => entry.id === venue.id)
      if (!known) row.venues.push({ id: venue.id, name: venue.name, role: candidate.role })
      else if (!known.role) known.role = candidate.role
      if (venue.capacity !== null && (row.capacity === null || venue.capacity > row.capacity)) {
        row.capacity = venue.capacity
      }
    }
  }

  const rows = [...byEmail.values()].sort(
    (a, b) => a.name.localeCompare(b.name, 'de') || a.email.localeCompare(b.email, 'de')
  )
  return {
    recipients: rows.filter((row) => !noAdvertising.has(lower(row.email))),
    excluded: rows.filter((row) => noAdvertising.has(lower(row.email)))
  }
}

const CSV_HEADERS = ['E-Mail', 'Vorname', 'Nachname', 'Firma', 'Spielstätte', 'Ort', 'Land', 'Art']

/**
 * Comma-separated whatever the regional format, UTF-8 without BOM, one
 * header row: imports into Brevo, CleverReach, Mailchimp and the like (map
 * the columns there)
 */
export function contactListCsv(recipients: ContactListRecipientDto[]): string {
  const lines = [
    CSV_HEADERS,
    ...recipients.map((row) => [
      row.email,
      row.firstName,
      row.lastName,
      row.company,
      row.venues.map((venue) => venue.name).join('; '),
      row.city,
      row.country,
      row.types.map((type) => RECIPIENT_TYPE_LABELS[type]).join('; ')
    ])
  ]
  return toCsv(lines, ',')
}

function parseFilters(raw: string): ContactListFilters {
  try {
    const parsed = ContactListFilters.safeParse(JSON.parse(raw))
    if (parsed.success) return parsed.data
  } catch {
    // Unreadable: the list shows everything instead of failing
  }
  return ContactListFilters.parse({})
}

@injectable()
export class ContactListService {
  constructor(@inject(ContactListRepository) private repository: ContactListRepository) {}

  build(filters: ContactListFilters): ContactListResultDto {
    return buildContactList(
      this.repository.loadVenueSources(),
      filters,
      this.repository.noAdvertisingEmails()
    )
  }

  filterOptions(): ContactListFilterOptionsDto {
    const venues = this.repository.loadVenueSources()
    const bands = this.repository.listBands()
    const distinct = (values: string[]) => {
      const seen = new Map<string, string>()
      for (const value of values.map((entry) => entry.trim()).filter(Boolean)) {
        if (!seen.has(lower(value))) seen.set(lower(value), value)
      }
      return [...seen.values()].sort((a, b) => a.localeCompare(b, 'de'))
    }
    return {
      countryCodes: distinct(venues.map((venue) => venue.countryCode.toUpperCase())),
      states: distinct(venues.map((venue) => venue.state)),
      genres: distinct([
        ...venues.flatMap((venue) => splitGenres(venue.genres)),
        ...bands.flatMap((band) => splitGenres(band.genre))
      ]),
      bands: bands.map(({ id, name }) => ({ id, name }))
    }
  }

  setNoAdvertising(email: string, noAdvertising: boolean): number {
    return this.repository.setNoAdvertising(email, noAdvertising)
  }

  listSaved(): SavedContactListDto[] {
    return this.repository.listSaved().map((row) => ({
      id: row.id,
      name: row.name,
      filters: parseFilters(row.filters)
    }))
  }

  save(input: SaveContactListInput): SavedContactListDto {
    const filters = JSON.stringify(input.filters)
    const row =
      input.id !== undefined
        ? this.repository.updateSaved(input.id, input.name, filters)
        : this.repository.insertSaved(input.name, filters)
    if (!row) throw new Error('Verteiler nicht gefunden')
    return { id: row.id, name: row.name, filters: parseFilters(row.filters) }
  }

  deleteSaved(id: number): void {
    this.repository.deleteSaved(id)
  }
}
