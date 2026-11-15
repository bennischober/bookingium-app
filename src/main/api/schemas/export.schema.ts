import { z } from 'zod'
import { TERMS } from '../terms'
import { VenueKind } from './venue.schema'
import { SortDirection } from './base.schema'

// ========================================
// CSV export of the lists
// ========================================

export const ExportList = z.enum([
  'bands',
  'persons',
  'companies',
  'venues',
  'hotels',
  'events',
  'invoices',
  'banks'
])
export type ExportList = z.infer<typeof ExportList>

/** Default file names */
export const EXPORT_LIST_LABELS: Record<ExportList, string> = {
  bands: TERMS.band.plural,
  persons: TERMS.person.plural,
  companies: TERMS.company.plural,
  venues: `${TERMS.club.plural} und ${TERMS.festival.plural}`,
  hotels: TERMS.hotel.plural,
  events: TERMS.event.plural,
  invoices: TERMS.invoice.plural,
  banks: TERMS.bank.plural
}

/** One list as the grid shows it: same search and filter, all pages */
export const ExportListInput = z.object({
  list: ExportList,
  search: z.string().optional(),
  // Clubs and festivals only
  kind: VenueKind.optional(),
  // The grid's sort order
  sortBy: z.string().optional(),
  sortDir: SortDirection.optional()
})
export type ExportListInput = z.infer<typeof ExportListInput>

export const ExportResultDto = z.object({
  canceled: z.boolean(),
  // The written file; for all lists the folder holding one file each
  filePath: z.string().nullable(),
  rows: z.number()
})
export type ExportResultDto = z.infer<typeof ExportResultDto>
