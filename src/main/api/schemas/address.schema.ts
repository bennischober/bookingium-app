import { z } from 'zod'

/**
 * Address DTO for embedding in other entities
 */
export const AddressDto = z.object({
  id: z.number().optional(),
  street: z.string(),
  streetNumber: z.string(),
  addressSuffix: z.string(),
  zipCode: z.string(),
  city: z.string(),
  state: z.string(),
  country: z.string(),
  countryCode: z.string()
})

export type AddressDto = z.infer<typeof AddressDto>

/**
 * Address input for create/update operations. Every part is optional: contact
 * lists (and imports from them) often only know the city of a venue.
 */
export const AddressInput = z.object({
  street: z.string().default(''),
  streetNumber: z.string().default(''),
  addressSuffix: z.string().default(''),
  zipCode: z.string().default(''),
  city: z.string().default(''),
  state: z.string().default(''),
  country: z.string().default(''),
  countryCode: z
    .string()
    .length(2, 'Country code must be 2 characters')
    .or(z.literal(''))
    .default('')
})

export type AddressInput = z.infer<typeof AddressInput>
