import { z } from 'zod'
import { TimestampFields, createPaginatedResponse } from './base.schema'
import { AddressDto, AddressInput } from './address.schema'
import { ContactDto, ContactInput } from './contact.schema'

/**
 * Person DTO for frontend consumption (with embedded address and contact)
 */
export const PersonDto = z
  .object({
    id: z.number(),
    firstName: z.string(),
    lastName: z.string(),
    birthday: z.string().nullable(),
    notes: z.string().nullable(),
    address: AddressDto.nullable(),
    contact: ContactDto.nullable()
  })
  .extend(TimestampFields.shape)

/**
 * Person list item DTO (lightweight for dropdowns)
 */
export const PersonListItemDto = z.object({
  id: z.number(),
  firstName: z.string(),
  lastName: z.string()
})

export const PaginatedPersonResponse = createPaginatedResponse(PersonDto)

/**
 * Create person input schema (with embedded address and contact)
 */
export const CreatePersonInput = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().default(''),
  birthday: z.string().nullable().default(null),
  notes: z.string().nullable(),
  address: AddressInput.optional(),
  contact: ContactInput.optional()
})

/**
 * Update person input schema
 */
export const UpdatePersonInput = z.object({
  id: z.number(),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().default(''),
  birthday: z.string().nullable().default(null),
  notes: z.string().nullable(),
  address: AddressInput.optional(),
  contact: ContactInput.optional()
})

// Infer TypeScript types from schemas
export type PersonDto = z.infer<typeof PersonDto>
export type PaginatedPersonResponse = z.infer<typeof PaginatedPersonResponse>
export type PersonListItemDto = z.infer<typeof PersonListItemDto>
export type UpdatePersonInput = z.infer<typeof UpdatePersonInput>
export type CreatePersonInput = z.infer<typeof CreatePersonInput>
