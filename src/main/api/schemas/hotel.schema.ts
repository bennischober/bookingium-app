import { z } from 'zod'
import { TimestampFields, createPaginatedResponse } from './base.schema'
import { AddressDto, AddressInput } from './address.schema'
import { ContactDto, ContactInput } from './contact.schema'

export const HotelDto = z
  .object({
    id: z.number(),
    name: z.string(),
    notes: z.string(),
    address: AddressDto.nullable(),
    contact: ContactDto.nullable(),
    addressId: z.number().nullable(),
    contactId: z.number().nullable()
  })
  .extend(TimestampFields.shape)

export type HotelDto = z.infer<typeof HotelDto>

export const HotelListItemDto = z.object({
  id: z.number(),
  name: z.string()
})

export type HotelListItemDto = z.infer<typeof HotelListItemDto>

export const PaginatedHotelResponse = createPaginatedResponse(HotelDto)
export type PaginatedHotelResponse = z.infer<typeof PaginatedHotelResponse>

export const CreateHotelInput = z.object({
  name: z.string().min(1, 'Name is required'),
  notes: z.string().default(''),
  address: AddressInput.optional(),
  contact: ContactInput.optional(),
  addressId: z.number().nullable().optional(),
  contactId: z.number().nullable().optional()
})

export type CreateHotelInput = z.infer<typeof CreateHotelInput>

export const UpdateHotelInput = CreateHotelInput.extend({
  id: z.number()
})

export type UpdateHotelInput = z.infer<typeof UpdateHotelInput>
