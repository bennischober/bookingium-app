import { z } from 'zod'
import { TimestampFields, createPaginatedResponse } from './base.schema'

// Output DTO - what the frontend receives
export const CompanyDto = z
  .object({
    id: z.number(),
    name: z.string(),
    notes: z.string(),
    vatNumber: z.string(),
    ustNumber: z.string(),
    bankId: z.number().nullable(),
    addressId: z.number().nullable(),
    contactId: z.number().nullable()
  })
  .extend(TimestampFields.shape)

// Simplified company list item (for dropdowns)
export const CompanyListItemDto = z.object({
  id: z.number(),
  name: z.string()
})

// Paginated company response
export const PaginatedCompanyResponse = createPaginatedResponse(CompanyDto)

// Input DTO - for creating/updating
export const CreateCompanyInput = z.object({
  name: z.string().min(1, 'Name is required'),
  notes: z.string().optional().default(''),
  vatNumber: z.string().optional().default(''),
  ustNumber: z.string().optional().default('')
})

export const UpdateCompanyInput = CreateCompanyInput.partial().extend({
  id: z.number()
})

// Infer TypeScript types from schemas
export type CompanyDto = z.infer<typeof CompanyDto>
export type CompanyListItemDto = z.infer<typeof CompanyListItemDto>
export type PaginatedCompanyResponse = z.infer<typeof PaginatedCompanyResponse>
export type CreateCompanyInput = z.infer<typeof CreateCompanyInput>
export type UpdateCompanyInput = z.infer<typeof UpdateCompanyInput>
