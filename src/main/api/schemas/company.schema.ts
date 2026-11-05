import { z } from 'zod'
import { TimestampFields, createPaginatedResponse } from './base.schema'
import { AddressDto, AddressInput } from './address.schema'
import { ContactDto, ContactInput } from './contact.schema'
import { BankDto } from './bank.schema'
import { normalizeGenres } from './genres'

// Radio stations and other media are companies of their own kind: the
// Verteiler lists them as a source next to clubs and festivals (#80)
export const CompanyKind = z.enum(['company', 'media'])
export type CompanyKind = z.infer<typeof CompanyKind>

export const COMPANY_KIND_LABELS: Record<CompanyKind, string> = {
  company: 'Firma',
  media: 'Radio/Medien'
}

// Output DTO - what the frontend receives (with embedded relations)
export const CompanyDto = z
  .object({
    id: z.number(),
    name: z.string(),
    kind: CompanyKind,
    genres: z.string(),
    notes: z.string(),
    vatNumber: z.string(),
    ustNumber: z.string(),
    taxNumber: z.string(),
    commercialRegisterNo: z.string(),
    registerCourt: z.string(),
    logoPath: z.string(),
    signaturePath: z.string(),
    kskNumber: z.string(),
    isDefaultForInvoicing: z.boolean(),
    // Contact person printed into e-invoices (seller contact)
    invoiceContactPersonId: z.number().nullable(),
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
  kind: CompanyKind.optional().default('company'),
  genres: z.string().transform(normalizeGenres).optional().default(''),
  notes: z.string().optional().default(''),
  vatNumber: z.string().optional().default(''),
  ustNumber: z.string().optional().default(''),
  taxNumber: z.string().optional().default(''),
  commercialRegisterNo: z.string().optional().default(''),
  registerCourt: z.string().optional().default(''),
  logoPath: z.string().optional().default(''),
  signaturePath: z.string().optional().default(''),
  kskNumber: z.string().optional().default(''),
  isDefaultForInvoicing: z.boolean().optional().default(false),
  invoiceContactPersonId: z.number().nullable().optional(),
  address: AddressInput.optional(),
  contact: ContactInput.optional(),
  bankId: z.number().nullable().optional()
})

export const UpdateCompanyInput = z.object({
  id: z.number(),
  name: z.string().min(1, 'Name is required').optional(),
  kind: CompanyKind.optional(),
  genres: z.string().transform(normalizeGenres).optional(),
  notes: z.string().optional(),
  vatNumber: z.string().optional(),
  ustNumber: z.string().optional(),
  taxNumber: z.string().optional(),
  commercialRegisterNo: z.string().optional(),
  registerCourt: z.string().optional(),
  logoPath: z.string().optional(),
  signaturePath: z.string().optional(),
  kskNumber: z.string().optional(),
  isDefaultForInvoicing: z.boolean().optional(),
  invoiceContactPersonId: z.number().nullable().optional(),
  address: AddressInput.optional(),
  contact: ContactInput.optional(),
  bankId: z.number().nullable().optional()
})

// Infer TypeScript types from schemas
export type CompanyDto = z.infer<typeof CompanyDto>
export type CompanyListItemDto = z.infer<typeof CompanyListItemDto>
export type PaginatedCompanyResponse = z.infer<typeof PaginatedCompanyResponse>
export type CreateCompanyInput = z.infer<typeof CreateCompanyInput>
export type UpdateCompanyInput = z.infer<typeof UpdateCompanyInput>
