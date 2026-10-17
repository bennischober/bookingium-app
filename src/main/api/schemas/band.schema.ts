import { z } from 'zod'
import { TimestampFields, createPaginatedResponse } from './base.schema'

// Output DTO - what the frontend receives
export const BandDto = z
  .object({
    id: z.number(),
    name: z.string(),
    genre: z.string(),
    founded: z.string().nullable(),
    notes: z.string(),
    companyId: z.number(),
    responsiblePersonId: z.number().nullable(),
    // Represents the band in contracts ("vertreten durch")
    managementCompanyId: z.number().nullable()
  })
  .extend(TimestampFields.shape)

// Paginated band response
export const PaginatedBandResponse = createPaginatedResponse(BandDto)

// Lightweight list item for dropdowns
export const BandListItemDto = z.object({
  id: z.number(),
  name: z.string()
})
export type BandListItemDto = z.infer<typeof BandListItemDto>

// For nested/related data
export const BandWithCompanyDto = BandDto.extend({
  company: z.object({
    id: z.number(),
    name: z.string()
  })
})

// Input DTO - for creating/updating
export const CreateBandInput = z.object({
  name: z.string().min(1, 'Name is required'),
  genre: z.string().optional().default(''),
  founded: z.string().nullable().optional(),
  notes: z.string().optional().default(''),
  companyId: z.number(),
  responsiblePersonId: z.number().nullable().optional(),
  managementCompanyId: z.number().nullable().optional()
})

export const UpdateBandInput = CreateBandInput.partial().extend({
  id: z.number()
})

// Infer TypeScript types from schemas
export type BandDto = z.infer<typeof BandDto>
export type PaginatedBandResponse = z.infer<typeof PaginatedBandResponse>
export type BandWithCompanyDto = z.infer<typeof BandWithCompanyDto>
export type CreateBandInput = z.infer<typeof CreateBandInput>
export type UpdateBandInput = z.infer<typeof UpdateBandInput>
