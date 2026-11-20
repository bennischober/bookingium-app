import { z } from 'zod'
import { TERMS } from '../terms'
import { ImportRow } from './import.schema'
import { DealMemoStatus } from './deal_memo.schema'
import { VenueKind } from './venue.schema'
import { t } from '../../i18n/translate'

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
  // #228 follow-up: the local promoter (LoPro) and their contact, linked to the event
  'promoter',
  'promoterContact',
  'promoterEmail',
  // #232: advancing and tickets of the show
  'localContact',
  'localContactEmail',
  'advancingStatus',
  'ticketQuota',
  'ticketSold',
  'notes'
])
export type TourImportField = z.infer<typeof TourImportField>

export const TOUR_IMPORT_FIELD_LABELS: Record<TourImportField, string> = {
  ignore: t('Nicht importieren'),
  band: TERMS.band.singular,
  date: t('Datum'),
  eventName: `Name ${TERMS.event.des}`,
  venueName: `${TERMS.club.singular} / ${TERMS.festival.singular}`,
  street: t('Straße'),
  zipCode: t('PLZ'),
  city: t('Ort'),
  country: t('Land'),
  kind: `Art (${TERMS.club.singular} / ${TERMS.festival.singular})`,
  status: t('Status'),
  tour: t('Tour'),
  deal: t('Deal'),
  guarantee: t('Garantie / Gage'),
  ticketPriceVvk: t('Ticketpreis VVK'),
  ticketPriceAk: t('Ticketpreis AK'),
  performanceTime: t('Showtime'),
  radiusKm: t('Gebietsschutz: km'),
  radiusWeeksBefore: t('Gebietsschutz: Wochen davor'),
  radiusWeeksAfter: t('Gebietsschutz: Wochen danach'),
  promoter: t('Veranstalter (LoPro)'),
  promoterContact: t('Ansprechpartner'),
  promoterEmail: t('E-Mail Ansprechpartner'),
  localContact: t('Kontakt vor Ort'),
  localContactEmail: t('E-Mail Kontakt vor Ort'),
  advancingStatus: t('Advancing-Stand'),
  ticketQuota: t('Ticketkontingent'),
  ticketSold: t('Tickets verkauft'),
  notes: t('Anmerkung')
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
  /** The local promoter (LoPro) the event is linked to, '' for none */
  promoterName: z.string().default(''),
  /** The promoter is created by this import */
  newPromoter: z.boolean().default(false),
  /** Why a row is skipped */
  reason: z.string().optional(),
  /** #232: what the row sets besides the event ("Angeschrieben · Kontingent 200"), '' for none */
  details: z.string().default('')
})
export type TourImportPreviewRow = z.infer<typeof TourImportPreviewRow>

export const TourImportCounts = z.object({
  new: z.number(),
  update: z.number(),
  unchanged: z.number(),
  skipped: z.number(),
  newVenues: z.number(),
  newPromoters: z.number().default(0),
  newContacts: z.number().default(0)
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
  venuesCreated: z.number(),
  promotersCreated: z.number().default(0),
  contactsCreated: z.number().default(0)
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

// ========================================
// Editing a tour: its name and which events belong to it
// ========================================
// A tour is no record of its own, only the name events share (deal_memo.tour). Editing one
// renames that name everywhere (events, archived ones included, and marketing measures) and sets
// which active events carry it.

/** An active event that can be put into a tour, for the tour dialog */
export const TourCandidateDto = z.object({
  id: z.number(),
  date: z.string(),
  name: z.string(),
  bandId: z.number(),
  bandName: z.string(),
  venueName: z.string(),
  city: z.string(),
  status: z.string(),
  /** the tour it is in now, '' for none */
  tour: z.string()
})
export type TourCandidateDto = z.infer<typeof TourCandidateDto>

export const SaveTourInput = z.object({
  /** the tour's name before, '' when a new tour is made */
  previous: z.string().default(''),
  name: z.string().trim().min(1, 'Name der Tour fehlt').max(200),
  /** the active events in the tour afterwards; active events not listed leave it */
  eventIds: z.array(z.number().int()).default([])
})
export type SaveTourInput = z.infer<typeof SaveTourInput>

export const SaveTourResult = z.object({
  name: z.string(),
  added: z.number(),
  removed: z.number(),
  renamed: z.number()
})
export type SaveTourResult = z.infer<typeof SaveTourResult>
