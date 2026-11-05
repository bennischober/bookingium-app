import { z } from 'zod'

// Mailing lists (Verteiler): recipients are drawn from venues, festivals and
// media (radio stations and the like), filtered by the source they belong to.
// See ContactListService.

// What a recipient is reached through: venue.kind values plus media companies
export const ListKind = z.enum(['venue', 'festival', 'media'])
export type ListKind = z.infer<typeof ListKind>

export const LIST_KIND_LABELS: Record<ListKind, string> = {
  venue: 'Clubs',
  festival: 'Festivals',
  media: 'Radio/Medien'
}

// Whose address it is, seen from the source. 'venue' is the source's own
// address (the club's, festival's or station's); the id stays for saved lists.
export const RecipientType = z.enum(['venue', 'member', 'promoter', 'lopro'])
export type RecipientType = z.infer<typeof RecipientType>

export const RECIPIENT_TYPE_LABELS: Record<RecipientType, string> = {
  venue: 'Hauptadresse',
  member: 'Ansprechpartner',
  promoter: 'Veranstalter',
  lopro: 'LoPro'
}

export const BookedFilter = z.enum(['all', 'booked', 'never'])
export type BookedFilter = z.infer<typeof BookedFilter>

// Empty arrays and null bounds mean "no restriction"
export const ContactListFilters = z.object({
  kinds: z.array(ListKind).default([]),
  recipientTypes: z.array(RecipientType).default([]),
  countryCodes: z.array(z.string()).default([]),
  states: z.array(z.string()).default([]),
  // Comma-separated PLZ prefixes ("7, 80")
  zipPrefixes: z.string().default(''),
  capacityMin: z.number().int().nonnegative().nullable().default(null),
  capacityMax: z.number().int().nonnegative().nullable().default(null),
  genres: z.array(z.string()).default([]),
  // Capacity bounds and booked/never apply to venues and festivals; set, they
  // leave media out. Booked = a non-cancelled event at the venue (of bandId when set)
  booked: BookedFilter.default('all'),
  bandId: z.number().nullable().default(null)
})
export type ContactListFilters = z.infer<typeof ContactListFilters>

export const RecipientSourceDto = z.object({
  // Venue id, or company id for media
  id: z.number(),
  kind: ListKind,
  name: z.string(),
  // Ansprechpartner role ("Booking") or 'LoPro'; '' otherwise
  role: z.string()
})
export type RecipientSourceDto = z.infer<typeof RecipientSourceDto>

// One row per email address (case-insensitive)
export const ContactListRecipientDto = z.object({
  email: z.string(),
  // Person name, company name or source name
  name: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  company: z.string(),
  types: z.array(RecipientType),
  sources: z.array(RecipientSourceDto),
  city: z.string(),
  country: z.string(),
  // Largest capacity of the matched venues (null for media)
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
