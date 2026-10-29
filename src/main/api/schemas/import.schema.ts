import { z } from 'zod'
import { VenueKind } from './venue.schema'

// ========================================
// Spreadsheet import
// ========================================
// The renderer picks a CSV file (main reads it), chooses what the list holds
// (import target), adjusts the column mapping, previews the result and
// commits it. Existing records (same name) only get empty fields filled.

/** What one row of the list describes */
export const ImportTarget = z.enum(['venues', 'bands', 'companies', 'persons'])
export type ImportTarget = z.infer<typeof ImportTarget>

export const IMPORT_TARGET_LABELS: Record<ImportTarget, string> = {
  venues: 'Clubs / Festivals',
  bands: 'Bands',
  companies: 'Firmen',
  persons: 'Personen'
}

export const IMPORT_TARGET_DESCRIPTIONS: Record<ImportTarget, string> = {
  venues: 'Eine Zeile pro Club oder Festival, mit Veranstalter und Ansprechpartnern.',
  bands:
    'Eine Zeile pro Band, mit Mitgliedern. Die Firma der Band muss schon angelegt sein; Zeilen ohne Namen ergänzen Mitglieder der Band darüber.',
  companies: 'Eine Zeile pro Firma, mit Anschrift und Ansprechpartnern.',
  persons: 'Eine Zeile pro Person, mit Kontaktdaten, Anschrift und optional ihrer Firma.'
}

export const ImportField = z.enum([
  'ignore',
  'venueName',
  'venueCity',
  'region',
  'capacity',
  'bandName',
  'genre',
  'founded',
  'members',
  'responsiblePerson',
  'managementCompany',
  'companyName',
  'contactPerson',
  'personName',
  'firstName',
  'lastName',
  'role',
  'birthday',
  'email',
  'phone',
  'mobile',
  'street',
  'streetNumber',
  'zipCode',
  'city',
  'taxId',
  'homepage',
  'month',
  'notes'
])
export type ImportField = z.infer<typeof ImportField>

const FIELD_LABELS: Record<ImportField, string> = {
  ignore: 'Nicht importieren',
  venueName: 'Club / Festival',
  venueCity: 'Ort des Clubs / Festivals',
  region: 'Land / Bundesland',
  capacity: 'Kapazität / Zuschauer',
  bandName: 'Band',
  genre: 'Genre',
  founded: 'Gründung',
  members: 'Mitglieder',
  responsiblePerson: 'Technischer Leiter',
  managementCompany: 'Management (Firma)',
  companyName: 'Firma',
  contactPerson: 'Ansprechpartner',
  personName: 'Name (Vor- und Nachname)',
  firstName: 'Vorname',
  lastName: 'Nachname',
  role: 'Rolle in der Firma',
  birthday: 'Geburtstag',
  email: 'E-Mail',
  phone: 'Telefon',
  mobile: 'Mobil',
  street: 'Straße',
  streetNumber: 'Hausnummer',
  zipCode: 'PLZ',
  city: 'Ort (Anschrift)',
  taxId: 'USt-IdNr. / Steuernummer',
  homepage: 'Website',
  month: 'Monat (Abschnitt)',
  notes: 'Anmerkung'
}

// Labels that read differently for a target
const TARGET_FIELD_LABELS: Partial<Record<ImportTarget, Partial<Record<ImportField, string>>>> = {
  venues: { companyName: 'Veranstalter (Firma)' },
  bands: {
    companyName: 'Firma der Band (muss existieren)',
    email: 'E-Mail (Technischer Leiter)',
    phone: 'Telefon (Technischer Leiter)',
    mobile: 'Mobil (Technischer Leiter)'
  }
}

export function importFieldLabel(field: ImportField, target: ImportTarget): string {
  return TARGET_FIELD_LABELS[target]?.[field] ?? FIELD_LABELS[field]
}

const ADDRESS_FIELDS: ImportField[] = ['street', 'streetNumber', 'zipCode', 'city', 'region']
const CONTACT_FIELDS: ImportField[] = ['email', 'phone', 'mobile']

/** Fields offered per target, in menu order */
export const IMPORT_TARGET_FIELDS: Record<ImportTarget, readonly ImportField[]> = {
  venues: [
    'ignore',
    'venueName',
    'venueCity',
    'capacity',
    'companyName',
    'contactPerson',
    ...CONTACT_FIELDS,
    ...ADDRESS_FIELDS,
    'taxId',
    'homepage',
    'month',
    'notes'
  ],
  bands: [
    'ignore',
    'bandName',
    'genre',
    'founded',
    'companyName',
    'managementCompany',
    'members',
    'responsiblePerson',
    ...CONTACT_FIELDS,
    'notes'
  ],
  companies: [
    'ignore',
    'companyName',
    'contactPerson',
    ...CONTACT_FIELDS,
    ...ADDRESS_FIELDS,
    'taxId',
    'homepage',
    'notes'
  ],
  persons: [
    'ignore',
    'personName',
    'firstName',
    'lastName',
    'birthday',
    'companyName',
    'role',
    ...CONTACT_FIELDS,
    ...ADDRESS_FIELDS,
    'homepage',
    'notes'
  ]
}

/** Fields several columns may map to; every other field takes one column */
export const MULTI_COLUMN_FIELDS: readonly ImportField[] = [
  'ignore',
  'contactPerson',
  'members',
  'notes'
]

/** Default countries offered for rows without a Land column */
export const IMPORT_COUNTRY_OPTIONS = [
  { code: 'DE', name: 'Germany', label: 'Deutschland' },
  { code: 'AT', name: 'Austria', label: 'Österreich' },
  { code: 'CH', name: 'Switzerland', label: 'Schweiz' },
  { code: 'GB', name: 'United Kingdom', label: 'Vereinigtes Königreich' },
  { code: 'NL', name: 'Netherlands', label: 'Niederlande' }
] as const

export const ImportRow = z.object({
  // 1-based row number in the sheet, for messages and exclusions
  rowNumber: z.number(),
  cells: z.array(z.string())
})
export type ImportRow = z.infer<typeof ImportRow>

const TargetMappings = z.object({
  venues: z.array(ImportField),
  bands: z.array(ImportField),
  companies: z.array(ImportField),
  persons: z.array(ImportField)
})

/** The rows of one CSV file; `name` is the file name without extension */
export const ImportTable = z.object({
  name: z.string(),
  headers: z.array(z.string()),
  rows: z.array(ImportRow),
  suggestedTarget: ImportTarget,
  // Mapping per target, detected from the headers (or remembered)
  suggestedMappings: TargetMappings,
  // The suggested target's mapping is one the user saved for these columns
  mappingRemembered: z.boolean(),
  suggestedKind: VenueKind,
  // ISO code, '' for none
  suggestedCountry: z.string()
})
export type ImportTable = z.infer<typeof ImportTable>

export const ImportFile = z.object({
  fileName: z.string(),
  // null: no header row with data rows below it
  table: ImportTable.nullable()
})
export type ImportFile = z.infer<typeof ImportFile>

export const ImportOptions = z.object({
  // Venues only: Club or Festival
  kind: VenueKind,
  // ISO code used when a row names no country, '' for none
  defaultCountry: z.string()
})
export type ImportOptions = z.infer<typeof ImportOptions>

export const ImportRequest = z.object({
  target: ImportTarget,
  headers: z.array(z.string()),
  rows: z.array(ImportRow),
  mapping: z.array(ImportField),
  options: ImportOptions,
  // Row numbers the user unticked in the preview
  excludedRows: z.array(z.number()).default([])
})
export type ImportRequest = z.infer<typeof ImportRequest>

// new: created by this import; existing: already in the app (only empty
// fields get filled); repeat: same record as an earlier row of the sheet
export const ImportEntityAction = z.enum(['new', 'existing', 'repeat'])
export type ImportEntityAction = z.infer<typeof ImportEntityAction>

export const ImportEntityRef = z.object({
  label: z.string(),
  action: ImportEntityAction
})
export type ImportEntityRef = z.infer<typeof ImportEntityRef>

export const ImportPreviewRow = z.object({
  rowNumber: z.number(),
  // record: imported; continuation: extra contacts/members for the row
  // above; excluded: unticked by the user; skipped: cannot be imported
  // (see warnings, e.g. no name or the band's company does not exist)
  status: z.enum(['record', 'continuation', 'excluded', 'skipped']),
  // The row's main record: venue, band, company or person (by target)
  primary: ImportEntityRef.nullable(),
  // Promoter, band company, or the person's company
  company: ImportEntityRef.nullable(),
  // Contacts, members, technical lead
  persons: z.array(ImportEntityRef),
  warnings: z.array(z.string())
})
export type ImportPreviewRow = z.infer<typeof ImportPreviewRow>

const ImportCount = z.object({ new: z.number(), existing: z.number() })
export type ImportCount = z.infer<typeof ImportCount>

export const ImportPreview = z.object({
  rows: z.array(ImportPreviewRow),
  summary: z.object({
    venues: ImportCount,
    bands: ImportCount,
    companies: ImportCount,
    persons: ImportCount
  }),
  // Problems that block the import (e.g. no name column mapped)
  errors: z.array(z.string())
})
export type ImportPreview = z.infer<typeof ImportPreview>

const ImportOutcome = z.object({ created: z.number(), updated: z.number() })

export const ImportResult = z.object({
  venues: ImportOutcome,
  bands: ImportOutcome,
  companies: ImportOutcome,
  persons: ImportOutcome
})
export type ImportResult = z.infer<typeof ImportResult>
