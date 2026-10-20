import { z } from 'zod'
import { TimestampFields } from './base.schema'
import { AddressDto, AddressInput } from './address.schema'
import { ContactDto, ContactInput } from './contact.schema'
import { CompanyListItemDto } from './company.schema'
import { PaginationInput } from './base.schema'

export const VenueKind = z.enum(['venue', 'festival'])
export type VenueKind = z.infer<typeof VenueKind>

export const VENUE_KIND_LABELS: Record<VenueKind, string> = {
  venue: 'Spielstätte',
  festival: 'Festival'
}

// Genre tags are free text, comma-separated; stored trimmed and deduplicated
// (case-insensitive) as "Metal, Rock"
export function splitGenres(value: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of value.split(/[,;]/)) {
    const tag = raw.trim()
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase())
      tags.push(tag)
    }
  }
  return tags
}

/** " Rock;metal " -> "Rock, metal" (how genres are stored) */
export const normalizeGenres = (value: string): string => splitGenres(value).join(', ')

const GenresInput = z.string().transform(normalizeGenres)

export const VenueDto = z
  .object({
    id: z.number(),
    name: z.string(),
    kind: VenueKind,
    capacity: z.number().nullable(),
    genres: z.string(),
    notes: z.string(),
    address: AddressDto.nullable(),
    contact: ContactDto.nullable(),
    company: CompanyListItemDto.nullable(),
    addressId: z.number().nullable(),
    companyId: z.number().nullable(),
    contactId: z.number().nullable()
  })
  .extend(TimestampFields.shape)

export type VenueDto = z.infer<typeof VenueDto>

export const VenueListItemDto = z.object({
  id: z.number(),
  name: z.string()
})

export type VenueListItemDto = z.infer<typeof VenueListItemDto>

export const CreateVenueInput = z.object({
  name: z.string().min(1, 'Name is required'),
  kind: VenueKind.default('venue'),
  capacity: z.number().nullable().optional(),
  genres: GenresInput.default(''),
  notes: z.string().default(''),
  address: AddressInput.optional(),
  contact: ContactInput.optional(),
  companyId: z.number().nullable().optional(),
  addressId: z.number().nullable().optional(),
  contactId: z.number().nullable().optional()
})

export type CreateVenueInput = z.infer<typeof CreateVenueInput>

export const UpdateVenueInput = z.object({
  id: z.number(),
  name: z.string().min(1, 'Name is required'),
  kind: VenueKind.default('venue'),
  capacity: z.number().nullable().optional(),
  // Optional: callers that don't send it keep the stored tags
  genres: GenresInput.optional(),
  notes: z.string().default(''),
  address: AddressInput.optional(),
  contact: ContactInput.optional(),
  companyId: z.number().nullable().optional(),
  addressId: z.number().nullable().optional(),
  contactId: z.number().nullable().optional()
})

export type UpdateVenueInput = z.infer<typeof UpdateVenueInput>

export const VenuePaginationInput = PaginationInput.extend({
  kind: VenueKind.optional()
})

export type VenuePaginationInput = z.infer<typeof VenuePaginationInput>
