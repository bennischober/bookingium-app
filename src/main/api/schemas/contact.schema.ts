import { z } from 'zod'

/**
 * Contact DTO for embedding in other entities
 */
export const ContactDto = z.object({
  id: z.number().optional(),
  email: z.string(),
  phone: z.string(),
  mobilePhone: z.string(),
  homepage: z.string()
})

export type ContactDto = z.infer<typeof ContactDto>

/**
 * Contact input for create/update operations
 */
export const ContactInput = z.object({
  email: z.string().email('Invalid email address').or(z.literal('')).default(''),
  phone: z.string().default(''),
  mobilePhone: z.string().default(''),
  homepage: z.string().url('Invalid URL').or(z.literal('')).default('')
})

export type ContactInput = z.infer<typeof ContactInput>
