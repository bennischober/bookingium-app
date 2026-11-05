import { injectable, inject } from 'tsyringe'
import { ContactListRepository, type ListSource } from '../repositories/ContactListRepository'
import { splitGenres } from '../api/schemas/genres'
import {
  ContactListFilters,
  ListKind,
  RECIPIENT_TYPE_LABELS,
  type ContactListFilterOptionsDto,
  type ContactListRecipientDto,
  type ContactListResultDto,
  type RecipientType,
  type SaveContactListInput,
  type SavedContactListDto
} from '../api/schemas/contactList.schema'
import { toCsv } from '../csv/csv'

// Mailing lists (Verteiler). Recipients come from venues, festivals and media
// companies (radio stations, #80): the source's own address, its
// Ansprechpartner, a venue's Veranstalter (owning company) and the LoPros of
// events at a venue (#51). The filters apply to the source; an address is on
// the list when at least one of its sources matches. Addresses marked "Keine
// Werbung" (on any contact with that address) are listed separately and
// never mailed.

const lower = (value: string): string => value.trim().toLowerCase()

/** "7, 80 ; 1" -> ['7', '80', '1'] */
function zipPrefixes(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((prefix) => prefix.trim())
    .filter(Boolean)
}

/** Source tags plus the genres of the bands that played there, lower-case */
function genreTags(source: ListSource): Set<string> {
  const tags = splitGenres(source.genres)
  for (const booking of source.bookings) tags.push(...splitGenres(booking.bandGenre))
  return new Set(tags.map(lower))
}

const sourceKind = (source: ListSource): ListKind => ListKind.catch('venue').parse(source.kind)

export function sourceMatches(source: ListSource, filters: ContactListFilters): boolean {
  const kind = sourceKind(source)
  if (filters.kinds.length > 0 && !filters.kinds.includes(kind)) return false
  if (
    filters.countryCodes.length > 0 &&
    !filters.countryCodes.some((code) => lower(code) === lower(source.countryCode))
  ) {
    return false
  }
  if (
    filters.states.length > 0 &&
    !filters.states.some((state) => lower(state) === lower(source.state))
  ) {
    return false
  }
  const prefixes = zipPrefixes(filters.zipPrefixes)
  if (prefixes.length > 0 && !prefixes.some((prefix) => source.zipCode.trim().startsWith(prefix))) {
    return false
  }
  // A bound excludes sources without a known capacity, media among them
  if (
    filters.capacityMin !== null &&
    (source.capacity === null || source.capacity < filters.capacityMin)
  ) {
    return false
  }
  if (
    filters.capacityMax !== null &&
    (source.capacity === null || source.capacity > filters.capacityMax)
  ) {
    return false
  }
  if (filters.genres.length > 0) {
    const tags = genreTags(source)
    if (!filters.genres.some((genre) => tags.has(lower(genre)))) return false
  }
  if (filters.booked !== 'all') {
    // Media are never booked, so "nie gebucht" would list every station: the
    // filter is about venues
    if (kind === 'media') return false
    const booked = source.bookings.some(
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

function candidates(source: ListSource, types: RecipientType[]): Candidate[] {
  const wanted = (type: RecipientType) => types.length === 0 || types.includes(type)
  // A station is a company: its name goes into "Firma" for its people too
  const company = sourceKind(source) === 'media' ? source.name : ''
  const list: Candidate[] = []
  if (wanted('venue')) {
    list.push({
      type: 'venue',
      email: source.email,
      name: source.name,
      firstName: '',
      lastName: '',
      company,
      role: ''
    })
  }
  if (wanted('member')) {
    for (const member of source.members) {
      list.push({
        type: 'member',
        email: member.email,
        name: `${member.firstName} ${member.lastName}`.trim(),
        firstName: member.firstName,
        lastName: member.lastName,
        company,
        role: member.role
      })
    }
  }
  if (wanted('promoter') && source.promoter) {
    list.push({
      type: 'promoter',
      email: source.promoter.email,
      name: source.promoter.name,
      firstName: '',
      lastName: '',
      company: source.promoter.name,
      role: ''
    })
  }
  if (wanted('lopro')) {
    for (const loPro of source.lopros) {
      list.push({
        type: 'lopro',
        email: loPro.email,
        name: loPro.name,
        firstName: loPro.firstName,
        lastName: loPro.lastName,
        company: loPro.company,
        role: 'LoPro'
      })
    }
  }
  // Something that looks like an address; the rest can't be mailed anyway
  return list.filter((candidate) => /^[^\s@]+@[^\s@]+$/.test(candidate.email.trim()))
}

/** Recipients of the matching sources, one per address, sorted by name */
export function buildContactList(
  sources: ListSource[],
  filters: ContactListFilters,
  noAdvertising: Set<string>
): ContactListResultDto {
  const byEmail = new Map<string, ContactListRecipientDto>()
  for (const source of sources) {
    if (!sourceMatches(source, filters)) continue
    const kind = sourceKind(source)
    for (const candidate of candidates(source, filters.recipientTypes)) {
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
          sources: [],
          city: source.city,
          country: source.country || source.countryCode,
          capacity: source.capacity
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
      // Venue and company ids are separate sequences: the kind tells them apart
      const known = row.sources.find((entry) => entry.id === source.id && entry.kind === kind)
      if (!known) {
        row.sources.push({ id: source.id, kind, name: source.name, role: candidate.role })
      } else if (!known.role) known.role = candidate.role
      if (source.capacity !== null && (row.capacity === null || source.capacity > row.capacity)) {
        row.capacity = source.capacity
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

const CSV_HEADERS = [
  'E-Mail',
  'Vorname',
  'Nachname',
  'Firma',
  'Club/Festival/Medium',
  'Ort',
  'Land',
  'Art'
]

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
      row.sources.map((source) => source.name).join('; '),
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
      this.repository.loadSources(),
      filters,
      this.repository.noAdvertisingEmails()
    )
  }

  filterOptions(): ContactListFilterOptionsDto {
    const sources = this.repository.loadSources()
    const bands = this.repository.listBands()
    const distinct = (values: string[]) => {
      const seen = new Map<string, string>()
      for (const value of values.map((entry) => entry.trim()).filter(Boolean)) {
        if (!seen.has(lower(value))) seen.set(lower(value), value)
      }
      return [...seen.values()].sort((a, b) => a.localeCompare(b, 'de'))
    }
    return {
      countryCodes: distinct(sources.map((source) => source.countryCode.toUpperCase())),
      states: distinct(sources.map((source) => source.state)),
      genres: distinct([
        ...sources.flatMap((source) => splitGenres(source.genres)),
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
