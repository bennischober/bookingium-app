import { z } from 'zod'
import { VenueKind } from './venue.schema'

// ========================================
// Spreadsheet import (venues, promoters and their contacts)
// ========================================
// The renderer picks a workbook (main reads it), adjusts the column mapping,
// previews the result and commits it. Each row describes a venue or festival,
// the promoter company behind it and its contact persons.

export const ImportField = z.enum([
  'ignore',
  'venueName',
  'venueCity',
  'region',
  'capacity',
  'companyName',
  'contactPerson',
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

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  ignore: 'Nicht importieren',
  venueName: 'Spielstätte / Festival',
  venueCity: 'Ort der Spielstätte',
  region: 'Land / Bundesland',
  capacity: 'Kapazität / Zuschauer',
  companyName: 'Veranstalter (Firma)',
  contactPerson: 'Ansprechpartner',
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

/** Fields several columns may map to; every other field takes one column */
export const MULTI_COLUMN_FIELDS: readonly ImportField[] = ['ignore', 'contactPerson', 'notes']

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

export const ImportSheet = z.object({
  name: z.string(),
  headers: z.array(z.string()),
  rows: z.array(ImportRow),
  suggestedMapping: z.array(ImportField),
  suggestedKind: VenueKind,
  // ISO code, '' for none
  suggestedCountry: z.string()
})
export type ImportSheet = z.infer<typeof ImportSheet>

export const ImportWorkbook = z.object({
  fileName: z.string(),
  sheets: z.array(ImportSheet)
})
export type ImportWorkbook = z.infer<typeof ImportWorkbook>

export const ImportOptions = z.object({
  kind: VenueKind,
  // ISO code used when a row names no country, '' for none
  defaultCountry: z.string()
})
export type ImportOptions = z.infer<typeof ImportOptions>

export const ImportRequest = z.object({
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
  // record: a venue and/or company; continuation: extra contacts for the
  // row above; excluded: unticked by the user; orphan: contacts without a
  // row to attach to
  status: z.enum(['record', 'continuation', 'excluded', 'orphan']),
  venue: ImportEntityRef.nullable(),
  company: ImportEntityRef.nullable(),
  persons: z.array(ImportEntityRef),
  warnings: z.array(z.string())
})
export type ImportPreviewRow = z.infer<typeof ImportPreviewRow>

const ImportCount = z.object({ new: z.number(), existing: z.number() })

export const ImportPreview = z.object({
  rows: z.array(ImportPreviewRow),
  summary: z.object({
    venues: ImportCount,
    companies: ImportCount,
    persons: ImportCount
  }),
  // Problems that block the import (e.g. no name column mapped)
  errors: z.array(z.string())
})
export type ImportPreview = z.infer<typeof ImportPreview>

export const ImportResult = z.object({
  venuesCreated: z.number(),
  venuesUpdated: z.number(),
  companiesCreated: z.number(),
  companiesUpdated: z.number(),
  personsCreated: z.number(),
  personsUpdated: z.number()
})
export type ImportResult = z.infer<typeof ImportResult>
