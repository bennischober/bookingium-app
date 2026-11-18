import { z } from 'zod'
import { TERMS } from '../terms'
import { ImportRow } from './import.schema'
import { DealMemoStatus } from './deal_memo.schema'
import { VenueKind } from './venue.schema'

// ========================================
// Tour import (Tourdaten): own events from a tour sheet
// ========================================
// The file is read like every list import (CSV or .xlsx via import:pickFile). One row is one
// show of a band: it becomes an event (deal memo), found again by band and date, so importing
// the next version of the sheet updates instead of duplicating. A club or festival the app does
// not know yet is created from the row's name and address. src/main/import/tourDates.ts plans.

export const TourImportField = z.enum([
  'ignore',
  'band',
  'date',
  'eventName',
  'venueName',
  'street',
  'zipCode',
  'city',
  'country',
  'kind',
  'status',
  'tour',
  'deal',
  'guarantee',
  'ticketPriceVvk',
  'ticketPriceAk',
  'performanceTime',
  'radiusKm',
  'radiusWeeksBefore',
  'radiusWeeksAfter',
  'notes'
])
export type TourImportField = z.infer<typeof TourImportField>

export const TOUR_IMPORT_FIELD_LABELS: Record<TourImportField, string> = {
  ignore: 'Nicht importieren',
  band: TERMS.band.singular,
  date: 'Datum',
  eventName: `Name ${TERMS.event.des}`,
  venueName: `${TERMS.club.singular} / ${TERMS.festival.singular}`,
  street: 'Straße',
  zipCode: 'PLZ',
  city: 'Ort',
  country: 'Land',
  kind: `Art (${TERMS.club.singular} / ${TERMS.festival.singular})`,
  status: 'Status',
  tour: 'Tour',
  deal: 'Deal',
  guarantee: 'Garantie / Gage',
  ticketPriceVvk: 'Ticketpreis VVK',
  ticketPriceAk: 'Ticketpreis AK',
  performanceTime: 'Showtime',
  radiusKm: 'Gebietsschutz: km',
  radiusWeeksBefore: 'Gebietsschutz: Wochen davor',
  radiusWeeksAfter: 'Gebietsschutz: Wochen danach',
  notes: 'Anmerkung'
}

/** Fields a column can map to, in menu order */
export const TOUR_IMPORT_FIELDS = TourImportField.options

export const TourImportRequest = z.object({
  fileName: z.string(),
  headers: z.array(z.string()),
  rows: z.array(ImportRow),
  mapping: z.array(TourImportField),
  /** The band of rows without a Band column value (a sheet of one band), '' for none */
  band: z.string().trim().max(200).default(''),
  /** The tour of rows without a Tour column value, '' for none */
  tour: z.string().trim().max(200),
  /** Art of a new club or festival whose row says nothing about it */
  defaultKind: VenueKind,
  /** Status of rows without a Status column value */
  defaultStatus: DealMemoStatus,
  /** Create the clubs and festivals the app does not know yet (else the event has no venue) */
  createVenues: z.boolean()
})
export type TourImportRequest = z.infer<typeof TourImportRequest>

export const TourImportAction = z.enum(['new', 'update', 'unchanged', 'skipped'])
export type TourImportAction = z.infer<typeof TourImportAction>

export const TourImportPreviewRow = z.object({
  rowNumber: z.number(),
  action: TourImportAction,
  date: z.string(),
  bandName: z.string(),
  eventName: z.string(),
  venueName: z.string(),
  city: z.string(),
  tour: z.string(),
  status: DealMemoStatus,
  /** The club or festival is created by this import */
  newVenue: z.boolean(),
  /** Why a row is skipped */
  reason: z.string().optional()
})
export type TourImportPreviewRow = z.infer<typeof TourImportPreviewRow>

export const TourImportCounts = z.object({
  new: z.number(),
  update: z.number(),
  unchanged: z.number(),
  skipped: z.number(),
  newVenues: z.number()
})
export type TourImportCounts = z.infer<typeof TourImportCounts>

export const TourImportPreview = z.object({
  rows: z.array(TourImportPreviewRow),
  counts: TourImportCounts,
  /** Blocking problems (a required column missing); nothing can be imported */
  errors: z.array(z.string())
})
export type TourImportPreview = z.infer<typeof TourImportPreview>

export const TourImportResult = z.object({
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  skipped: z.number(),
  venuesCreated: z.number()
})
export type TourImportResult = z.infer<typeof TourImportResult>

/** The columns and defaults for a picked file: remembered for the same layout, else detected */
export const TourImportSuggestion = z.object({
  mapping: z.array(TourImportField),
  /** The band for all rows, from the title row; '' for none */
  band: z.string(),
  tour: z.string(),
  defaultKind: VenueKind,
  defaultStatus: DealMemoStatus,
  remembered: z.boolean()
})
export type TourImportSuggestion = z.infer<typeof TourImportSuggestion>
