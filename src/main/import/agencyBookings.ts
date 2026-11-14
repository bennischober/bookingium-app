// Agency bookings import (#103): turns the rows of an agency's export into
// the bookings it adds, updates and leaves alone. Pure - no database, no
// Electron; the repository writes the plan in one transaction. Rows reach
// this module as the list import reads them (headers plus cells), so another
// source only has to produce the same shape.
//
// A booking is found again by its source key: the export's own ID when a
// column holds one, else band, date and place. Without an ID column a moved
// date therefore reads as a new booking, and the old one as missing.

import type {
  ExternalBookingField,
  ExternalBookingImportCounts,
  ExternalBookingImportPreview,
  ExternalBookingImportRequest,
  ExternalBookingKind,
  ExternalBookingMissing,
  ExternalBookingPreviewRow,
  ExternalBookingStatus
} from '../api/schemas/external_booking.schema'
import { cleanText, findCountry, normalizeKey, normalizeZip } from './normalize'

// Header spellings (compared with normalizeKey: lower case, punctuation as spaces)
const HEADER_SYNONYMS: Array<[ExternalBookingField, string[]]> = [
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
  [
    'sourceKey',
    [
      'id',
      'nr',
      'nummer',
      'buchungsnummer',
      'buchungsnr',
      'buchungs nr',
      'booking id',
      'bookingid',
      'show id',
      'showid',
      'event id',
      'eventid',
      'referenz',
      'ref',
      'key'
    ]
  ],
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

const FIELD_BY_HEADER = new Map<string, ExternalBookingField>(
  HEADER_SYNONYMS.flatMap(([field, names]) => names.map((name) => [normalizeKey(name), field]))
)

/**
 * The column mapping for an agency export's headers. Each field takes its
 * first column; notes may take several. Unknown headers are not imported.
 */
export function detectAgencyMapping(headers: string[]): ExternalBookingField[] {
  const taken = new Set<ExternalBookingField>()
  return headers.map((header) => {
    const field = FIELD_BY_HEADER.get(normalizeKey(header))
    if (!field || (field !== 'notes' && taken.has(field))) return 'ignore'
    taken.add(field)
    return field
  })
}

/**
 * A show date as YYYY-MM-DD, or '' when the cell holds none: "12.03.2027",
 * "12.3.27", "2027-03-12", "12/03/2027", optionally with a weekday before
 * ("Fr, 12.03.2027") or a time after it ("12.03.2027 20:00").
 */
export function parseShowDate(raw: string): string {
  const text = cleanText(raw)
  const iso = text.match(/(?:^|\s)(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[\sT])/)
  const german = text.match(/(?:^|[\s,])(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})(?:$|[\s,])/)
  let parts: [string, string, string] | null = null
  if (iso) parts = [iso[1], iso[2], iso[3]]
  else if (german) {
    const year = german[3].length === 2 ? `20${german[3]}` : german[3]
    parts = [year, german[2], german[1]]
  }
  if (!parts) return ''
  const [year, month, day] = parts
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return ''
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
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
  'unbestaetigt'
]

/**
 * The booking's status from the export's wording. Cancelled and option
 * spellings are recognised; anything else - "fix", "bestätigt", an empty
 * cell, an unknown word - counts as confirmed, so an unread status still
 * blocks the area rather than quietly freeing it.
 */
export function parseBookingStatus(raw: string): ExternalBookingStatus {
  const words = normalizeKey(raw).split(' ').filter(Boolean)
  if (words.some((word) => CANCELLED.includes(word))) return 'cancelled'
  // "1. Option", "Option bis 12.3." - but "unbestätigt" is a word of its own
  if (words.some((word) => PENDING.includes(word))) return 'pending'
  return 'confirmed'
}

/** Club or festival from an Art column; the dialog's default when the cell says neither */
export function parseBookingKind(raw: string, fallback: ExternalBookingKind): ExternalBookingKind {
  const key = normalizeKey(raw)
  if (!key) return fallback
  if (key.includes('festival') || key.includes('open air') || key.includes('openair')) {
    return 'festival'
  }
  if (/\b(club|halle|venue|konzert|show)\b/.test(key)) return 'venue'
  return fallback
}

/** The stored columns of a booking, as the repository writes them */
export type AgencyBookingFields = {
  band_id: number
  date: string
  kind: ExternalBookingKind
  status: ExternalBookingStatus
  venue_name: string
  street: string
  zip_code: string
  city: string
  country: string
  notes: string
  source_key: string
}

/** A stored booking of the agency being imported, as the repository loads it */
export type StoredAgencyBooking = Omit<AgencyBookingFields, 'kind' | 'status'> & {
  id: number
  band_name: string
  kind: string
  status: string
}

/** What the import compares against: the bands by name, the agency's stored bookings */
export type AgencyImportExisting = {
  bands: Array<{ id: number; name: string }>
  bookings: StoredAgencyBooking[]
}

export type AgencyImportPlan = {
  preview: ExternalBookingImportPreview
  create: AgencyBookingFields[]
  update: Array<{ id: number; fields: AgencyBookingFields }>
  /** Listed again without a change: only the import time and file move on */
  unchanged: number[]
  /** Missing from the file; empty unless the request removes them */
  remove: number[]
}

const COMPARED: Array<keyof AgencyBookingFields> = [
  'band_id',
  'date',
  'kind',
  'status',
  'venue_name',
  'street',
  'zip_code',
  'city',
  'country',
  'notes'
]

/** "10115 Berlin" in one Ort column: the postcode and the place */
function splitPlace(city: string): { zip: string; city: string } | null {
  const match = city.match(/^(\d{4,5})\s+(.+)$/)
  return match ? { zip: match[1], city: match[2] } : null
}

/**
 * The plan for one file: a booking per row with a known band and a date,
 * matched to the agency's stored ones by source key. Rows of unknown bands
 * are skipped, never invented - the band has to exist in the app first.
 * A key the file lists twice keeps its first row.
 */
export function buildAgencyImportPlan(
  request: ExternalBookingImportRequest,
  existing: AgencyImportExisting
): AgencyImportPlan {
  const errors: string[] = []
  const columnsOf = (field: ExternalBookingField) =>
    request.mapping.flatMap((mapped, index) => (mapped === field ? [index] : []))
  if (columnsOf('band').length === 0) errors.push('Keine Spalte ist der Band zugeordnet.')
  if (columnsOf('date').length === 0) errors.push('Keine Spalte ist dem Datum zugeordnet.')

  const bandsByName = new Map(existing.bands.map((band) => [normalizeKey(band.name), band]))
  const storedByKey = new Map(existing.bookings.map((booking) => [booking.source_key, booking]))

  const rows: ExternalBookingPreviewRow[] = []
  const create: AgencyBookingFields[] = []
  const update: AgencyImportPlan['update'] = []
  const unchanged: number[] = []
  const seenKeys = new Map<string, number>()

  const cell = (cells: string[], field: ExternalBookingField) => {
    const index = columnsOf(field)[0]
    return index === undefined ? '' : cleanText(cells[index] ?? '')
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
      const countryCell = cell(row.cells, 'country')
      const country = findCountry(countryCell)
      const countryCode = country?.code ?? ''
      let city = cell(row.cells, 'city')
      let zip = cell(row.cells, 'zipCode')
      const place = zip ? null : splitPlace(city)
      if (place) ({ zip, city } = place)
      const status = parseBookingStatus(cell(row.cells, 'status'))
      const base = { rowNumber: row.rowNumber, bandName, date, venueName, city, status }

      const ownKey = cell(row.cells, 'sourceKey')
      const sourceKey = ownKey
        ? `id:${ownKey}`
        : `auto:${normalizeKey(bandName)}|${date}|${normalizeKey(venueName || city)}`

      const skip = (reason: string) => {
        rows.push({ ...base, action: 'skipped', reason })
        // A skipped row still names a booking the file lists: it never counts as missing
        if (!seenKeys.has(sourceKey)) seenKeys.set(sourceKey, row.rowNumber)
      }

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
      const firstRow = seenKeys.get(sourceKey)
      if (firstRow !== undefined) {
        skip(`Doppelt in der Datei (wie Zeile ${firstRow})`)
        continue
      }
      seenKeys.set(sourceKey, row.rowNumber)

      const notes = columnsOf('notes')
        .map((index) => {
          const value = cleanText(row.cells[index] ?? '')
          const header = cleanText(request.headers[index] ?? '')
          return value ? (header ? `${header}: ${value}` : value) : ''
        })
        .filter(Boolean)
        .join('\n')

      const fields: AgencyBookingFields = {
        band_id: band.id,
        date,
        kind: parseBookingKind(cell(row.cells, 'kind'), request.defaultKind),
        status,
        venue_name: venueName,
        street: cell(row.cells, 'street'),
        zip_code: normalizeZip(zip, countryCode),
        city,
        country: countryCode || countryCell,
        notes,
        source_key: sourceKey
      }
      const preview = { ...base, bandName: band.name }

      const stored = storedByKey.get(sourceKey)
      if (!stored) {
        create.push(fields)
        rows.push({ ...preview, action: 'new' })
      } else if (COMPARED.every((key) => stored[key] === fields[key])) {
        unchanged.push(stored.id)
        rows.push({ ...preview, action: 'unchanged' })
      } else {
        update.push({ id: stored.id, fields })
        rows.push({ ...preview, action: 'update' })
      }
    }
  }

  const missing: ExternalBookingMissing[] =
    errors.length > 0
      ? []
      : existing.bookings
          .filter((booking) => !seenKeys.has(booking.source_key))
          .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
          .map((booking) => ({
            id: booking.id,
            bandName: booking.band_name,
            date: booking.date,
            venueName: booking.venue_name,
            city: booking.city
          }))

  const counts: ExternalBookingImportCounts = {
    new: create.length,
    update: update.length,
    unchanged: unchanged.length,
    skipped: rows.filter((row) => row.action === 'skipped').length,
    missing: missing.length
  }

  return {
    preview: { rows, missing, counts, errors },
    create,
    update,
    unchanged,
    remove: request.removeMissing ? missing.map((booking) => booking.id) : []
  }
}
