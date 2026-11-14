import { z } from 'zod'
import { createPaginatedResponse } from './base.schema'
import { ImportRow } from './import.schema'

// ========================================
// Agency bookings (Agenturbuchungen), #103
// ========================================
// Shows of the user's bands that another agency booked. Read-only: they come
// from the agency's export and change only through the next import of it,
// which finds each row again by its source key. Nothing here can be edited;
// a booking can only be removed (one, or all of an agency).

export const ExternalBookingKind = z.enum(['venue', 'festival'])
export type ExternalBookingKind = z.infer<typeof ExternalBookingKind>

/** confirmed blocks like a confirmed show, pending is a risk, cancelled is kept but blocks nothing */
export const ExternalBookingStatus = z.enum(['confirmed', 'pending', 'cancelled'])
export type ExternalBookingStatus = z.infer<typeof ExternalBookingStatus>

export const EXTERNAL_BOOKING_STATUS_LABELS: Record<ExternalBookingStatus, string> = {
  confirmed: 'Bestätigt',
  pending: 'Option',
  cancelled: 'Abgesagt'
}

export const EXTERNAL_BOOKING_KIND_LABELS: Record<ExternalBookingKind, string> = {
  venue: 'Club',
  festival: 'Festival'
}

export const ExternalBookingDto = z.object({
  id: z.number(),
  bandId: z.number(),
  bandName: z.string(),
  /** YYYY-MM-DD */
  date: z.string(),
  kind: ExternalBookingKind,
  status: ExternalBookingStatus,
  venueName: z.string(),
  street: z.string(),
  zipCode: z.string(),
  city: z.string(),
  /** ISO code when the import recognised the country, else as the file wrote it */
  country: z.string(),
  notes: z.string(),
  agency: z.string(),
  sourceFile: z.string(),
  importedAt: z.string()
})
export type ExternalBookingDto = z.infer<typeof ExternalBookingDto>

export const PaginatedExternalBookingResponse = createPaginatedResponse(ExternalBookingDto)

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum als JJJJ-MM-TT')

/** The calendar's visible days (inclusive) */
export const ExternalBookingRangeInput = z.object({ from: IsoDate, to: IsoDate })

/** One band's bookings in a date range: the event wizard's date check */
export const ExternalBookingBandRangeInput = z.object({
  bandId: z.number(),
  from: IsoDate,
  to: IsoDate
})

/** An agency with how many bookings it has in the app */
export const ExternalBookingAgencyDto = z.object({ agency: z.string(), count: z.number() })
export type ExternalBookingAgencyDto = z.infer<typeof ExternalBookingAgencyDto>

// ----------------------------------------
// Import
// ----------------------------------------
// The file is read like every list import (CSV via import:pickFile); the
// columns map to the fields below instead of the master-data fields. Another
// source (a PDF, a calendar) only has to deliver the same rows.

export const ExternalBookingField = z.enum([
  'ignore',
  'band',
  'date',
  'venueName',
  'street',
  'zipCode',
  'city',
  'country',
  'kind',
  'status',
  'sourceKey',
  'notes'
])
export type ExternalBookingField = z.infer<typeof ExternalBookingField>

export const EXTERNAL_BOOKING_FIELD_LABELS: Record<ExternalBookingField, string> = {
  ignore: 'Nicht importieren',
  band: 'Band',
  date: 'Datum',
  venueName: 'Club / Festival',
  street: 'Straße',
  zipCode: 'PLZ',
  city: 'Ort',
  country: 'Land',
  kind: 'Art (Club / Festival)',
  status: 'Status',
  sourceKey: 'Buchungs-Nr. / ID',
  notes: 'Anmerkung'
}

/** Fields a column can map to, in menu order */
export const EXTERNAL_BOOKING_FIELDS = ExternalBookingField.options

export const ExternalBookingImportRequest = z.object({
  fileName: z.string(),
  /** Who booked the shows; with the source key it finds a row again */
  agency: z.string().trim().min(1, 'Bitte die Agentur angeben.').max(200),
  headers: z.array(z.string()),
  rows: z.array(ImportRow),
  mapping: z.array(ExternalBookingField),
  /** Art of the rows whose file says nothing about it */
  defaultKind: ExternalBookingKind,
  /** Remove this agency's bookings that the file no longer lists */
  removeMissing: z.boolean()
})
export type ExternalBookingImportRequest = z.infer<typeof ExternalBookingImportRequest>

export const ExternalBookingImportAction = z.enum(['new', 'update', 'unchanged', 'skipped'])
export type ExternalBookingImportAction = z.infer<typeof ExternalBookingImportAction>

export const ExternalBookingPreviewRow = z.object({
  rowNumber: z.number(),
  action: ExternalBookingImportAction,
  bandName: z.string(),
  date: z.string(),
  venueName: z.string(),
  city: z.string(),
  status: ExternalBookingStatus,
  /** Why a row is skipped */
  reason: z.string().optional()
})
export type ExternalBookingPreviewRow = z.infer<typeof ExternalBookingPreviewRow>

/** A stored booking the file no longer lists (removed with removeMissing) */
export const ExternalBookingMissing = z.object({
  id: z.number(),
  bandName: z.string(),
  date: z.string(),
  venueName: z.string(),
  city: z.string()
})
export type ExternalBookingMissing = z.infer<typeof ExternalBookingMissing>

export const ExternalBookingImportCounts = z.object({
  new: z.number(),
  update: z.number(),
  unchanged: z.number(),
  skipped: z.number(),
  /** Listed in the store but not in the file; removed only with removeMissing */
  missing: z.number()
})
export type ExternalBookingImportCounts = z.infer<typeof ExternalBookingImportCounts>

export const ExternalBookingImportPreview = z.object({
  rows: z.array(ExternalBookingPreviewRow),
  missing: z.array(ExternalBookingMissing),
  counts: ExternalBookingImportCounts,
  /** Mapping problems that stop the import (no band or date column) */
  errors: z.array(z.string())
})
export type ExternalBookingImportPreview = z.infer<typeof ExternalBookingImportPreview>

export const ExternalBookingImportResult = z.object({
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  skipped: z.number(),
  removed: z.number()
})
export type ExternalBookingImportResult = z.infer<typeof ExternalBookingImportResult>

/** What the dialog gets for a picked file: detected (or remembered) columns and agency */
export const ExternalBookingImportSuggestion = z.object({
  mapping: z.array(ExternalBookingField),
  agency: z.string(),
  defaultKind: ExternalBookingKind,
  remembered: z.boolean()
})
export type ExternalBookingImportSuggestion = z.infer<typeof ExternalBookingImportSuggestion>
