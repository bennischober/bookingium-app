import {
  IMPORT_TARGET_FIELDS,
  MULTI_COLUMN_FIELDS,
  type ImportField,
  type ImportRow,
  type ImportTarget
} from '../api/schemas/import.schema'
import type { VenueKind } from '../api/schemas/venue.schema'
import { findCountry, isGermanStateCode, normalizeKey } from './normalize'

// Header spellings (compared without case, spaces and punctuation)
const HEADER_SYNONYMS: Array<[ImportField, string[]]> = [
  ['venueName', ['venue', 'spielstätte', 'spielstaette', 'club', 'festival', 'halle']],
  ['venueCity', ['city', 'w', 'wo']],
  ['region', ['land', 'bundesland', 'country', 'state', 'staat', 'region']],
  ['capacity', ['cc', 'cap', 'kapazität', 'kapazitaet', 'capacity', 'zuschauer', 'besucher']],
  ['bandName', ['band', 'bands', 'bandname', 'künstler', 'kuenstler', 'artist', 'act']],
  ['founded', ['gründung', 'gruendung', 'gegründet', 'gegruendet', 'gründungsjahr', 'founded']],
  ['members', ['mitglieder', 'members', 'besetzung', 'lineup', 'musiker']],
  ['responsiblePerson', ['tl', 'technischerleiter', 'technischeleitung']],
  ['managementCompany', ['management', 'managementfirma']],
  [
    'companyName',
    [
      'localpromoter',
      'promoter',
      'veranstalter',
      'firma',
      'firmenname',
      'company',
      'organizer',
      'organiser'
    ]
  ],
  ['contactPerson', ['ap', 'ansprechpartner', 'kontakt', 'contact', 'kontaktperson']],
  ['personName', ['vollständigername', 'fullname', 'person']],
  ['firstName', ['vorname', 'firstname', 'givenname']],
  ['lastName', ['nachname', 'lastname', 'surname', 'familienname']],
  ['role', ['rolle', 'funktion', 'position', 'role']],
  ['birthday', ['geburtstag', 'geburtsdatum', 'birthday', 'dateofbirth']],
  ['email', ['email', 'mail', 'emailadresse']],
  ['phone', ['telefon', 'tel', 'phone', 'telephone', 'festnetz']],
  ['mobile', ['mobil', 'mobile', 'handy', 'mobiltelefon']],
  ['street', ['str', 'straße', 'strasse', 'street']],
  ['streetNumber', ['nr', 'hausnr', 'hausnummer', 'hnr', 'no', 'number']],
  ['zipCode', ['plz', 'zip', 'postleitzahl', 'postcode', 'zipcode']],
  ['city', ['stadt', 'ort']],
  ['taxId', ['ust', 'ustid', 'ustidnr', 'vat', 'vatid', 'steuernummer', 'stnr', 'taxid']],
  ['homepage', ['url', 'web', 'website', 'webseite', 'homepage', 'internet', 'www']],
  ['month', ['monat', 'month']],
  [
    'notes',
    [
      'deal',
      'verantwortlich',
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

// Headers that mean something else depending on what the list holds
const TARGET_SYNONYMS: Record<ImportTarget, Record<string, ImportField>> = {
  venues: { name: 'venueName', genre: 'notes' },
  bands: { name: 'bandName', genre: 'genre', stil: 'genre', style: 'genre' },
  companies: { name: 'companyName' },
  persons: {
    name: 'personName',
    kontakt: 'personName',
    ansprechpartner: 'personName',
    ap: 'personName',
    contact: 'personName'
  }
}

const SYNONYM_LOOKUP = new Map<string, ImportField>(
  HEADER_SYNONYMS.flatMap(([field, names]) => names.map((name) => [name, field]))
)

// Outlook's contact export has an address and phones per kind: "Straße
// geschäftlich", "Ort privat", "Telefon (privat)", "Weitere Postleitzahl",
// "Weiteres/e Land/Region". Numbered columns ("Straße geschäftlich 2", the
// second address line) stay unmapped.
const QUALIFIED_SUFFIX = /^(.+?)(geschäftlich|privat)$/
const OTHER_PREFIXES = ['weiteresr', 'weiterese', 'weiterer', 'weiteres', 'weitere']
const QUALIFIED_SYNONYMS: Record<string, ImportField> = {
  landregion: 'region',
  bundeslandkanton: 'region'
}
const ADDRESS_FIELDS: ImportField[] = ['street', 'streetNumber', 'zipCode', 'city', 'region']

function qualifiedField(key: string): { field: ImportField; kind: string } | null {
  const base = (name: string) => QUALIFIED_SYNONYMS[name] ?? SYNONYM_LOOKUP.get(name)
  const match = QUALIFIED_SUFFIX.exec(key)
  if (match) {
    const field = base(match[1])
    return field ? { field, kind: match[2] } : null
  }
  for (const prefix of OTHER_PREFIXES) {
    const field = key.startsWith(prefix) ? base(key.slice(prefix.length)) : undefined
    if (field) return { field, kind: 'weitere' }
  }
  return null
}

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
 * Suggested field per column from its header, for one target. Each
 * single-value field is used once (first column wins); fields the target
 * has no place for become notes ("Club: …" in a company list); headerless
 * columns that hold data become notes. Venue lists: "Location" is the
 * venue's place unless a City column exists, and an unnamed text column
 * right before the venue city is the venue name. Outlook contact exports:
 * see qualifiedField.
 */
export function detectMapping(
  headers: string[],
  rows: ImportRow[],
  target: ImportTarget = 'venues'
): ImportField[] {
  const allowed = IMPORT_TARGET_FIELDS[target]
  const mapping: ImportField[] = headers.map(() => 'ignore')
  const used = new Set<ImportField>()
  const keys = headers.map(headerKey)

  const assign = (column: number, field: ImportField): void => {
    if (!MULTI_COLUMN_FIELDS.includes(field)) {
      if (used.has(field)) return
      used.add(field)
    }
    mapping[column] = field
  }

  // Person lists with a Vorname column: "Name" is the surname
  const targetSynonyms =
    target === 'persons' && keys.some((key) => SYNONYM_LOOKUP.get(key) === 'firstName')
      ? { ...TARGET_SYNONYMS.persons, name: 'lastName' as const }
      : TARGET_SYNONYMS[target]

  // Qualified columns first (Outlook's plain "Ort" is a meeting place): the
  // address of the kind with the most data, then per field the fullest
  // column ("Telefon (privat)" when the business one is empty)
  const qualified = keys.flatMap((key, column) => {
    if (targetSynonyms[key] ?? SYNONYM_LOOKUP.get(key)) return []
    const entry = qualifiedField(key)
    if (!entry || !allowed.includes(entry.field)) return []
    return [{ column, ...entry, filled: columnValues(rows, column).length }]
  })
  const addressData = new Map<string, number>()
  for (const entry of qualified) {
    if (!ADDRESS_FIELDS.includes(entry.field)) continue
    addressData.set(entry.kind, (addressData.get(entry.kind) ?? 0) + entry.filled)
  }
  const addressKind = [...addressData].reduce<[string, number] | null>(
    (best, entry) => (best === null || entry[1] > best[1] ? entry : best),
    null
  )?.[0]
  qualified
    .filter((entry) => !ADDRESS_FIELDS.includes(entry.field) || entry.kind === addressKind)
    .sort((a, b) => b.filled - a.filled)
    .forEach((entry) => assign(entry.column, entry.field))

  keys.forEach((key, column) => {
    const field = targetSynonyms[key] ?? SYNONYM_LOOKUP.get(key)
    if (!field) return
    assign(column, allowed.includes(field) ? field : 'notes')
  })

  if (target === 'venues') {
    // "Location": the venue's place when there is no City column, else a note
    keys.forEach((key, column) => {
      if (key !== 'location' || mapping[column] !== 'ignore') return
      assign(column, used.has('venueCity') ? 'notes' : 'venueCity')
    })

    // Venue name in a column with a meaningless header ("B" in front of "w")
    if (!used.has('venueName')) {
      const candidate = mapping.indexOf('venueCity') - 1
      if (candidate >= 0 && mapping[candidate] === 'ignore') {
        const values = columnValues(rows, candidate)
        if (values.length > 0 && values.every((value) => !/^\d+$/.test(value))) {
          assign(candidate, 'venueName')
        }
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

/** Mapping suggestions for every target, so the dialog can switch freely */
export function detectMappings(
  headers: string[],
  rows: ImportRow[]
): Record<ImportTarget, ImportField[]> {
  return {
    venues: detectMapping(headers, rows, 'venues'),
    bands: detectMapping(headers, rows, 'bands'),
    companies: detectMapping(headers, rows, 'companies'),
    persons: detectMapping(headers, rows, 'persons')
  }
}

/** What the list probably holds, from its headers (then its sheet name) */
export function suggestTarget(sheetName: string, headers: string[]): ImportTarget {
  const fields = new Set(headers.map((header) => SYNONYM_LOOKUP.get(headerKey(header))))
  const keys = new Set(headers.map(headerKey))
  if (fields.has('bandName')) return 'bands'
  // Venue lists: a venue, its place or its capacity
  if (
    fields.has('venueName') ||
    fields.has('venueCity') ||
    fields.has('capacity') ||
    keys.has('location')
  ) {
    return 'venues'
  }
  if (fields.has('firstName') || fields.has('lastName')) return 'persons'
  if (/band|künstler|artist/i.test(sheetName)) return 'bands'
  if (/person|kontakt|contact/i.test(sheetName)) return 'persons'
  if (fields.has('companyName') || /firm|compan/i.test(sheetName)) return 'companies'
  return 'venues'
}

export function suggestKind(sheetName: string, headers: string[]): VenueKind {
  const text = normalizeKey([sheetName, ...headers].join(' '))
  return /\bfestivals?\b/.test(text) ? 'festival' : 'venue'
}

/** The default country (Einstellungen) for domestic lists; none for "international" sheets */
export function suggestCountry(sheetName: string, defaultCountry = 'DE'): string {
  return /international|ausland|foreign/i.test(sheetName) ? '' : defaultCountry
}
