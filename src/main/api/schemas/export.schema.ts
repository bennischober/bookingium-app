import { z } from 'zod'
import { VenueKind } from './venue.schema'

// ========================================
// Excel export of the lists
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

/** Sheet names and default file names */
export const EXPORT_LIST_LABELS: Record<ExportList, string> = {
  bands: 'Bands',
  persons: 'Personen',
  companies: 'Firmen',
  venues: 'Spielstätten',
  hotels: 'Hotels',
  events: 'Events',
  invoices: 'Rechnungen',
  banks: 'Banken'
}

/** One list as the grid shows it: same search and filter, all pages */
export const ExportListInput = z.object({
  list: ExportList,
  search: z.string().optional(),
  // Spielstätten only
  kind: VenueKind.optional()
})
export type ExportListInput = z.infer<typeof ExportListInput>

export const ExportResultDto = z.object({
  canceled: z.boolean(),
  filePath: z.string().nullable(),
  rows: z.number()
})
export type ExportResultDto = z.infer<typeof ExportResultDto>
