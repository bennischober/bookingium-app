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

// Header spellings (compared with normalizeKey: lower case, punctuation as spaces)
const HEADER_SYNONYMS: Array<[TourImportField, string[]]> = [
  ['band', ['band', 'bands', 'bandname', 'künstler', 'kuenstler', 'artist', 'act', 'interpret']],
  [
    'date',
    [
      'datum',
      'date',
      'showdatum',
      'showdate',
      'konzertdatum',
      'eventdatum',
      'termin',
      'spieltag',
      'tag',
      'day'
    ]
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
      'info',
      'veranstalter',
      'promoter'
    ]
  ]
]

const FIELD_BY_HEADER = new Map<string, TourImportField>(
  HEADER_SYNONYMS.flatMap(([field, names]) => names.map((name) => [normalizeKey(name), field]))
)

/** The column mapping for a tour sheet's headers. Each field takes its first column; notes several */
export function detectTourMapping(headers: string[]): TourImportField[] {
  const taken = new Set<TourImportField>()
  return headers.map((header) => {
    const field = FIELD_BY_HEADER.get(normalizeKey(header))
    if (!field || (field !== 'notes' && taken.has(field))) return 'ignore'
    taken.add(field)
    return field
  })
}

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
  const words = normalizeKey(raw).split(' ').filter(Boolean)
  if (words.some((word) => CANCELLED.includes(word))) return 'cancelled'
  if (words.some((word) => PENDING.includes(word))) return 'pending'
  if (words.some((word) => CONFIRMED.includes(word))) return 'confirmed'
  return fallback
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
}

export type TourImportExisting = {
  bands: Array<{ id: number; name: string }>
  venues: TourVenue[]
  events: TourEvent[]
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
}

export type TourImportPlan = {
  preview: TourImportPreview
  venues: NewVenueDraft[]
  create: TourEventDraft[]
  update: Array<{ id: number; venue: TourEventDraft['venue']; fields: TourEventFields }>
}

/** "10115 Berlin" in one Ort column: the postcode and the place */
function splitPlace(city: string): { zip: string; city: string } | null {
  const match = city.match(/^(\d{4,5})\s+(.+)$/)
  return match ? { zip: match[1], city: match[2] } : null
}

const sameValue = (a: unknown, b: unknown) => (a ?? null) === (b ?? null)

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
  if (!has('band')) errors.push('Keine Spalte ist der Band zugeordnet.')
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

      const bandName = cell(row.cells, 'band')
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
        newVenue: false
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
          const header = cleanText(request.headers[index] ?? '')
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
      const preview = { ...base, bandName: band.name, eventName, newVenue }

      if (!stored) {
        create.push({
          band_id: band.id,
          date,
          venue,
          fields: { ...fields, name: eventName, status: fields.status ?? request.defaultStatus }
        })
        rows.push({ ...preview, action: 'new' })
        continue
      }
      // only a venue the row names replaces the stored one
      const venueChanges = venue !== null && !('id' in venue && venue.id === stored.venue_id)
      const fieldChanges = (Object.keys(fields) as Array<keyof TourEventFields>).filter(
        (key) => !sameValue(stored[key], fields[key])
      )
      if (!venueChanges && fieldChanges.length === 0) {
        unchanged++
        rows.push({ ...preview, status: stored.status as DealMemoStatus, action: 'unchanged' })
        continue
      }
      update.push({
        id: stored.id,
        venue: venueChanges ? venue : null,
        fields: Object.fromEntries(fieldChanges.map((key) => [key, fields[key]])) as TourEventFields
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
        newVenues: venues.length
      },
      errors
    },
    venues,
    create,
    update
  }
}
