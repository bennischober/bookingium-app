import { z } from 'zod'
import { VenueKind } from './venue.schema'

// Mailing lists (Verteiler): recipients are drawn from venues and festivals,
// filtered by the venue they belong to. See ContactListService.

// Whose address it is, seen from the venue
export const RecipientType = z.enum(['venue', 'member', 'promoter'])
export type RecipientType = z.infer<typeof RecipientType>

export const RECIPIENT_TYPE_LABELS: Record<RecipientType, string> = {
  venue: 'Spielstätte/Festival',
  member: 'Ansprechpartner',
  promoter: 'Veranstalter'
}

export const BookedFilter = z.enum(['all', 'booked', 'never'])
export type BookedFilter = z.infer<typeof BookedFilter>

// Empty arrays and null bounds mean "no restriction"
export const ContactListFilters = z.object({
  kinds: z.array(VenueKind).default([]),
  recipientTypes: z.array(RecipientType).default([]),
  countryCodes: z.array(z.string()).default([]),
  states: z.array(z.string()).default([]),
  // Comma-separated PLZ prefixes ("7, 80")
  zipPrefixes: z.string().default(''),
  capacityMin: z.number().int().nonnegative().nullable().default(null),
  capacityMax: z.number().int().nonnegative().nullable().default(null),
  genres: z.array(z.string()).default([]),
  // Booked = a non-cancelled event at the venue (of bandId when set)
  booked: BookedFilter.default('all'),
  bandId: z.number().nullable().default(null)
})
export type ContactListFilters = z.infer<typeof ContactListFilters>

export const RecipientVenueDto = z.object({
  id: z.number(),
  name: z.string(),
  // Ansprechpartner role at this venue ("Booking"); '' otherwise
  role: z.string()
})

// One row per email address (case-insensitive)
export const ContactListRecipientDto = z.object({
  email: z.string(),
  // Person name, company name or venue name
  name: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  company: z.string(),
  types: z.array(RecipientType),
  venues: z.array(RecipientVenueDto),
  city: z.string(),
  country: z.string(),
  // Largest capacity of the matched venues
  capacity: z.number().nullable()
})
export type ContactListRecipientDto = z.infer<typeof ContactListRecipientDto>

export const ContactListResultDto = z.object({
  recipients: z.array(ContactListRecipientDto),
  // Matched but marked "Keine Werbung"; never mailed or exported
  excluded: z.array(ContactListRecipientDto)
})
export type ContactListResultDto = z.infer<typeof ContactListResultDto>

export const ContactListFilterOptionsDto = z.object({
  countryCodes: z.array(z.string()),
  states: z.array(z.string()),
  genres: z.array(z.string()),
  bands: z.array(z.object({ id: z.number(), name: z.string() }))
})
export type ContactListFilterOptionsDto = z.infer<typeof ContactListFilterOptionsDto>

export const SavedContactListDto = z.object({
  id: z.number(),
  name: z.string(),
  filters: ContactListFilters
})
export type SavedContactListDto = z.infer<typeof SavedContactListDto>

export const SaveContactListInput = z.object({
  // Omitted: a new list
  id: z.number().optional(),
  name: z.string().trim().min(1, 'Name ist erforderlich'),
  filters: ContactListFilters
})
export type SaveContactListInput = z.infer<typeof SaveContactListInput>

export const SetNoAdvertisingInput = z.object({
  email: z.string().min(1),
  noAdvertising: z.boolean()
})
export type SetNoAdvertisingInput = z.infer<typeof SetNoAdvertisingInput>
