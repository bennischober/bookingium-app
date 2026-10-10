import { z } from 'zod'
import { TimestampFields, createPaginatedResponse } from './base.schema'
import { AddressDto, AddressInput } from './address.schema'
import { ContactDto, ContactInput } from './contact.schema'
import { BankDto } from './bank.schema'

// Output DTO - what the frontend receives (with embedded relations)
export const CompanyDto = z
  .object({
    id: z.number(),
    name: z.string(),
    notes: z.string(),
    vatNumber: z.string(),
    ustNumber: z.string(),
    taxNumber: z.string(),
    commercialRegisterNo: z.string(),
    registerCourt: z.string(),
    website: z.string(),
    isDefaultForInvoicing: z.boolean(),
    address: AddressDto.nullable(),
    contact: ContactDto.nullable(),
    bank: BankDto.nullable()
  })
  .extend(TimestampFields.shape)

// Simplified company list item (for dropdowns)
export const CompanyListItemDto = z.object({
  id: z.number(),
  name: z.string()
})

// Paginated company response
export const PaginatedCompanyResponse = createPaginatedResponse(CompanyDto)

// Input DTO - for creating/updating (with embedded relations)
export const CreateCompanyInput = z.object({
  name: z.string().min(1, 'Name is required'),
  notes: z.string().optional().default(''),
  vatNumber: z.string().optional().default(''),
  ustNumber: z.string().optional().default(''),
  taxNumber: z.string().optional().default(''),
  commercialRegisterNo: z.string().optional().default(''),
  registerCourt: z.string().optional().default(''),
  website: z.string().optional().default(''),
  isDefaultForInvoicing: z.boolean().optional().default(false),
  address: AddressInput.optional(),
  contact: ContactInput.optional(),
  bankId: z.number().nullable().optional()
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
