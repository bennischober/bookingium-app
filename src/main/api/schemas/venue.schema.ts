import { z } from 'zod'
import { TimestampFields } from './base.schema'
import { AddressDto, AddressInput } from './address.schema'
import { ContactDto, ContactInput } from './contact.schema'
import { CompanyListItemDto } from './company.schema'

export const VenueDto = z
  .object({
    id: z.number(),
    name: z.string(),
    capacity: z.number().nullable(),
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
  capacity: z.number().nullable().optional(),
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
  capacity: z.number().nullable().optional(),
  notes: z.string().default(''),
  address: AddressInput.optional(),
  contact: ContactInput.optional(),
  companyId: z.number().nullable().optional(),
  addressId: z.number().nullable().optional(),
  contactId: z.number().nullable().optional()
})

export type UpdateVenueInput = z.infer<typeof UpdateVenueInput>
