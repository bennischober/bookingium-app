import type {
  ImportEntityRef,
  ImportField,
  ImportPreview,
  ImportPreviewRow,
  ImportRequest
} from '../api/schemas/import.schema'
import type { VenueKind } from '../api/schemas/venue.schema'
import { isStateColumn } from './detectMapping'
import {
  cleanText,
  countryByCode,
  looksLikeDomain,
  normalizeKey,
  normalizeUrl,
  normalizeZip,
  parseCapacity,
  parseEmails,
  parsePersons,
  parseRegion,
  parseTaxId,
  type ParsedPerson
} from './normalize'

// ========================================
// Rows → records to create or complete
// ========================================

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
  email: string
  phone: string
  mobilePhone: string
  homepage: string
}

interface DraftBase {
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
  address: AddressDraft
  companyKey: string | null
  // person key → role
  members: Map<string, string>
}

export interface CompanyDraft extends DraftBase {
  name: string
  vatNumber: string
  taxNumber: string
  address: AddressDraft
  members: Map<string, string>
}

export interface PersonDraft extends DraftBase {
  firstName: string
  lastName: string
}

export interface ImportPlan {
  preview: ImportPreview
  venues: VenueDraft[]
  companies: CompanyDraft[]
  persons: PersonDraft[]
}

export interface ExistingRecords {
  venues: Array<{ id: number; name: string; city: string }>
  companies: Array<{ id: number; name: string }>
  persons: Array<{ id: number; firstName: string; lastName: string }>
}

const DEFAULT_ROLE = 'Ansprechpartner'

const emptyAddress = (): AddressDraft => ({
  street: '',
  streetNumber: '',
  zipCode: '',
  city: '',
  state: '',
  country: '',
  countryCode: ''
})

const emptyContact = (): ContactDraft => ({ email: '', phone: '', mobilePhone: '', homepage: '' })

/** Sets each empty field of `target` from `values` (first value wins) */
function fill<T extends object>(target: T, values: Partial<T>): void {
  for (const [field, value] of Object.entries(values) as Array<[keyof T, T[keyof T]]>) {
    if (value !== '' && value !== null && value !== undefined && !target[field]) {
      target[field] = value
    }
  }
}

function addNotes(target: DraftBase, notes: string[]): void {
  for (const note of notes) {
    if (note && !target.notes.includes(note)) target.notes.push(note)
  }
}

/** "DEAL" → "Deal"; mixed-case headers stay as written */
function noteLabel(header: string): string {
  const text = cleanText(header)
  return text === text.toUpperCase() ? text.charAt(0) + text.slice(1).toLowerCase() : text
}

/** Whether an email's local part mentions the person ("carlos@…", "j.smith@…") */
function emailMatchesPerson(email: string, person: ParsedPerson): boolean {
  const local = normalizeKey(email.split('@')[0])
  return [person.firstName, person.lastName]
    .map((name) => normalizeKey(name))
    .some((name) => name.length >= 3 && name.split(' ').some((part) => local.includes(part)))
}

export function buildImportPlan(request: ImportRequest, existing: ExistingRecords): ImportPlan {
  const { headers, rows, mapping, options } = request
  const excluded = new Set(request.excludedRows)
  const errors: string[] = []

  const columnsOf = (field: ImportField): number[] =>
    mapping.flatMap((mapped, column) => (mapped === field ? [column] : []))
  const columnOf = (field: ImportField): number => mapping.indexOf(field)

  if (columnOf('venueName') < 0 && columnOf('companyName') < 0) {
    errors.push(
      'Ordnen Sie mindestens eine Spalte „Spielstätte / Festival“ oder „Veranstalter (Firma)“ zu.'
    )
  }

  const regionColumn = columnOf('region')
  const stateColumn = regionColumn >= 0 && isStateColumn(rows, regionColumn)
  const defaultCountry = countryByCode(options.defaultCountry)

  // Existing records by comparison key
  const companiesByName = new Map<string, number>()
  for (const company of existing.companies) {
    const key = normalizeKey(company.name)
    if (!companiesByName.has(key)) companiesByName.set(key, company.id)
  }
  const venuesByName = new Map<string, Array<{ id: number; city: string }>>()
  for (const venue of existing.venues) {
    const key = normalizeKey(venue.name)
    venuesByName.set(key, [
      ...(venuesByName.get(key) ?? []),
      { id: venue.id, city: normalizeKey(venue.city) }
    ])
  }
  const personsByName = new Map<string, number>()
  for (const person of existing.persons) {
    if (!person.lastName.trim()) continue
    const key = normalizeKey(`${person.firstName} ${person.lastName}`)
    if (!personsByName.has(key)) personsByName.set(key, person.id)
  }

  const venues = new Map<string, VenueDraft>()
  const companies = new Map<string, CompanyDraft>()
  const persons = new Map<string, PersonDraft>()

  const refOf = (draft: DraftBase, label: string, rowNumber: number): ImportEntityRef => ({
    label,
    action: draft.existingId !== null ? 'existing' : draft.firstRow < rowNumber ? 'repeat' : 'new'
  })

  const companyFor = (name: string, rowNumber: number): CompanyDraft => {
    const normName = normalizeKey(name)
    const existingId = companiesByName.get(normName) ?? null
    const key = existingId !== null ? `id:${existingId}` : `new:${normName}`
    let draft = companies.get(key)
    if (!draft) {
      draft = {
        key,
        existingId,
        firstRow: rowNumber,
        name,
        vatNumber: '',
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

  const personFor = (parsed: ParsedPerson, scopeKey: string, rowNumber: number): PersonDraft => {
    const fullName = normalizeKey(`${parsed.firstName} ${parsed.lastName}`)
    // A first name alone is only the same person within the same company/venue
    const existingId = parsed.lastName ? (personsByName.get(fullName) ?? null) : null
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
        notes: [],
        contact: emptyContact()
      }
      persons.set(key, draft)
    }
    addNotes(draft, [parsed.notes])
    return draft
  }

  const previewRows: ImportPreviewRow[] = []
  // Venue/company of the last record row, for follow-up contact rows
  let previous: {
    rowNumber: number
    venue: VenueDraft | null
    company: CompanyDraft | null
  } | null = null
  let previousExcluded = false
  let month = ''

  for (const row of rows) {
    const cell = (column: number): string => (column >= 0 ? (row.cells[column] ?? '').trim() : '')
    const value = (field: ImportField): string => cell(columnOf(field))
    const values = (field: ImportField): string[] =>
      columnsOf(field)
        .map((column) => cell(column))
        .filter(Boolean)

    const monthValue = cleanText(value('month'))
    if (monthValue) month = monthValue

    // Rows with nothing but a month are section headings ("FEBRUAR")
    const hasData = mapping.some(
      (field, column) => field !== 'ignore' && field !== 'month' && cell(column) !== ''
    )
    if (!hasData) continue

    const venueName = cleanText(value('venueName'))
    const companyName = cleanText(value('companyName'))
    const parsedPersons = values('contactPerson').flatMap((raw) => parsePersons(raw))
    const emailText = values('email').join(' ')
    const emails = parseEmails(emailText)
    const phone = cleanText(value('phone'))
    const mobile = cleanText(value('mobile'))
    const warnings: string[] = []

    const isContinuation = !venueName && !companyName
    const namesOnly: ImportPreviewRow = {
      rowNumber: row.rowNumber,
      status: 'excluded',
      venue: venueName ? { label: venueName, action: 'new' } : null,
      company: companyName ? { label: companyName, action: 'new' } : null,
      persons: parsedPersons.map((person) => ({
        label: cleanText(`${person.firstName} ${person.lastName}`),
        action: 'new'
      })),
      warnings: []
    }

    if (excluded.has(row.rowNumber) || (isContinuation && previousExcluded)) {
      previewRows.push(namesOnly)
      if (!isContinuation) {
        previous = null
        previousExcluded = true
      }
      continue
    }
    if (isContinuation && !previous) {
      previewRows.push({
        ...namesOnly,
        status: 'orphan',
        warnings: [
          'Keine Spielstätte oder Firma in dieser oder der Zeile darüber – wird übersprungen'
        ]
      })
      continue
    }

    // ---- Region and address ----
    const region = parseRegion(value('region'), stateColumn)
    const country = region.country ?? defaultCountry
    const address: AddressDraft = {
      street: cleanText(value('street')),
      streetNumber: cleanText(value('streetNumber')),
      zipCode: normalizeZip(value('zipCode'), country?.code ?? ''),
      city: cleanText(value('city')),
      state: '',
      country: country?.name ?? '',
      countryCode: country?.code ?? ''
    }
    const hasStreetAddress = Boolean(
      address.street || address.streetNumber || address.zipCode || address.city
    )

    // ---- Venue and company of this row ----
    let venue: VenueDraft | null
    let company: CompanyDraft | null
    if (isContinuation && previous) {
      venue = previous.venue
      company = previous.company
    } else {
      const venueCity = cleanText(value('venueCity')) || (companyName ? '' : address.city)
      company = companyName ? companyFor(companyName, row.rowNumber) : null
      venue = venueName ? venueFor(venueName, venueCity, row.rowNumber) : null
      if (venue) {
        fill(venue.address, {
          city: venueCity,
          state: region.state,
          country: address.country,
          countryCode: address.countryCode
        })
        if (company && !venue.companyKey) venue.companyKey = company.key
      }
      previous = { rowNumber: row.rowNumber, venue, company }
      previousExcluded = false
    }
    // Contact data belongs to the promoter; without one, to the venue
    const organisation: CompanyDraft | VenueDraft = (company ?? venue)!

    // Postal address: the company's; without a company, the venue's
    if (hasStreetAddress) fill(organisation.address, address)
    else if (company)
      fill(company.address, { country: address.country, countryCode: address.countryCode })

    // ---- Notes ----
    const notes: string[] = []
    if (month && !isContinuation && columnOf('month') >= 0) notes.push(`Monat: ${month}`)
    for (const column of columnsOf('notes')) {
      const note = cleanText(cell(column))
      if (!note) continue
      notes.push(headers[column]?.trim() ? `${noteLabel(headers[column])}: ${note}` : note)
    }

    const capacityText = cleanText(value('capacity'))
    if (capacityText) {
      const capacity = parseCapacity(capacityText)
      if (venue && capacity !== null && venue.capacity === null) venue.capacity = capacity
      if (capacity === null || !/^[\d.]+$/.test(capacityText)) {
        notes.push(`Kapazität: ${capacityText}`)
      }
    }

    const taxText = cleanText(value('taxId'))
    if (taxText) {
      if (company) fill(company, parseTaxId(taxText))
      else notes.push(`USt-IdNr./Steuernummer: ${taxText}`)
    }

    // ---- Contact data ----
    const homepage =
      normalizeUrl(value('homepage')) ||
      (emails.length === 0 && looksLikeDomain(emailText) ? normalizeUrl(emailText) : '')
    if (homepage) {
      fill(organisation.contact, { homepage })
      if (venue && venue !== organisation) fill(venue.contact, { homepage })
    }
    if (emailText && emails.length === 0 && !homepage) {
      warnings.push(`Keine gültige E-Mail-Adresse: „${cleanText(emailText)}“`)
    }

    // Personal addresses go to the persons, the rest to the company/venue
    const personEmails = parsedPersons.map((person, index): string => {
      const named = emails.find((email) => emailMatchesPerson(email, person))
      if (named) return named
      if (emails.length === parsedPersons.length) return emails[index]
      return parsedPersons.length === 1 && emails.length === 1 ? emails[0] : ''
    })
    const generalEmail = emails.find((email) => !personEmails.includes(email)) ?? emails[0] ?? ''
    fill(organisation.contact, { email: generalEmail, phone })
    if (parsedPersons.length !== 1) fill(organisation.contact, { mobilePhone: mobile })
    const unused = emails.filter(
      (email) => email !== organisation.contact.email && !personEmails.includes(email)
    )
    if (unused.length > 0) notes.push(`Weitere E-Mail: ${unused.join(', ')}`)

    // ---- Persons ----
    const scopeKey = company?.key ?? venue?.key ?? ''
    const personDrafts = parsedPersons.map((parsed) => personFor(parsed, scopeKey, row.rowNumber))
    const personRefs = parsedPersons.map((parsed, index) => {
      const person = personDrafts[index]
      fill(person.contact, {
        email: personEmails[index],
        ...(parsedPersons.length === 1 ? { phone, mobilePhone: mobile } : {})
      })
      const role = parsed.role || DEFAULT_ROLE
      if (company && !company.members.has(person.key)) company.members.set(person.key, role)
      if (venue && !venue.members.has(person.key)) venue.members.set(person.key, role)
      return refOf(person, cleanText(`${person.firstName} ${person.lastName}`), row.rowNumber)
    })

    // A follow-up row's comment is about its one contact ("zuständig für …")
    addNotes(
      isContinuation && personDrafts.length === 1 ? personDrafts[0] : (venue ?? organisation),
      notes
    )

    previewRows.push({
      rowNumber: row.rowNumber,
      status: isContinuation ? 'continuation' : 'record',
      venue: venue
        ? refOf(
            venue,
            venue.address.city ? `${venue.name} (${venue.address.city})` : venue.name,
            isContinuation ? Infinity : row.rowNumber
          )
        : null,
      company: company
        ? refOf(company, company.name, isContinuation ? Infinity : row.rowNumber)
        : null,
      persons: personRefs,
      warnings
    })
  }

  const count = (drafts: DraftBase[]): { new: number; existing: number } => ({
    new: drafts.filter((draft) => draft.existingId === null).length,
    existing: drafts.filter((draft) => draft.existingId !== null).length
  })

  return {
    preview: {
      rows: previewRows,
      summary: {
        venues: count([...venues.values()]),
        companies: count([...companies.values()]),
        persons: count([...persons.values()])
      },
      errors
    },
    venues: [...venues.values()],
    companies: [...companies.values()],
    persons: [...persons.values()]
  }
}
