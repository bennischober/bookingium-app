// Tour import (Tourdaten): turns the rows of a tour sheet into the events it creates, updates
// and leaves alone, and the clubs and festivals it has to create. Pure - no database, no
// Electron; TourImportRepository writes the plan in one transaction.
//
// An event is found again by band and date (a band plays one show a day), so the next version
// of the sheet updates the events instead of adding them twice. Only the mapped columns change
// an existing event; an empty cell leaves its field as it is. A venue is matched by name (and
// city, when both sides know it); one the app does not know is created once per name and city.

import type { DealMemoStatus } from '../api/schemas/deal_memo.schema'
import type { VenueKind } from '../api/schemas/venue.schema'
import type {
  TourImportField,
  TourImportPreview,
  TourImportPreviewRow,
  TourImportRequest
} from '../api/schemas/tour_import.schema'
import { toCents } from '../einvoice/amounts'
import { RADIUS_KM_MAX, RADIUS_WEEKS_MAX } from '../map/radius'
import {
  RADIUS_AFTER_HEADERS,
  RADIUS_BEFORE_HEADERS,
  RADIUS_KM_HEADERS,
  parseBookingKind,
  parseClauseNumber,
  parseShowDate
} from './agencyBookings'
import { cleanText, findCountry, normalizeKey, normalizeZip } from './normalize'
import { hasGeneratedHeaders } from './generatedHeaders'

// Header spellings (compared with normalizeKey: lower case, punctuation as spaces)
const HEADER_SYNONYMS: Array<[TourImportField, string[]]> = [
  ['band', ['band', 'bands', 'bandname', 'künstler', 'kuenstler', 'artist', 'act', 'interpret']],
  [
    'date',
    ['datum', 'date', 'showdatum', 'showdate', 'konzertdatum', 'eventdatum', 'termin', 'spieltag']
  ],
  ['eventName', ['event', 'eventname', 'name', 'titel', 'veranstaltung', 'show', 'konzert']],
  [
    'venueName',
    [
      'venue',
      'spielstätte',
      'spielstaette',
      'club',
      'festival',
      'club festival',
      'location',
      'halle',
      'veranstaltungsort',
      'spielort'
    ]
  ],
  ['street', ['straße', 'strasse', 'str', 'street', 'adresse', 'address', 'anschrift']],
  ['zipCode', ['plz', 'zip', 'postleitzahl', 'postcode', 'zipcode', 'zip code']],
  ['city', ['ort', 'stadt', 'city', 'town', 'wo']],
  ['country', ['land', 'country', 'staat']],
  ['kind', ['art', 'typ', 'type', 'kategorie', 'kind', 'showtyp', 'showart']],
  ['status', ['status', 'stand', 'buchungsstatus', 'state']],
  ['tour', ['tour', 'tourname', 'tour name', 'tournee', 'leg', 'tourabschnitt']],
  ['deal', ['deal', 'dealtyp', 'konditionen', 'vereinbarung', 'split', 'door deal']],
  [
    'guarantee',
    ['gage', 'garantie', 'festgage', 'fee', 'guarantee', 'honorar', 'garantiegage', 'gage netto']
  ],
  [
    'ticketPriceVvk',
    ['vvk', 'ticketpreis vvk', 'vorverkauf', 'presale', 'ticket vvk', 'eintritt vvk']
  ],
  ['ticketPriceAk', ['ak', 'ticketpreis ak', 'abendkasse', 'door', 'ticket ak', 'eintritt ak']],
  [
    'performanceTime',
    [
      'showtime',
      'show time',
      'spielzeit',
      'auftrittszeit',
      'stagetime',
      'stage time',
      'beginn',
      'uhrzeit'
    ]
  ],
  ['radiusKm', RADIUS_KM_HEADERS],
  ['radiusWeeksBefore', RADIUS_BEFORE_HEADERS],
  ['radiusWeeksAfter', RADIUS_AFTER_HEADERS],
  [
    'notes',
    [
      'notiz',
      'notizen',
      'bemerkung',
      'bemerkungen',
      'anmerkung',
      'anmerkungen',
      'kommentar',
      'notes',
      'note',
      'comment',
      'info'
    ]
  ],
  [
    'promoter',
    [
      'veranstalter',
      'promoter',
      'lopro',
      'local promoter',
      'örtlicher veranstalter',
      'oertlicher veranstalter'
    ]
  ],
  [
    'promoterContact',
    [
      'ansprechpartner',
      'kontakt',
      'contact',
      'kontaktperson',
      'promoter kontakt',
      'promoter contact',
      'ansprechpartner veranstalter'
    ]
  ],
  [
    'promoterEmail',
    ['email', 'e mail', 'mail', 'kontakt email', 'kontakt e mail', 'email ansprechpartner']
  ]
]

const FIELD_BY_HEADER = new Map<string, TourImportField>(
  HEADER_SYNONYMS.flatMap(([field, names]) => names.map((name) => [normalizeKey(name), field]))
)

// A weekday column ("Tag": FR, SA) sits next to the date in most tour sheets; it says nothing
// the date does not, so it is never imported - and never mistaken for the date
const WEEKDAY_HEADERS = new Set(
  ['tag', 'wochentag', 'wt', 'day', 'weekday', 'wochen tag'].map((name) => normalizeKey(name))
)

const WEEKDAYS = new Set(
  [
    'mo',
    'di',
    'mi',
    'do',
    'fr',
    'sa',
    'so',
    'mon',
    'tue',
    'wed',
    'thu',
    'fri',
    'sat',
    'sun',
    'montag',
    'dienstag',
    'mittwoch',
    'donnerstag',
    'freitag',
    'samstag',
    'sonntag',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday'
  ].map((day) => normalizeKey(day))
)

const isWeekday = (value: string): boolean => WEEKDAYS.has(normalizeKey(value).replace(/\s/g, ''))

/** What a column's cells hold, as shares of its filled cells */
type ColumnProfile = {
  filled: number
  dates: number
  weekdays: number
  emails: number
  amounts: number
  statuses: number
  text: number
}

function profileColumns(width: number, rows: Array<{ cells: string[] }>): ColumnProfile[] {
  return Array.from({ length: width }, (_, index) => {
    const values = rows.map((row) => cleanText(row.cells[index] ?? '')).filter(Boolean)
    const share = (test: (value: string) => boolean): number =>
      values.length === 0 ? 0 : values.filter(test).length / values.length
    return {
      filled: values.length,
      dates: share((value) => parseShowDate(value) !== ''),
      weekdays: share(isWeekday),
      emails: share((value) => emailOf(value) !== ''),
      amounts: share((value) => parseAmountCents(value) !== null),
      statuses: share((value) => statusOf(value) !== null),
      text: share((value) => !value.includes('@') && /\p{L}/u.test(value))
    }
  })
}

/**
 * The field a header names, checked against what its cells hold: a "Tag" or "Datum" column of
 * weekdays is no date, a "Status" of "angeschrieben am 05.10." is no booking status (it goes to
 * the notes with its header), a "Promoter Contact" of e-mail addresses is the e-mail. Null when
 * the cells contradict the header.
 */
function headerField(header: string, column: ColumnProfile): TourImportField | 'weekday' | null {
  const key = normalizeKey(header)
  if (WEEKDAY_HEADERS.has(key)) return 'weekday'
  const field = FIELD_BY_HEADER.get(key)
  if (!field) return null
  if (column.filled === 0) return field
  if (column.weekdays >= 0.8) return 'weekday'
  switch (field) {
    case 'date':
      return column.dates >= 0.5 ? field : null
    case 'status':
      return column.statuses >= 0.5 ? field : null
    case 'guarantee':
    case 'ticketPriceVvk':
    case 'ticketPriceAk':
      return column.amounts >= 0.5 ? field : null
    case 'promoter':
    case 'promoterContact':
      return column.emails >= 0.6 ? 'promoterEmail' : field
    case 'promoterEmail':
      return column.emails >= 0.6 ? field : null
    case 'city':
    case 'venueName':
    case 'band':
      return column.emails >= 0.6 ? null : field
    default:
      return field
  }
}

/**
 * The column mapping for a tour sheet. Headers name the fields, checked against the cells; a
 * column whose cells are dates or e-mail addresses is taken by what it holds when no header
 * named that field; weekday columns are left out; any other filled column goes into the notes
 * with its header ("Anfangsbestand: 200"). Each field takes its first column, a second one goes
 * into the notes too. A sheet without a header row ("Spalte A", …) is mapped by its cells alone:
 * the first two text columns after the date are city and club (the usual order), then promoter
 * and contact. The dialog shows the guess; anything can be changed there.
 */
export function detectTourMapping(
  headers: string[],
  rows: Array<{ cells: string[] }> = []
): TourImportField[] {
  const generated = hasGeneratedHeaders(headers)
  const columns = profileColumns(headers.length, rows)
  const mapping: TourImportField[] = headers.map(() => 'ignore')
  const decided = new Set<number>()
  const taken = new Set<TourImportField>()
  const assign = (index: number, field: TourImportField): void => {
    decided.add(index)
    if (field !== 'notes' && taken.has(field)) {
      mapping[index] = columns[index].filled > 0 ? 'notes' : 'ignore'
      return
    }
    mapping[index] = field
    if (field !== 'notes') taken.add(field)
  }

  if (!generated) {
    headers.forEach((header, index) => {
      const field = headerField(header, columns[index])
      if (field === 'weekday') decided.add(index)
      else if (field) assign(index, field)
    })
  }

  const open = (index: number): boolean => !decided.has(index) && columns[index].filled > 0
  columns.forEach((column, index) => {
    if (open(index) && column.weekdays >= 0.8) decided.add(index)
  })
  if (!taken.has('date')) {
    const date = columns.findIndex((column, index) => open(index) && column.dates >= 0.8)
    if (date >= 0) assign(date, 'date')
  }
  // Without a date there is nothing to import; a headerless sheet stays unmapped
  if (generated && !taken.has('date')) return mapping
  const dateColumn = mapping.indexOf('date')
  const textFields: TourImportField[] = generated
    ? ['city', 'venueName', 'promoter', 'promoterContact']
    : []
  columns.forEach((column, index) => {
    if (!open(index)) return
    if (!taken.has('promoterEmail') && column.emails >= 0.6) return assign(index, 'promoterEmail')
    const field = index > dateColumn && column.text >= 0.8 ? textFields.shift() : undefined
    assign(index, field ?? 'notes')
  })
  return mapping
}

/**
 * What a title row above a tour sheet says ("APRIL ART TOUR Herbst 2026"): the band it names (the
 * longest known band name in it) and the tour (what is left, without a leading "Tour")
 */
export function tourTitleHints(
  title: string,
  bands: Array<{ name: string }>
): { band: string; tour: string } {
  const text = cleanText(title)
  if (!text) return { band: '', tour: '' }
  const padded = ` ${normalizeKey(text)} `
  const band = [...bands]
    .filter((candidate) => normalizeKey(candidate.name))
    .sort((a, b) => b.name.length - a.name.length)
    .find((candidate) => padded.includes(` ${normalizeKey(candidate.name)} `))
  if (!band) return { band: '', tour: '' }
  // The band's words are dropped wherever they stand, case-insensitively
  const words = normalizeKey(band.name).split(' ')
  let rest = text
  for (const word of words) {
    rest = rest.replace(
      new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}(?=$|[^\\p{L}\\p{N}])`, 'iu'),
      '$1'
    )
  }
  const tour = cleanText(rest)
    .replace(/^[-–:|]+\s*/, '')
    .replace(/^(tourdaten|tournee|tour)\b[\s:–-]*/i, '')
    .trim()
  return { band: band.name, tour }
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * An amount in a cell as cents: "1.500 €", "1500,00", "1,500.00", "EUR 800"; null when the cell
 * holds no number
 */
export function parseAmountCents(raw: string): number | null {
  const compact = cleanText(raw).replace(/\s|€|eur(o)?|,-$|\.-$/gi, '')
  if (!compact) return null
  let normalized: string
  if (compact.includes(',') && compact.includes('.')) {
    // the last separator is the decimal one: "1.500,50" or "1,500.50"
    normalized =
      compact.lastIndexOf(',') > compact.lastIndexOf('.')
        ? compact.replace(/\./g, '').replace(',', '.')
        : compact.replace(/,/g, '')
  } else if (compact.includes(',')) {
    normalized = /^-?\d{1,3}(,\d{3})+$/.test(compact)
      ? compact.replace(/,/g, '')
      : compact.replace(',', '.')
  } else {
    normalized = /^-?\d{1,3}(\.\d{3})+$/.test(compact) ? compact.replace(/\./g, '') : compact
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  return toCents(Number(normalized))
}

const CANCELLED = ['abgesagt', 'storniert', 'storno', 'cancelled', 'canceled', 'abgebrochen']
const PENDING = [
  'option',
  'optioniert',
  'angefragt',
  'anfrage',
  'pending',
  'offen',
  'reserviert',
  'hold',
  'tentative',
  'vorläufig',
  'vorlaeufig',
  'unbestätigt',
  'unbestaetigt',
  'ausstehend'
]
const CONFIRMED = [
  'fix',
  'bestätigt',
  'bestaetigt',
  'confirmed',
  'gebucht',
  'zugesagt',
  'ok',
  'fest'
]

/** The event's status from the sheet's wording; the dialog's default when the cell says nothing known */
export function parseEventStatus(raw: string, fallback: DealMemoStatus): DealMemoStatus {
  return statusOf(raw) ?? fallback
}

/** The booking status a cell names, null for anything else ("angeschrieben am 05.10.") */
function statusOf(raw: string): DealMemoStatus | null {
  const words = normalizeKey(raw).split(' ').filter(Boolean)
  if (words.some((word) => CANCELLED.includes(word))) return 'cancelled'
  if (words.some((word) => PENDING.includes(word))) return 'pending'
  if (words.some((word) => CONFIRMED.includes(word))) return 'confirmed'
  return null
}

/** "20:00", "20.00 Uhr", "8 pm" as HH:MM; the cell as written when it is no time */
export function parseShowTime(raw: string): string {
  const text = cleanText(raw)
  const match = text.match(/(\d{1,2})[:.](\d{2})/)
  if (match && Number(match[1]) < 24 && Number(match[2]) < 60)
    return `${match[1].padStart(2, '0')}:${match[2]}`
  return text
}

/** A venue the app knows, as the repository loads it */
export type TourVenue = { id: number; name: string; kind: string; city: string }

/** An event the app knows (not archived), with the fields an import can change */
export type TourEvent = {
  id: number
  band_id: number
  date: string
  name: string
  venue_id: number | null
  status: string
  tour: string
  deal: string
  guarantee_cents: number | null
  ticket_price_vvk_cents: number | null
  ticket_price_ak_cents: number | null
  performance_time: string | null
  radius_km: number | null
  radius_weeks_before: number | null
  radius_weeks_after: number | null
  notes: string
  lopro_company_id?: number | null
  lopro_person_id?: number | null
}

export type TourImportExisting = {
  bands: Array<{ id: number; name: string }>
  venues: TourVenue[]
  events: TourEvent[]
  /** Companies and persons a promoter or contact is matched against (#228 follow-up) */
  companies?: Array<{ id: number; name: string }>
  persons?: Array<{ id: number; firstName: string; lastName: string; email: string }>
}

/** A promoter company the import creates */
export type NewPromoterDraft = { key: string; name: string; email: string }

/** A contact person the import creates, member of the promoter (role "Kontakt") */
export type NewContactDraft = {
  key: string
  firstName: string
  lastName: string
  email: string
  company: { id: number } | { key: string } | null
}

/** The LoPro links of an event: existing records or drafts of this import */
export type TourLoPro = {
  company: { id: number } | { key: string } | null
  person: { id: number } | { key: string } | null
}

/** A club or festival the import creates; `key` ties the events to it */
export type NewVenueDraft = {
  key: string
  name: string
  kind: VenueKind
  street: string
  zip_code: string
  city: string
  country: string
  country_code: string
}

/** The event columns an import writes; absent keys stay as they are on an update */
export type TourEventFields = Partial<
  Omit<TourEvent, 'id' | 'band_id' | 'date' | 'venue_id' | 'status'> & { status: DealMemoStatus }
>

export type TourEventDraft = {
  band_id: number
  date: string
  /** An existing venue, or the key of a NewVenueDraft, or none */
  venue: { id: number } | { key: string } | null
  fields: TourEventFields & { name: string; status: DealMemoStatus }
  lopro?: TourLoPro
}

export type TourImportPlan = {
  preview: TourImportPreview
  venues: NewVenueDraft[]
  create: TourEventDraft[]
  update: Array<{
    id: number
    venue: TourEventDraft['venue']
    fields: TourEventFields
    lopro?: TourLoPro
  }>
  promoters: NewPromoterDraft[]
  contacts: NewContactDraft[]
}

/** "10115 Berlin" in one Ort column: the postcode and the place */
function splitPlace(city: string): { zip: string; city: string } | null {
  const match = city.match(/^(\d{4,5})\s+(.+)$/)
  return match ? { zip: match[1], city: match[2] } : null
}

const sameValue = (a: unknown, b: unknown) => (a ?? null) === (b ?? null)

/** The first e-mail address in a cell (' lp@x.de', 'bs@x.de>'), '' when there is none */
export function emailOf(raw: string): string {
  const match = raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/)
  return match ? match[0].toLowerCase() : ''
}

/**
 * A promoter cell without the contact's first name tacked on, as hand-kept lists write it
 * ('Batschkapp / Anna', 'Hellraiser katrin' with contact Anna or Katrin → 'Batschkapp',
 * 'Hellraiser'); any other name stays as written
 */
export function promoterNameOf(raw: string, contactName: string): string {
  const name = cleanText(raw)
  const first = normalizeKey(cleanText(contactName).split(' ')[0] ?? '')
  if (!first) return name
  const match = name.match(/^(.*?)[\s/,–-]+([\p{L}-]+)$/u)
  if (!match || normalizeKey(match[2]) !== first || !match[1].trim()) return name
  return match[1].trim()
}

/** 'Lisa-Marie Junger' → first and last name; one word is a first name */
function splitName(raw: string): { firstName: string; lastName: string } {
  const words = cleanText(raw).split(' ').filter(Boolean)
  if (words.length <= 1) return { firstName: words[0] ?? '', lastName: '' }
  return { firstName: words.slice(0, -1).join(' '), lastName: words[words.length - 1] }
}

/**
 * The plan for one tour sheet. Rows without a known band or a date are skipped (a band is never
 * invented: it needs its company first). A band and date the sheet lists twice keep their first row.
 */
export function buildTourImportPlan(
  request: TourImportRequest,
  existing: TourImportExisting
): TourImportPlan {
  const errors: string[] = []
  const columnsOf = (field: TourImportField) =>
    request.mapping.flatMap((mapped, index) => (mapped === field ? [index] : []))
  const has = (field: TourImportField) => columnsOf(field).length > 0
  const sheetBand = request.band.trim()
  if (!has('band') && !sheetBand) {
    errors.push('Bitte eine Band für alle Zeilen wählen oder eine Spalte der Band zuordnen.')
  }
  const generated = hasGeneratedHeaders(request.headers)
  if (!has('date')) errors.push('Keine Spalte ist dem Datum zugeordnet.')

  const bandsByName = new Map(existing.bands.map((band) => [normalizeKey(band.name), band]))
  const venuesByName = new Map<string, TourVenue[]>()
  for (const venue of existing.venues) {
    const key = normalizeKey(venue.name)
    venuesByName.set(key, [...(venuesByName.get(key) ?? []), venue])
  }
  const eventsByKey = new Map(
    existing.events.map((event) => [`${event.band_id}|${event.date}`, event])
  )

  const rows: TourImportPreviewRow[] = []
  const venues: NewVenueDraft[] = []
  const newVenueByKey = new Map<string, NewVenueDraft>()
  const create: TourEventDraft[] = []
  const update: TourImportPlan['update'] = []
  const seen = new Map<string, number>()
  let unchanged = 0

  // ---- promoters and their contacts (LoPro) ----
  const promoters: NewPromoterDraft[] = []
  const contacts: NewContactDraft[] = []
  const companiesByName = new Map(
    (existing.companies ?? []).map((company) => [normalizeKey(company.name), company])
  )
  const personsByEmail = new Map(
    (existing.persons ?? []).filter((p) => p.email).map((p) => [p.email.toLowerCase(), p])
  )
  const personsByName = new Map(
    (existing.persons ?? [])
      .filter((p) => p.lastName)
      .map((p) => [normalizeKey(`${p.firstName} ${p.lastName}`), p])
  )
  const newPromoterByKey = new Map<string, NewPromoterDraft>()
  const newContactByKey = new Map<string, NewContactDraft>()
  /** The promoter company of a row: an existing one by name, else created once per name */
  const promoterOf = (
    name: string,
    email: string,
    contactName: string
  ): { ref: TourLoPro['company']; isNew: boolean } => {
    if (!name) return { ref: null, isNew: false }
    const known = companiesByName.get(normalizeKey(name))
    if (known) return { ref: { id: known.id }, isNew: false }
    const key = normalizeKey(name)
    if (!newPromoterByKey.has(key)) {
      // Without a contact person the address belongs to the company
      const draft = { key, name, email: contactName ? '' : email }
      newPromoterByKey.set(key, draft)
      promoters.push(draft)
    }
    return { ref: { key }, isNew: true }
  }
  /** The contact of a row: an existing person by e-mail, else by full name, else created */
  const contactOf = (
    name: string,
    email: string,
    company: TourLoPro['company']
  ): TourLoPro['person'] => {
    if (!name) {
      const byEmail = email ? personsByEmail.get(email) : undefined
      return byEmail ? { id: byEmail.id } : null
    }
    const byEmail = email ? personsByEmail.get(email) : undefined
    if (byEmail) return { id: byEmail.id }
    const { firstName, lastName } = splitName(name)
    const byName = lastName
      ? personsByName.get(normalizeKey(`${firstName} ${lastName}`))
      : undefined
    if (byName) return { id: byName.id }
    const companyKey = company ? ('id' in company ? `c${company.id}` : company.key) : ''
    const key = email || `${normalizeKey(name)}|${companyKey}`
    if (!newContactByKey.has(key)) {
      const draft = { key, firstName, lastName, email, company }
      newContactByKey.set(key, draft)
      contacts.push(draft)
    }
    return { key }
  }

  const cell = (cells: string[], field: TourImportField) => {
    const index = columnsOf(field)[0]
    return index === undefined ? '' : cleanText(cells[index] ?? '')
  }

  /** An existing venue by name (and city when both know it); several of that name: the one in the city */
  const findVenue = (name: string, city: string): TourVenue | null => {
    const candidates = venuesByName.get(normalizeKey(name)) ?? []
    const cityKey = normalizeKey(city)
    const compatible = candidates.filter(
      (venue) => !cityKey || !venue.city || normalizeKey(venue.city) === cityKey
    )
    if (compatible.length === 1) return compatible[0]
    const inCity = compatible.filter((venue) => cityKey && normalizeKey(venue.city) === cityKey)
    return inCity.length === 1 ? inCity[0] : (compatible[0] ?? null)
  }

  if (errors.length === 0) {
    for (const row of request.rows) {
      const mappedCells = request.mapping.flatMap((field, index) =>
        field === 'ignore' ? [] : [cleanText(row.cells[index] ?? '')]
      )
      if (mappedCells.every((value) => value === '')) continue

      // A Band column wins; the band chosen for the sheet fills rows without one
      const bandName = cell(row.cells, 'band') || sheetBand
      const date = parseShowDate(cell(row.cells, 'date'))
      const venueName = cell(row.cells, 'venueName')
      let city = cell(row.cells, 'city')
      let zip = cell(row.cells, 'zipCode')
      const place = zip ? null : splitPlace(city)
      if (place) ({ zip, city } = place)
      const tour = cell(row.cells, 'tour') || request.tour.trim()
      const status = parseEventStatus(cell(row.cells, 'status'), request.defaultStatus)
      const base = {
        rowNumber: row.rowNumber,
        date,
        bandName,
        eventName: cell(row.cells, 'eventName'),
        venueName,
        city,
        tour,
        status,
        newVenue: false,
        promoterName: '',
        newPromoter: false
      }
      const skip = (reason: string) => rows.push({ ...base, action: 'skipped', reason })

      if (!bandName) {
        skip('Keine Band angegeben')
        continue
      }
      if (!date) {
        skip('Kein gültiges Datum')
        continue
      }
      const band = bandsByName.get(normalizeKey(bandName))
      if (!band) {
        skip('Band ist nicht angelegt')
        continue
      }
      const eventKey = `${band.id}|${date}`
      const firstRow = seen.get(eventKey)
      if (firstRow !== undefined) {
        skip(`Doppelt in der Datei (wie Zeile ${firstRow})`)
        continue
      }
      seen.set(eventKey, row.rowNumber)

      // ---- venue ----
      let venue: TourEventDraft['venue'] = null
      let newVenue = false
      if (venueName) {
        const known = findVenue(venueName, city)
        if (known) venue = { id: known.id }
        else if (request.createVenues) {
          const key = `${normalizeKey(venueName)}|${normalizeKey(city)}`
          if (!newVenueByKey.has(key)) {
            const countryCell = cell(row.cells, 'country')
            const country = findCountry(countryCell)
            const countryCode = country?.code ?? ''
            const draft: NewVenueDraft = {
              key,
              name: venueName,
              kind: parseBookingKind(cell(row.cells, 'kind'), request.defaultKind),
              street: cell(row.cells, 'street'),
              zip_code: normalizeZip(zip, countryCode),
              city,
              country: countryCell,
              country_code: countryCode
            }
            newVenueByKey.set(key, draft)
            venues.push(draft)
          }
          venue = { key }
          newVenue = true
        }
      }

      // ---- the event's fields: only mapped columns with a value ----
      const fields: TourEventFields = {}
      const set = <K extends keyof TourEventFields>(
        key: K,
        value: TourEventFields[K] | null,
        field: TourImportField
      ) => {
        if (!has(field)) return
        if (value === null || value === '') return
        fields[key] = value
      }
      set('status', status, 'status')
      set('deal', cell(row.cells, 'deal'), 'deal')
      set('guarantee_cents', parseAmountCents(cell(row.cells, 'guarantee')), 'guarantee')
      set(
        'ticket_price_vvk_cents',
        parseAmountCents(cell(row.cells, 'ticketPriceVvk')),
        'ticketPriceVvk'
      )
      set(
        'ticket_price_ak_cents',
        parseAmountCents(cell(row.cells, 'ticketPriceAk')),
        'ticketPriceAk'
      )
      set('performance_time', parseShowTime(cell(row.cells, 'performanceTime')), 'performanceTime')
      set('radius_km', parseClauseNumber(cell(row.cells, 'radiusKm'), RADIUS_KM_MAX), 'radiusKm')
      set(
        'radius_weeks_before',
        parseClauseNumber(cell(row.cells, 'radiusWeeksBefore'), RADIUS_WEEKS_MAX),
        'radiusWeeksBefore'
      )
      set(
        'radius_weeks_after',
        parseClauseNumber(cell(row.cells, 'radiusWeeksAfter'), RADIUS_WEEKS_MAX),
        'radiusWeeksAfter'
      )
      if (tour) fields.tour = tour
      const notes = columnsOf('notes')
        .map((index) => {
          const value = cleanText(row.cells[index] ?? '')
          // "Spalte E: …" says nothing, so a headerless sheet's notes are the values alone
          const header = generated ? '' : cleanText(request.headers[index] ?? '')
          return value ? (header ? `${header}: ${value}` : value) : ''
        })
        .filter(Boolean)
      // a city without a venue has nowhere else to go
      if (!venue && !venueName && city)
        notes.unshift(`Ort: ${[zip, city].filter(Boolean).join(' ')}`)
      if (!venue && venueName) notes.unshift(`${venueName}${city ? `, ${city}` : ''}`)
      if (notes.length > 0) fields.notes = notes.join('\n')

      const stored = eventsByKey.get(eventKey)
      const eventName =
        cell(row.cells, 'eventName') ||
        stored?.name ||
        [band.name, venueName || city].filter(Boolean).join(' – ')
      if (cell(row.cells, 'eventName')) fields.name = eventName
      // ---- LoPro: promoter and contact ----
      const contactName = cell(row.cells, 'promoterContact')
      const promoterName = promoterNameOf(cell(row.cells, 'promoter'), contactName)
      const contactEmail = emailOf(cell(row.cells, 'promoterEmail'))
      const promoter = promoterOf(promoterName, contactEmail, contactName)
      const person = contactOf(contactName, contactEmail, promoter.ref)
      const lopro: TourLoPro | undefined =
        promoter.ref || person ? { company: promoter.ref, person } : undefined
      const preview = {
        ...base,
        bandName: band.name,
        eventName,
        newVenue,
        promoterName,
        newPromoter: promoter.isNew
      }

      if (!stored) {
        create.push({
          band_id: band.id,
          date,
          venue,
          fields: { ...fields, name: eventName, status: fields.status ?? request.defaultStatus },
          lopro
        })
        rows.push({ ...preview, action: 'new' })
        continue
      }
      // only a venue the row names replaces the stored one
      const venueChanges = venue !== null && !('id' in venue && venue.id === stored.venue_id)
      const fieldChanges = (Object.keys(fields) as Array<keyof TourEventFields>).filter(
        (key) => !sameValue(stored[key], fields[key])
      )
      const loproChanges =
        lopro !== undefined &&
        ((lopro.company !== null &&
          !('id' in lopro.company && lopro.company.id === stored.lopro_company_id)) ||
          (lopro.person !== null &&
            !('id' in lopro.person && lopro.person.id === stored.lopro_person_id)))
      if (!venueChanges && !loproChanges && fieldChanges.length === 0) {
        unchanged++
        rows.push({ ...preview, status: stored.status as DealMemoStatus, action: 'unchanged' })
        continue
      }
      update.push({
        id: stored.id,
        venue: venueChanges ? venue : null,
        fields: Object.fromEntries(
          fieldChanges.map((key) => [key, fields[key]])
        ) as TourEventFields,
        lopro: loproChanges ? lopro : undefined
      })
      rows.push({ ...preview, action: 'update' })
    }
  }

  return {
    preview: {
      rows,
      counts: {
        new: create.length,
        update: update.length,
        unchanged,
        skipped: rows.filter((row) => row.action === 'skipped').length,
        newVenues: venues.length,
        newPromoters: promoters.length,
        newContacts: contacts.length
      },
      errors
    },
    venues,
    create,
    update,
    promoters,
    contacts
  }
}
