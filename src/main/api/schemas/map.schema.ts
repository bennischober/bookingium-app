import { z } from 'zod'

// ========================================
// Map preview (experimental, #102)
// ========================================
// One procedure (map.getData) returns everything the map page draws: the
// markers (events and venues at postcode precision) and the filtered rows it
// could not locate. No coordinates are stored anywhere - they are looked up
// offline from the bundled postcode table at request time.

/** Kind, band and date-range filters of the map page; unset = no filter */
export const MapDataInput = z.object({
  kinds: z.array(z.enum(['venue', 'festival'])).optional(),
  bandId: z.number().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional()
})

export type MapDataInput = z.infer<typeof MapDataInput>

/** The marker kinds the page can filter to */
export type MapKindFilter = NonNullable<MapDataInput['kinds']>[number]

export const MapMarkerDto = z.object({
  type: z.enum(['event', 'venue']),
  id: z.number(),
  /** Venue kind of the marker (or of the event's venue): 'venue' = club */
  kind: z.enum(['venue', 'festival']),
  name: z.string(),
  /** Event date (ISO YYYY-MM-DD); venues have none */
  date: z.string().optional(),
  /** Bands of the event / bands that played at the venue (per the filters) */
  bandIds: z.array(z.number()),
  /** false for an address without a known postcode - not drawn, but listed */
  located: z.boolean(),
  /** "Street 1, 10115 Berlin" - how the address reads, not the stored columns */
  addressLabel: z.string(),
  lat: z.number().optional(),
  lng: z.number().optional()
})

export type MapMarkerDto = z.infer<typeof MapMarkerDto>

export const MapUnlocatedDto = z.object({
  type: z.enum(['event', 'venue']),
  id: z.number(),
  name: z.string()
})

export type MapUnlocatedDto = z.infer<typeof MapUnlocatedDto>

export const MapDataDto = z.object({
  markers: z.array(MapMarkerDto),
  unlocated: z.array(MapUnlocatedDto)
})

export type MapDataDto = z.infer<typeof MapDataDto>
