import type {
  ImportCount,
  ImportEntityRef,
  ImportField,
  ImportPreview,
  ImportPreviewRow,
  ImportRequest,
  ImportRow
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
  parseBirthday,
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
// One shared context (existing records, drafts, matching) and one row loop
// per kind of list: venue/company lists, band lists, person lists.

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

export interface ImportPlan {
  preview: ImportPreview
  venues: VenueDraft[]
  bands: BandDraft[]
  companies: CompanyDraft[]
  persons: PersonDraft[]
}

export interface ExistingRecords {
  venues: Array<{ id: number; name: string; city: string }>
  bands: Array<{ id: number; name: string }>
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

const personLabel = (person: { firstName: string; lastName: string }): string =>
  cleanText(`${person.firstName} ${person.lastName}`)

// ----------------------------------------
// Shared context
// ----------------------------------------

function createContext(request: ImportRequest, existing: ExistingRecords) {
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

  const personFor = (parsed: ParsedPerson, scopeKey: string, rowNumber: number): PersonDraft => {
    const fullName = normalizeKey(`${parsed.firstName} ${parsed.lastName}`)
    // A first name alone is only the same person within the same scope
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
      errors
    },
    venues: [...venues.values()],
    bands: [...bands.values()],
    companies: [...companies.values()],
    persons: [...persons.values()]
  })

  return {
    request,
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
    finish
  }
}

type PlanContext = ReturnType<typeof createContext>

/** Preview row of a row that is not imported (names as written) */
function notImported(
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

// ----------------------------------------
// Venue and company lists
// ----------------------------------------
// One row = a venue/festival and/or a company (promoter) with contacts.
// Rows without either add contacts to the row above.

function buildOrganisationRows(ctx: PlanContext): ImportPreviewRow[] {
  const previewRows: ImportPreviewRow[] = []
  let previous: { venue: VenueDraft | null; company: CompanyDraft | null } | null = null
  let previousExcluded = false
  let month = ''

  for (const row of ctx.request.rows) {
    const read = ctx.reader(row)
    const monthValue = cleanText(read.value('month'))
    if (monthValue) month = monthValue
    // Rows with nothing but a month are section headings ("FEBRUAR")
    if (!read.hasData) continue

    const venueName = cleanText(read.value('venueName'))
    const companyName = cleanText(read.value('companyName'))
    const parsedPersons = read.values('contactPerson').flatMap((raw) => parsePersons(raw))
    const emailText = read.values('email').join(' ')
    const emails = parseEmails(emailText)
    const phone = cleanText(read.value('phone'))
    const mobile = cleanText(read.value('mobile'))
    const warnings: string[] = []

    const isContinuation = !venueName && !companyName
    const names = {
      primary: venueName,
      company: companyName,
      persons: parsedPersons.map(personLabel)
    }

    if (ctx.excluded.has(row.rowNumber) || (isContinuation && previousExcluded)) {
      previewRows.push(notImported(row.rowNumber, 'excluded', names))
      if (!isContinuation) {
        previous = null
        previousExcluded = true
      }
      continue
    }
    if (isContinuation && !previous) {
      previewRows.push(
        notImported(row.rowNumber, 'skipped', names, [
          'Kein Name in dieser oder der Zeile darüber – wird übersprungen'
        ])
      )
      continue
    }

    const { address, hasStreetAddress } = ctx.addressOf(read)

    // ---- Venue and company of this row ----
    let venue: VenueDraft | null
    let company: CompanyDraft | null
    if (isContinuation && previous) {
      venue = previous.venue
      company = previous.company
    } else {
      const venueCity = cleanText(read.value('venueCity')) || (companyName ? '' : address.city)
      company = companyName ? ctx.companyFor(companyName, row.rowNumber) : null
      venue = venueName ? ctx.venueFor(venueName, venueCity, row.rowNumber) : null
      if (venue) {
        fill(venue.address, {
          city: venueCity,
          state: address.state,
          country: address.country,
          countryCode: address.countryCode
        })
        if (company && !venue.companyKey) venue.companyKey = company.key
      }
      previous = { venue, company }
      previousExcluded = false
    }
    // Contact data belongs to the promoter; without one, to the venue
    const organisation: CompanyDraft | VenueDraft = (company ?? venue)!

    // Postal address: the company's; without a company, the venue's. The
    // Land column describes the venue when there is one.
    const postal = venue ? { ...address, state: '' } : address
    if (hasStreetAddress) fill(organisation.address, postal)
    else if (company) {
      fill(company.address, {
        state: postal.state,
        country: postal.country,
        countryCode: postal.countryCode
      })
    }

    // ---- Notes ----
    const notes: string[] = []
    if (month && !isContinuation && ctx.columnOf('month') >= 0) notes.push(`Monat: ${month}`)
    notes.push(...read.notes())

    const capacityText = cleanText(read.value('capacity'))
    if (capacityText) {
      const capacity = parseCapacity(capacityText)
      if (venue && capacity !== null && venue.capacity === null) venue.capacity = capacity
      if (capacity === null || !/^[\d.]+$/.test(capacityText)) {
        notes.push(`Kapazität: ${capacityText}`)
      }
    }

    const taxText = cleanText(read.value('taxId'))
    if (taxText) {
      if (company) fill(company, parseTaxId(taxText))
      else notes.push(`USt-IdNr./Steuernummer: ${taxText}`)
    }

    // ---- Contact data ----
    const homepage =
      normalizeUrl(read.value('homepage')) ||
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
    const personDrafts = parsedPersons.map((parsed) =>
      ctx.personFor(parsed, scopeKey, row.rowNumber)
    )
    const personRefs = parsedPersons.map((parsed, index) => {
      const person = personDrafts[index]
      fill(person.contact, {
        email: personEmails[index],
        ...(parsedPersons.length === 1 ? { phone, mobilePhone: mobile } : {})
      })
      const role = parsed.role || DEFAULT_ROLE
      if (company && !company.members.has(person.key)) company.members.set(person.key, role)
      if (venue && !venue.members.has(person.key)) venue.members.set(person.key, role)
      return ctx.refOf(person, personLabel(person), row.rowNumber)
    })

    // A follow-up row's comment is about its one contact ("zuständig für …")
    addNotes(
      isContinuation && personDrafts.length === 1 ? personDrafts[0] : (venue ?? organisation),
      notes
    )

    const at = isContinuation ? Infinity : row.rowNumber
    previewRows.push({
      rowNumber: row.rowNumber,
      status: isContinuation ? 'continuation' : 'record',
      primary: venue
        ? ctx.refOf(
            venue,
            venue.address.city ? `${venue.name} (${venue.address.city})` : venue.name,
            at
          )
        : null,
      company: company ? ctx.refOf(company, company.name, at) : null,
      persons: personRefs,
      warnings
    })
  }
  return previewRows
}

// ----------------------------------------
// Band lists
// ----------------------------------------
// One row = a band (its company must exist) with members and technical lead.
// Rows without a band name add members to the band above.

function buildBandRows(ctx: PlanContext): ImportPreviewRow[] {
  const previewRows: ImportPreviewRow[] = []
  let previous: BandDraft | null = null
  // The band above is not imported: its follow-up rows neither
  let previousMissing: 'excluded' | 'skipped' | null = null

  for (const row of ctx.request.rows) {
    const read = ctx.reader(row)
    if (!read.hasData) continue

    const bandName = cleanText(read.value('bandName'))
    const companyName = cleanText(read.value('companyName'))
    const members = read.values('members').flatMap((raw) => parsePersons(raw))
    const lead = parsePersons(read.value('responsiblePerson'))[0] ?? null
    const isContinuation = !bandName
    const names = {
      primary: bandName,
      company: companyName,
      persons: [...members, ...(lead ? [lead] : [])].map(personLabel)
    }

    if (ctx.excluded.has(row.rowNumber) || (isContinuation && previousMissing === 'excluded')) {
      previewRows.push(notImported(row.rowNumber, 'excluded', names))
      if (!isContinuation) {
        previous = null
        previousMissing = 'excluded'
      }
      continue
    }
    if (isContinuation && !previous) {
      previewRows.push(
        notImported(row.rowNumber, 'skipped', names, [
          previousMissing === 'skipped'
            ? 'Die Band darüber wird nicht importiert'
            : 'Kein Bandname in dieser oder der Zeile darüber – wird übersprungen'
        ])
      )
      continue
    }

    const warnings: string[] = []
    let band: BandDraft
    if (isContinuation && previous) {
      band = previous
    } else {
      // Business rule: every band belongs to a company that already exists
      const companyId = companyName ? ctx.companiesByName.get(normalizeKey(companyName)) : undefined
      if (companyId === undefined) {
        previewRows.push(
          notImported(row.rowNumber, 'skipped', names, [
            companyName
              ? `Firma „${companyName}“ nicht gefunden – bitte zuerst unter Firmen anlegen`
              : 'Keine Firma angegeben – jede Band gehört zu einer Firma'
          ])
        )
        previous = null
        previousMissing = 'skipped'
        continue
      }
      band = ctx.bandFor(bandName, companyId, row.rowNumber)
      previous = band
      previousMissing = null
      fill(band, {
        genre: cleanText(read.value('genre')),
        founded: cleanText(read.value('founded'))
      })
      const management = cleanText(read.value('managementCompany'))
      if (management) {
        const managementId = ctx.companiesByName.get(normalizeKey(management))
        if (managementId === undefined) {
          warnings.push(`Management „${management}“ nicht gefunden – wird nicht zugeordnet`)
        } else if (band.managementCompanyId === null) {
          band.managementCompanyId = managementId
        }
      }
    }

    // ---- Members and technical lead ----
    const memberDrafts = members.map((parsed) => {
      const person = ctx.personFor(parsed, band.key, row.rowNumber)
      if (!band.members.has(person.key)) band.members.set(person.key, parsed.role)
      return person
    })
    const leadDraft = lead ? ctx.personFor(lead, band.key, row.rowNumber) : null
    if (leadDraft && band.responsiblePersonKey === null) band.responsiblePersonKey = leadDraft.key

    // Contact columns describe the technical lead (else a single member)
    const notes = read.notes()
    const contactPerson = leadDraft ?? (memberDrafts.length === 1 ? memberDrafts[0] : null)
    const emails = parseEmails(read.values('email').join(' '))
    const phone = cleanText(read.value('phone'))
    const mobile = cleanText(read.value('mobile'))
    if (contactPerson) {
      fill(contactPerson.contact, { email: emails[0] ?? '', phone, mobilePhone: mobile })
      if (emails.length > 1) notes.push(`Weitere E-Mail: ${emails.slice(1).join(', ')}`)
    } else {
      if (emails.length > 0) notes.push(`E-Mail: ${emails.join(', ')}`)
      if (phone) notes.push(`Telefon: ${phone}`)
      if (mobile) notes.push(`Mobil: ${mobile}`)
    }
    const people = [...memberDrafts, ...(leadDraft ? [leadDraft] : [])]
    addNotes(isContinuation && people.length === 1 ? people[0] : band, notes)

    const at = isContinuation ? Infinity : row.rowNumber
    previewRows.push({
      rowNumber: row.rowNumber,
      status: isContinuation ? 'continuation' : 'record',
      primary: ctx.refOf(band, band.name, at),
      company: isContinuation ? null : { label: companyName, action: 'existing' },
      persons: [
        ...memberDrafts.map((person) => ctx.refOf(person, personLabel(person), row.rowNumber)),
        ...(leadDraft
          ? [
              {
                ...ctx.refOf(leadDraft, personLabel(leadDraft), row.rowNumber),
                label: `${personLabel(leadDraft)} (Technischer Leiter)`
              }
            ]
          : [])
      ],
      warnings
    })
  }
  return previewRows
}

// ----------------------------------------
// Person lists
// ----------------------------------------
// One row = one person with contact data and address, optionally a member
// of a company (created if new).

function buildPersonRows(ctx: PlanContext): ImportPreviewRow[] {
  const previewRows: ImportPreviewRow[] = []

  for (const row of ctx.request.rows) {
    const read = ctx.reader(row)
    if (!read.hasData) continue

    const firstName = cleanText(read.value('firstName'))
    const lastName = cleanText(read.value('lastName'))
    const parsed: ParsedPerson[] =
      firstName || lastName
        ? [
            {
              firstName: firstName || lastName,
              lastName: firstName ? lastName : '',
              role: '',
              notes: ''
            }
          ]
        : parsePersons(read.value('personName'))
    const companyName = cleanText(read.value('companyName'))
    const names = { primary: parsed[0] ? personLabel(parsed[0]) : '', company: companyName }

    if (ctx.excluded.has(row.rowNumber)) {
      previewRows.push(notImported(row.rowNumber, 'excluded', names))
      continue
    }
    if (parsed.length === 0) {
      previewRows.push(
        notImported(row.rowNumber, 'skipped', names, ['Kein Name – wird übersprungen'])
      )
      continue
    }

    const warnings: string[] = []
    if (parsed.length > 1) {
      warnings.push(`Mehrere Namen – nur „${personLabel(parsed[0])}“ wird übernommen`)
    }
    const company = companyName ? ctx.companyFor(companyName, row.rowNumber) : null
    const person = ctx.personFor(parsed[0], company?.key ?? `row:${row.rowNumber}`, row.rowNumber)

    const { address, hasStreetAddress } = ctx.addressOf(read)
    if (hasStreetAddress) fill(person.address, address)

    const notes = read.notes()
    const birthdayText = cleanText(read.value('birthday'))
    if (birthdayText) {
      const birthday = parseBirthday(birthdayText)
      if (birthday) fill(person, { birthday })
      else notes.push(`Geburtstag: ${birthdayText}`)
    }

    const emailText = read.values('email').join(' ')
    const emails = parseEmails(emailText)
    if (emailText && emails.length === 0) {
      warnings.push(`Keine gültige E-Mail-Adresse: „${cleanText(emailText)}“`)
    }
    fill(person.contact, {
      email: emails[0] ?? '',
      phone: cleanText(read.value('phone')),
      mobilePhone: cleanText(read.value('mobile')),
      homepage: normalizeUrl(read.value('homepage'))
    })
    if (emails.length > 1) notes.push(`Weitere E-Mail: ${emails.slice(1).join(', ')}`)
    addNotes(person, notes)

    if (company && !company.members.has(person.key)) {
      company.members.set(person.key, cleanText(read.value('role')) || parsed[0].role)
    }

    previewRows.push({
      rowNumber: row.rowNumber,
      status: 'record',
      primary: ctx.refOf(person, personLabel(person), row.rowNumber),
      company: company ? ctx.refOf(company, company.name, row.rowNumber) : null,
      persons: [],
      warnings
    })
  }
  return previewRows
}

/** Columns a target cannot do without */
function missingColumns(request: ImportRequest): string[] {
  const has = (field: ImportField) => request.mapping.includes(field)
  switch (request.target) {
    case 'venues':
      return has('venueName') || has('companyName')
        ? []
        : ['Ordnen Sie eine Spalte „Club / Festival“ oder „Veranstalter (Firma)“ zu.']
    case 'companies':
      return has('companyName') ? [] : ['Ordnen Sie die Spalte „Firma“ zu.']
    case 'bands':
      return [
        ...(has('bandName') ? [] : ['Ordnen Sie die Spalte „Band“ zu.']),
        ...(has('companyName')
          ? []
          : ['Ordnen Sie die Spalte „Firma der Band“ zu – jede Band gehört zu einer Firma.'])
      ]
    case 'persons':
      return has('personName') || has('firstName') || has('lastName')
        ? []
        : ['Ordnen Sie eine Spalte „Name“ oder „Vorname“/„Nachname“ zu.']
  }
}

export function buildImportPlan(request: ImportRequest, existing: ExistingRecords): ImportPlan {
  const ctx = createContext(request, existing)
  const errors = missingColumns(request)
  if (errors.length > 0) return ctx.finish([], errors)

  const rows =
    request.target === 'bands'
      ? buildBandRows(ctx)
      : request.target === 'persons'
        ? buildPersonRows(ctx)
        : buildOrganisationRows(ctx)
  return ctx.finish(rows, errors)
}
