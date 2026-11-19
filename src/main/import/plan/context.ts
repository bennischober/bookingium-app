import type {
  ImportCount,
  ImportEntityRef,
  ImportField,
  ImportPreviewRow,
  ImportRequest,
  ImportRow
} from '../../api/schemas/import.schema'
import type { CompanyKind } from '../../api/schemas/company.schema'
import { isStateColumn } from '../detectMapping'
import {
  cleanText,
  countryByCode,
  companyKey,
  normalizeKey,
  normalizeZip,
  parseRegion,
  type ParsedPerson
} from '../normalize'
import {
  addEmails,
  addGenres,
  addNotes,
  emptyAddress,
  emptyContact,
  type AddressDraft,
  type BandDraft,
  type CompanyDraft,
  type DraftBase,
  type ExistingRecords,
  type ImportPlan,
  type ListMemberDraft,
  type PersonDraft,
  type VenueDraft
} from './drafts'

/** "DEAL" → "Deal"; mixed-case headers stay as written */
function noteLabel(header: string): string {
  const text = cleanText(header)
  return text === text.toUpperCase() ? text.charAt(0) + text.slice(1).toLowerCase() : text
}

// ----------------------------------------
// Shared context
// ----------------------------------------

export function createContext(request: ImportRequest, existing: ExistingRecords) {
  const { headers, rows, mapping, options } = request

  const columnsOf = (field: ImportField): number[] =>
    mapping.flatMap((mapped, column) => (mapped === field ? [column] : []))
  const columnOf = (field: ImportField): number => mapping.indexOf(field)

  const regionColumn = columnOf('region')
  const stateColumn = regionColumn >= 0 && isStateColumn(rows, regionColumn)
  const defaultCountry = countryByCode(options.defaultCountry)

  // Existing records by comparison key
  const firstById = <T extends { id: number }>(items: T[], keyOf: (item: T) => string) => {
    const map = new Map<string, number>()
    for (const item of items) {
      const key = keyOf(item)
      if (key && !map.has(key)) map.set(key, item.id)
    }
    return map
  }
  const companiesByName = firstById(existing.companies, (company) => normalizeKey(company.name))
  // #248: a match only when exactly one existing record has the key, else it stays new
  const uniqueBy = <T extends { id: number }>(items: T[], keysOf: (item: T) => string[]) => {
    const found = new Map<string, number | null>()
    for (const item of items) {
      for (const key of new Set(keysOf(item))) {
        if (!key) continue
        const seen = found.get(key)
        found.set(key, seen === undefined || seen === item.id ? item.id : null)
      }
    }
    return (key: string): number | null => (key ? (found.get(key) ?? null) : null)
  }
  const lowerEmails = (emails: string[] | undefined) =>
    (emails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean)
  const companyByLooseName = uniqueBy(existing.companies, (company) => [companyKey(company.name)])
  const personByEmail = uniqueBy(existing.persons, (person) => lowerEmails(person.emails))
  const bandsByName = firstById(existing.bands, (band) => normalizeKey(band.name))
  const personsByName = firstById(existing.persons, (person) =>
    person.lastName.trim() ? normalizeKey(`${person.firstName} ${person.lastName}`) : ''
  )
  const venuesByName = new Map<string, Array<{ id: number; city: string }>>()
  for (const venue of existing.venues) {
    const key = normalizeKey(venue.name)
    venuesByName.set(key, [
      ...(venuesByName.get(key) ?? []),
      { id: venue.id, city: normalizeKey(venue.city) }
    ])
  }

  const venues = new Map<string, VenueDraft>()
  const bands = new Map<string, BandDraft>()
  const companies = new Map<string, CompanyDraft>()
  const persons = new Map<string, PersonDraft>()
  const listMembers = new Map<string, ListMemberDraft>()

  /** Adds addresses of the file to a record, which makes it a Verteiler member */
  const takeEmails = (type: ListMemberDraft['type'], draft: DraftBase, emails: string[]): void => {
    if (!emails.some((email) => email.trim())) return
    addEmails(draft.contact, emails)
    const id = `${type}:${draft.key}`
    if (!listMembers.has(id)) listMembers.set(id, { type, key: draft.key })
  }

  const refOf = (draft: DraftBase, label: string, rowNumber: number): ImportEntityRef => ({
    label,
    action: draft.existingId !== null ? 'existing' : draft.firstRow < rowNumber ? 'repeat' : 'new'
  })

  const companyFor = (
    name: string,
    rowNumber: number,
    kind: CompanyKind = 'company'
  ): CompanyDraft => {
    const normName = normalizeKey(name)
    // exact name first, then the name without its legal form ("Beispiel" = "Beispiel GmbH")
    const existingId = companiesByName.get(normName) ?? companyByLooseName(companyKey(name))
    const key = existingId !== null ? `id:${existingId}` : `new:${normName}`
    let draft = companies.get(key)
    if (!draft) {
      draft = {
        key,
        existingId,
        firstRow: rowNumber,
        name,
        kind,
        genres: '',
        vatId: '',
        taxNumber: '',
        notes: [],
        address: emptyAddress(),
        contact: emptyContact(),
        members: new Map()
      }
      companies.set(key, draft)
    }
    return draft
  }

  const venueFor = (name: string, city: string, rowNumber: number): VenueDraft => {
    const normName = normalizeKey(name)
    const normCity = normalizeKey(city)
    // Same name in another city is another venue ("Alter Schlachthof")
    const candidates = venuesByName.get(normName) ?? []
    const match = normCity
      ? (candidates.find((candidate) => candidate.city === normCity) ??
        (candidates.length === 1 && !candidates[0].city ? candidates[0] : undefined))
      : candidates.length === 1
        ? candidates[0]
        : undefined

    let key: string
    if (match) {
      key = `id:${match.id}`
    } else if (normCity) {
      key = `new:${normName}|${normCity}`
    } else {
      // No city: the one venue of that name from an earlier row, if unique
      const sameName = [...venues.values()].filter(
        (draft) => draft.existingId === null && draft.normName === normName
      )
      key = sameName.length === 1 ? sameName[0].key : `new:${normName}|`
    }

    let draft = venues.get(key)
    if (!draft) {
      draft = {
        key,
        existingId: match?.id ?? null,
        firstRow: rowNumber,
        name,
        normName,
        kind: options.kind,
        capacity: null,
        capacityMin: null,
        genres: '',
        notes: [],
        address: emptyAddress(),
        contact: emptyContact(),
        companyKey: null,
        members: new Map()
      }
      venues.set(key, draft)
    }
    return draft
  }

  const bandFor = (name: string, companyId: number, rowNumber: number): BandDraft => {
    const normName = normalizeKey(name)
    const existingId = bandsByName.get(normName) ?? null
    const key = existingId !== null ? `id:${existingId}` : `new:${normName}`
    let draft = bands.get(key)
    if (!draft) {
      draft = {
        key,
        existingId,
        firstRow: rowNumber,
        name,
        genre: '',
        founded: '',
        companyId,
        managementCompanyId: null,
        responsiblePersonKey: null,
        notes: [],
        contact: emptyContact(),
        members: new Map()
      }
      bands.set(key, draft)
    }
    return draft
  }

  const personFor = (
    parsed: ParsedPerson,
    scopeKey: string,
    rowNumber: number,
    emails: string[] = []
  ): PersonDraft => {
    const fullName = normalizeKey(`${parsed.firstName} ${parsed.lastName}`)
    // A first name alone is only the same person within the same scope. #248: the same email
    // address is the same person too, however the name is written ("Jo" for "Johanna").
    const byEmail =
      lowerEmails(emails)
        .map((email) => personByEmail(email))
        .find((id) => id !== null) ?? null
    const existingId = (parsed.lastName ? (personsByName.get(fullName) ?? null) : null) ?? byEmail
    const key =
      existingId !== null
        ? `id:${existingId}`
        : parsed.lastName
          ? `new:${fullName}`
          : `new:${fullName}@${scopeKey}`
    let draft = persons.get(key)
    if (!draft) {
      draft = {
        key,
        existingId,
        firstRow: rowNumber,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        birthday: '',
        notes: [],
        address: emptyAddress(),
        contact: emptyContact()
      }
      persons.set(key, draft)
    }
    addNotes(draft, [parsed.notes])
    return draft
  }

  /** Cell accessors for one row */
  const reader = (row: ImportRow) => {
    const cell = (column: number): string => (column >= 0 ? (row.cells[column] ?? '').trim() : '')
    return {
      cell,
      value: (field: ImportField): string => cell(columnOf(field)),
      values: (field: ImportField): string[] =>
        columnsOf(field)
          .map((column) => cell(column))
          .filter(Boolean),
      // Anything besides ignored and month columns
      hasData: mapping.some(
        (field, column) => field !== 'ignore' && field !== 'month' && cell(column) !== ''
      ),
      // "Header: value" lines of the note columns
      notes: (): string[] =>
        columnsOf('notes').flatMap((column) => {
          const note = cleanText(cell(column))
          if (!note) return []
          return [headers[column]?.trim() ? `${noteLabel(headers[column])}: ${note}` : note]
        })
    }
  }

  /** Region and postal address of a row */
  const addressOf = (read: ReturnType<typeof reader>) => {
    const region = parseRegion(read.value('region'), stateColumn)
    const country = region.country ?? defaultCountry
    const address: AddressDraft = {
      street: cleanText(read.value('street')),
      streetNumber: cleanText(read.value('streetNumber')),
      zipCode: normalizeZip(read.value('zipCode'), country?.code ?? ''),
      city: cleanText(read.value('city')),
      state: region.state,
      country: country?.name ?? '',
      countryCode: country?.code ?? ''
    }
    const hasStreetAddress = Boolean(
      address.street || address.streetNumber || address.zipCode || address.city
    )
    return { address, hasStreetAddress }
  }

  const count = (drafts: DraftBase[]): ImportCount => ({
    new: drafts.filter((draft) => draft.existingId === null).length,
    existing: drafts.filter((draft) => draft.existingId !== null).length
  })

  const finish = (rowsOut: ImportPreviewRow[], errors: string[]): ImportPlan => ({
    preview: {
      rows: rowsOut,
      summary: {
        venues: count([...venues.values()]),
        bands: count([...bands.values()]),
        companies: count([...companies.values()]),
        persons: count([...persons.values()])
      },
      listMembers: listMembers.size,
      errors
    },
    venues: [...venues.values()],
    bands: [...bands.values()],
    companies: [...companies.values()],
    persons: [...persons.values()],
    listMembers: [...listMembers.values()]
  })

  // Companies of company and person lists are of the chosen kind; a venue
  // list's promoters are plain companies
  const companyKind: CompanyKind =
    request.target === 'companies' || request.target === 'persons' ? options.companyKind : 'company'
  const mediaList = companyKind === 'media'

  /** Genre tags of the dialog for the list's clubs/festivals and media */
  const listGenres = (draft: { genres: string }): void => {
    if (options.genres) addGenres(draft, options.genres)
  }

  return {
    request,
    companyKind,
    mediaList,
    listGenres,
    excluded: new Set(request.excludedRows),
    columnOf,
    companiesByName,
    reader,
    addressOf,
    refOf,
    companyFor,
    venueFor,
    bandFor,
    personFor,
    takeEmails,
    finish
  }
}

export type PlanContext = ReturnType<typeof createContext>
