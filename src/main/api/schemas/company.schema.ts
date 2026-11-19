import { z } from 'zod'
import { TERMS } from '../terms'
import { TimestampFields, createPaginatedResponse } from './base.schema'
import { AddressDto, AddressInput } from './address.schema'
import { ContactDto, ContactInput } from './contact.schema'
import { BankDto } from './bank.schema'
import { normalizeGenres } from './genres'
import { isValidIban } from '../../payment/epcQr'

/**
 * #247: the company's bank account, typed right in the company form. All empty means none;
 * the IBAN is checked (mod 97) as soon as one is given.
 */
export const CompanyBankInput = z.object({
  accountHolder: z.string().trim().default(''),
  iban: z
    .string()
    .default('')
    .transform((v) => v.replace(/\s+/g, '').toUpperCase())
    .refine((v) => v === '' || isValidIban(v), 'Die IBAN ist ungültig (Prüfziffer stimmt nicht)'),
  bic: z
    .string()
    .default('')
    .transform((v) => v.replace(/\s+/g, '').toUpperCase())
    .refine((v) => v === '' || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v), 'Die BIC hat 8 oder 11 Zeichen'),
  bankName: z.string().trim().default('')
})
export type CompanyBankInput = z.infer<typeof CompanyBankInput>

// Radio stations and other media are companies of their own kind: the
// Verteiler lists them as a source next to clubs and festivals (#80)
export const CompanyKind = z.enum(['company', 'media'])
export type CompanyKind = z.infer<typeof CompanyKind>

export const COMPANY_KIND_LABELS: Record<CompanyKind, string> = {
  company: TERMS.company.singular,
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
    vatId: z.string(),
    taxNumber: z.string(),
    commercialRegisterNo: z.string(),
    registerCourt: z.string(),
    logoPath: z.string(),
    signaturePath: z.string(),
    kskNumber: z.string(),
    /** Kundennummer (given with the first issued invoice, or entered), null for none */
    customerNumber: z.number().nullable(),
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
/** A Kundennummer as typed: '' or nothing for none, else a whole number from 1 */
export const CustomerNumberInput = z.preprocess(
  (value) => (value === '' || value === null || value === undefined ? null : Number(value)),
  z.number().int('Kundennummer muss eine ganze Zahl sein').positive().nullable()
)

export const CreateCompanyInput = z.object({
  name: z.string().min(1, 'Name ist erforderlich'),
  kind: CompanyKind.optional().default('company'),
  genres: z.string().transform(normalizeGenres).optional().default(''),
  notes: z.string().optional().default(''),
  vatId: z.string().optional().default(''),
  taxNumber: z.string().optional().default(''),
  commercialRegisterNo: z.string().optional().default(''),
  registerCourt: z.string().optional().default(''),
  logoPath: z.string().optional().default(''),
  signaturePath: z.string().optional().default(''),
  kskNumber: z.string().optional().default(''),
  customerNumber: CustomerNumberInput.optional(),
  isDefaultForInvoicing: z.boolean().optional().default(false),
  invoiceContactPersonId: z.number().nullable().optional(),
  address: AddressInput.optional(),
  contact: ContactInput.optional(),
  bankId: z.number().nullable().optional(),
  /** #247: wins over bankId when given */
  bank: CompanyBankInput.optional()
})

export const UpdateCompanyInput = z.object({
  id: z.number(),
  name: z.string().min(1, 'Name ist erforderlich').optional(),
  kind: CompanyKind.optional(),
  genres: z.string().transform(normalizeGenres).optional(),
  notes: z.string().optional(),
  vatId: z.string().optional(),
  taxNumber: z.string().optional(),
  commercialRegisterNo: z.string().optional(),
  registerCourt: z.string().optional(),
  logoPath: z.string().optional(),
  signaturePath: z.string().optional(),
  kskNumber: z.string().optional(),
  customerNumber: CustomerNumberInput.optional(),
  isDefaultForInvoicing: z.boolean().optional(),
  invoiceContactPersonId: z.number().nullable().optional(),
  address: AddressInput.optional(),
  contact: ContactInput.optional(),
  bankId: z.number().nullable().optional(),
  /** #247: wins over bankId when given */
  bank: CompanyBankInput.optional()
})

// Infer TypeScript types from schemas
export type CompanyDto = z.infer<typeof CompanyDto>
export type CompanyListItemDto = z.infer<typeof CompanyListItemDto>
export type PaginatedCompanyResponse = z.infer<typeof PaginatedCompanyResponse>
export type CreateCompanyInput = z.infer<typeof CreateCompanyInput>
export type UpdateCompanyInput = z.infer<typeof UpdateCompanyInput>
