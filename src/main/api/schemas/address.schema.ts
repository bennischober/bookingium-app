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
 * Address input for create/update operations
 */
export const AddressInput = z.object({
  street: z.string().min(1, 'Street is required'),
  streetNumber: z.string().default(''),
  addressSuffix: z.string().default(''),
  zipCode: z.string().min(1, 'ZIP code is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().default(''),
  country: z.string().min(1, 'Country is required'),
  countryCode: z.string().length(2, 'Country code must be 2 characters').default('')
})

export type AddressInput = z.infer<typeof AddressInput>
