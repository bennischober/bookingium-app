import { z } from 'zod'
import { TimestampFields, createPaginatedResponse } from './base.schema'

export const InvoiceStatus = z.enum(['draft', 'issued', 'paid', 'cancelled'])
export type InvoiceStatus = z.infer<typeof InvoiceStatus>

export const InvoiceListItemDto = z.object({
  id: z.number(),
  invoiceNumber: z.number(),
  companyId: z.number(),
  companyName: z.string(),
  dealMemoId: z.number().nullable(),
  dealMemoName: z.string().nullable(),
  issueDate: z.string(),
  dueDate: z.string().nullable(),
  status: InvoiceStatus,
  currency: z.string(),
  totalAmount: z.number()
})

export type InvoiceListItemDto = z.infer<typeof InvoiceListItemDto>

export const InvoiceDto = InvoiceListItemDto.extend({
  notes: z.string()
}).extend(TimestampFields.shape)

export type InvoiceDto = z.infer<typeof InvoiceDto>

export const CompanyInvoiceSettingsDto = z
  .object({
    id: z.number(),
    companyId: z.number(),
    nextInvoiceNumber: z.number()
  })
  .extend(TimestampFields.shape)

export type CompanyInvoiceSettingsDto = z.infer<typeof CompanyInvoiceSettingsDto>

export const PaginatedInvoiceResponse = createPaginatedResponse(InvoiceListItemDto)
export type PaginatedInvoiceResponse = z.infer<typeof PaginatedInvoiceResponse>

export const UpsertCompanyInvoiceSettingsInput = z.object({
  companyId: z.number(),
  nextInvoiceNumber: z.number().int().min(1)
})

export type UpsertCompanyInvoiceSettingsInput = z.infer<typeof UpsertCompanyInvoiceSettingsInput>

export const CreateInvoiceForDealMemoInput = z.object({
  dealMemoId: z.number(),
  companyId: z.number().nullable().optional(),
  issueDate: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  status: InvoiceStatus.optional().default('draft'),
  currency: z.string().optional().default('EUR'),
  totalAmount: z.number().optional().default(0),
  notes: z.string().optional().default('')
})

export type CreateInvoiceForDealMemoInput = z.infer<typeof CreateInvoiceForDealMemoInput>

export const UpdateInvoiceInput = z.object({
  id: z.number(),
  issueDate: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  status: InvoiceStatus.optional(),
  currency: z.string().optional(),
  totalAmount: z.number().optional(),
  notes: z.string().optional()
})

export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceInput>
