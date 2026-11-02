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
  dateTo: z.string().optional(),
  /** What-if: booking this venue on this date (ISO) - what would it block, what collides? */
  candidate: z.object({ venueId: z.number(), date: z.string().min(1) }).optional()
})

export type MapDataInput = z.infer<typeof MapDataInput>

/** The marker kinds the page can filter to */
export type MapKindFilter = NonNullable<MapDataInput['kinds']>[number]

/** A radius clause applied to a date: km around the venue, ISO window (inclusive) */
export const MapRingDto = z.object({ km: z.number(), from: z.string(), to: z.string() })
export type MapRingDto = z.infer<typeof MapRingDto>

/** An event that blocks (confirmed) or endangers (pending) a venue */
export const MapBlockDto = z.object({ eventId: z.number(), name: z.string(), date: z.string() })
export type MapBlockDto = z.infer<typeof MapBlockDto>

export const MapMarkerDto = z.object({
  type: z.enum(['event', 'venue']),
  id: z.number(),
  /** Venue kind of the marker (or of the event's venue): 'venue' = club */
  kind: z.enum(['venue', 'festival']),
  name: z.string(),
  /** Event date (ISO YYYY-MM-DD); venues have none */
  date: z.string().optional(),
  /** Events: confirmed bookings block, open offers (pending) are a risk */
  status: z.enum(['confirmed', 'pending']).optional(),
  /** Events: the radius clause that applies (event, else venue, else the kind's default) */
  ring: MapRingDto.optional(),
  /** Bands of the event / bands that played at the venue (per the filters) */
  bandIds: z.array(z.number()),
  /** Venues, with a band chosen: the band's confirmed events whose ring covers it */
  blockedBy: z.array(MapBlockDto).optional(),
  /** Venues, with a band chosen: the band's open offers whose ring covers it */
  riskBy: z.array(MapBlockDto).optional(),
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
  /** Venue kind, so the page links a venue to its Clubs or Festivals page */
  kind: z.enum(['venue', 'festival']),
  name: z.string(),
  /** Event without a venue, address without a postcode/city, or a postcode the table lacks */
  reason: z.enum(['no_venue', 'no_address', 'unknown_postcode'])
})

export type MapUnlocatedDto = z.infer<typeof MapUnlocatedDto>

/** An existing event of the band that collides with the what-if booking */
export const MapConflictDto = z.object({
  eventId: z.number(),
  name: z.string(),
  date: z.string(),
  status: z.enum(['confirmed', 'pending']),
  /** Whole km between the venues; null when a location is unknown */
  distanceKm: z.number().nullable(),
  /** candidate_covers: the event lies in the candidate's ring; event_covers: the other way round */
  kind: z.enum(['candidate_covers', 'event_covers', 'both', 'unknown_location'])
})
export type MapConflictDto = z.infer<typeof MapConflictDto>

/** The what-if booking: its ring, the venues it would block, the band's events it collides with */
export const MapCandidateDto = z.object({
  venueId: z.number(),
  name: z.string(),
  kind: z.enum(['venue', 'festival']),
  date: z.string(),
  ring: MapRingDto,
  located: z.boolean(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  blocks: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      kind: z.enum(['venue', 'festival']),
      distanceKm: z.number()
    })
  ),
  conflicts: z.array(MapConflictDto)
})
export type MapCandidateDto = z.infer<typeof MapCandidateDto>

export const MapDataDto = z.object({
  markers: z.array(MapMarkerDto),
  unlocated: z.array(MapUnlocatedDto),
  candidate: MapCandidateDto.nullable()
})

export type MapDataDto = z.infer<typeof MapDataDto>
