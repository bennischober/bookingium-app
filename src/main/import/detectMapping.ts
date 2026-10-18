import { MULTI_COLUMN_FIELDS, type ImportField, type ImportRow } from '../api/schemas/import.schema'
import type { VenueKind } from '../api/schemas/venue.schema'
import { findCountry, isGermanStateCode, normalizeKey } from './normalize'

// Header spellings (compared without case, spaces and punctuation)
const HEADER_SYNONYMS: Array<[ImportField, string[]]> = [
  ['venueName', ['venue', 'spielstätte', 'spielstaette', 'club', 'festival', 'halle', 'name']],
  ['venueCity', ['city', 'w', 'wo']],
  ['region', ['land', 'bundesland', 'country', 'state', 'staat', 'region']],
  ['capacity', ['cc', 'cap', 'kapazität', 'kapazitaet', 'capacity', 'zuschauer', 'besucher']],
  [
    'companyName',
    ['localpromoter', 'promoter', 'veranstalter', 'firma', 'company', 'organizer', 'organiser']
  ],
  ['contactPerson', ['ap', 'ansprechpartner', 'kontakt', 'contact', 'kontaktperson']],
  ['email', ['email', 'mail', 'emailadresse']],
  ['phone', ['telefon', 'tel', 'phone', 'telephone', 'festnetz']],
  ['mobile', ['mobil', 'mobile', 'handy', 'mobiltelefon']],
  ['street', ['str', 'straße', 'strasse', 'street']],
  ['streetNumber', ['nr', 'hausnr', 'hausnummer', 'hnr', 'no', 'number']],
  ['zipCode', ['plz', 'zip', 'postleitzahl', 'postcode', 'zipcode']],
  ['city', ['stadt', 'ort']],
  ['taxId', ['ust', 'ustid', 'ustidnr', 'vat', 'vatid', 'steuernummer', 'stnr', 'taxid']],
  ['homepage', ['url', 'web', 'website', 'homepage', 'internet', 'www']],
  ['month', ['monat', 'month']],
  [
    'notes',
    [
      'deal',
      'verantwortlich',
      'genre',
      'termin',
      'zeitraum',
      'terminzeitraum',
      'datum',
      'kommentar',
      'comment',
      'notes',
      'notizen',
      'anmerkung',
      'anmerkungen',
      'bemerkung',
      'info'
    ]
  ]
]

const SYNONYM_LOOKUP = new Map<string, ImportField>(
  HEADER_SYNONYMS.flatMap(([field, names]) => names.map((name) => [name, field]))
)

function headerKey(header: string): string {
  return normalizeKey(header).replace(/\s+/g, '')
}

function columnValues(rows: ImportRow[], column: number): string[] {
  return rows.map((row) => row.cells[column]?.trim() ?? '').filter(Boolean)
}

/**
 * True when most values of a Land column are German state codes (SH, NRW,
 * BY …) rather than countries; "BE" then means Berlin, not Belgium
 */
export function isStateColumn(rows: ImportRow[], column: number): boolean {
  const values = columnValues(rows, column)
  if (values.length === 0) return false
  const states = values.filter((value) => isGermanStateCode(value) && !findCountry(value)).length
  const ambiguous = values.filter((value) => isGermanStateCode(value) && findCountry(value)).length
  return (states + ambiguous) / values.length >= 0.6 && states > 0
}

/**
 * Suggested field per column from its header. Each single-value field is
 * used once (first column wins); headerless columns that hold data become
 * notes; "Location" is the venue's place unless a City column exists; an
 * unnamed text column right before the venue city is the venue name.
 */
export function detectMapping(headers: string[], rows: ImportRow[]): ImportField[] {
  const mapping: ImportField[] = headers.map(() => 'ignore')
  const used = new Set<ImportField>()

  const assign = (column: number, field: ImportField): void => {
    if (!MULTI_COLUMN_FIELDS.includes(field)) {
      if (used.has(field)) return
      used.add(field)
    }
    mapping[column] = field
  }

  headers.forEach((header, column) => {
    const field = SYNONYM_LOOKUP.get(headerKey(header))
    if (field) assign(column, field)
  })

  // "Location": the venue's place when there is no City column, else a note
  headers.forEach((header, column) => {
    if (headerKey(header) !== 'location' || mapping[column] !== 'ignore') return
    assign(column, used.has('venueCity') ? 'notes' : 'venueCity')
  })

  // Venue name in a column with a meaningless header ("B" in front of "w")
  if (!used.has('venueName')) {
    const cityColumn = mapping.indexOf('venueCity')
    const candidate = cityColumn - 1
    if (candidate >= 0 && mapping[candidate] === 'ignore') {
      const values = columnValues(rows, candidate)
      if (values.length > 0 && values.every((value) => !/^\d+$/.test(value))) {
        assign(candidate, 'venueName')
      }
    }
  }

  // Unnamed columns with content are usually comments
  headers.forEach((header, column) => {
    if (mapping[column] !== 'ignore' || header.trim() !== '') return
    if (columnValues(rows, column).length > 0) mapping[column] = 'notes'
  })

  return mapping
}

export function suggestKind(sheetName: string, headers: string[]): VenueKind {
  const text = normalizeKey([sheetName, ...headers].join(' '))
  return /\bfestivals?\b/.test(text) ? 'festival' : 'venue'
}

/** Germany for domestic lists; none for "international" sheets */
export function suggestCountry(sheetName: string): string {
  return /international|ausland|foreign/i.test(sheetName) ? '' : 'DE'
}
