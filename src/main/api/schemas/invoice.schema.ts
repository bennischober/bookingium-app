import { z } from 'zod'
import { TimestampFields, createPaginatedResponse } from './base.schema'

export const InvoiceStatus = z.enum(['draft', 'issued', 'paid', 'overdue', 'cancelled'])
export type InvoiceStatus = z.infer<typeof InvoiceStatus>

// ========================================
// Invoice lifecycle rules (shared by main and renderer)
// ========================================
// draft     -> editable, deletable, no number yet
// issued    -> number assigned, content locked; status can still move
//              between issued/paid/overdue, or to cancelled (Storno)
// cancelled -> final; the invoice and its number stay on record

const INVOICE_STATUS_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ['issued'],
  issued: ['paid', 'overdue', 'cancelled'],
  overdue: ['issued', 'paid', 'cancelled'],
  paid: ['issued', 'overdue', 'cancelled'],
  cancelled: []
}

/** Statuses an invoice in `from` may move to (excluding staying put) */
export function nextInvoiceStatuses(from: InvoiceStatus): readonly InvoiceStatus[] {
  return INVOICE_STATUS_TRANSITIONS[from]
}

export function canChangeInvoiceStatus(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return from === to || INVOICE_STATUS_TRANSITIONS[from].includes(to)
}

/** Only drafts may be edited or deleted; everything else is on record */
export function isInvoiceLocked(status: InvoiceStatus): boolean {
  return status !== 'draft'
}

export const InvoiceRecipientKind = z.enum(['company', 'band', 'person', 'other'])
export type InvoiceRecipientKind = z.infer<typeof InvoiceRecipientKind>

export const InvoiceTaxCode = z.enum(['standard', 'reduced', 'reverse_charge', 'exempt', 'other'])
export type InvoiceTaxCode = z.infer<typeof InvoiceTaxCode>

export const InvoiceLineItemDto = z.object({
  id: z.number(),
  position: z.number(),
  description: z.string(),
  quantity: z.number(),
  unit: z.string(),
  unitPriceNet: z.number(),
  lineNetAmount: z.number(),
  taxRate: z.number(),
  taxCode: InvoiceTaxCode,
  lineTaxAmount: z.number(),
  lineGrossAmount: z.number()
})

export type InvoiceLineItemDto = z.infer<typeof InvoiceLineItemDto>

// Frozen party data captured at invoice issue time (used for print/PDF rendering)
export const InvoicePartySnapshotDto = z.object({
  id: z.number(),
  kind: z.string(),
  legalName: z.string(),
  street: z.string(),
  streetNumber: z.string(),
  zipCode: z.string(),
  city: z.string(),
  country: z.string(),
  countryCode: z.string(),
  vatNumber: z.string(),
  ustNumber: z.string(),
  taxNumber: z.string(),
  commercialRegisterNo: z.string(),
  registerCourt: z.string(),
  website: z.string(),
  accountHolder: z.string(),
  bankName: z.string(),
  logoPath: z.string(),
  email: z.string(),
  phone: z.string(),
  iban: z.string(),
  bic: z.string()
})

export type InvoicePartySnapshotDto = z.infer<typeof InvoicePartySnapshotDto>

export const InvoiceListItemDto = z.object({
  id: z.number(),
  // null while the invoice is a draft (assigned on issue)
  invoiceNumber: z.number().nullable(),
  companyId: z.number(),
  companyName: z.string(),
  recipientKind: InvoiceRecipientKind,
  recipientName: z.string(),
  recipientCompanyId: z.number().nullable(),
  recipientBandId: z.number().nullable(),
  recipientPersonId: z.number().nullable(),
  dealMemoId: z.number().nullable(),
  dealMemoName: z.string().nullable(),
  periodStartDate: z.string().nullable(),
  periodEndDate: z.string().nullable(),
  periodLabel: z.string(),
  issueDate: z.string(),
  dueDate: z.string().nullable(),
  status: InvoiceStatus,
  currency: z.string(),
  subtotalNetAmount: z.number(),
  subtotalTaxAmount: z.number(),
  totalGrossAmount: z.number(),
  totalAmount: z.number()
})

export type InvoiceListItemDto = z.infer<typeof InvoiceListItemDto>

export const InvoiceDto = InvoiceListItemDto.extend({
  notes: z.string(),
  paymentTerms: z.string(),
  reverseChargeNote: z.string(),
  lineItems: z.array(InvoiceLineItemDto)
}).extend(TimestampFields.shape)

export type InvoiceDto = z.infer<typeof InvoiceDto>

export const InvoicePrintDto = z.object({
  invoice: InvoiceDto,
  issuer: InvoicePartySnapshotDto.nullable(),
  recipient: InvoicePartySnapshotDto.nullable(),
  venueName: z.string().nullable()
})

export type InvoicePrintDto = z.infer<typeof InvoicePrintDto>

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

export const InvoiceLineItemInput = z.object({
  description: z.string().min(1),
  quantity: z.number().positive().optional().default(1),
  unit: z.string().optional().default('service'),
  unitPriceNet: z.number().nonnegative(),
  taxRate: z.number().min(0).max(100).optional().default(0),
  taxCode: InvoiceTaxCode.optional().default('standard')
})

export type InvoiceLineItemInput = z.infer<typeof InvoiceLineItemInput>

export const CreateInvoiceInput = z.object({
  dealMemoId: z.number().nullable().optional(),
  companyId: z.number().nullable().optional(),
  recipientKind: InvoiceRecipientKind.optional(),
  recipientCompanyId: z.number().nullable().optional(),
  recipientBandId: z.number().nullable().optional(),
  recipientPersonId: z.number().nullable().optional(),
  recipientNameOverride: z.string().optional(),
  periodStartDate: z.string().nullable().optional(),
  periodEndDate: z.string().nullable().optional(),
  periodLabel: z.string().optional(),
  issueDate: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  status: InvoiceStatus.optional().default('draft'),
  currency: z.string().optional().default('EUR'),
  lineItems: z.array(InvoiceLineItemInput).optional().default([]),
  totalAmount: z.number().optional().default(0),
  paymentTerms: z.string().optional().default(''),
  reverseChargeNote: z.string().optional().default(''),
  notes: z.string().optional().default('')
})

export type CreateInvoiceInput = z.infer<typeof CreateInvoiceInput>

export const CreateInvoiceForDealMemoInput = CreateInvoiceInput.extend({
  dealMemoId: z.number()
})

export type CreateInvoiceForDealMemoInput = z.infer<typeof CreateInvoiceForDealMemoInput>

export const UpdateInvoiceInput = z.object({
  id: z.number(),
  dealMemoId: z.number().nullable().optional(),
  companyId: z.number().optional(),
  recipientKind: InvoiceRecipientKind.optional(),
  recipientCompanyId: z.number().nullable().optional(),
  recipientBandId: z.number().nullable().optional(),
  recipientPersonId: z.number().nullable().optional(),
  recipientNameOverride: z.string().optional(),
  periodStartDate: z.string().nullable().optional(),
  periodEndDate: z.string().nullable().optional(),
  periodLabel: z.string().optional(),
  issueDate: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  status: InvoiceStatus.optional(),
  currency: z.string().optional(),
  lineItems: z.array(InvoiceLineItemInput).optional(),
  totalAmount: z.number().optional(),
  paymentTerms: z.string().optional(),
  reverseChargeNote: z.string().optional(),
  notes: z.string().optional()
})

export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceInput>

export const SetInvoiceStatusInput = z.object({
  id: z.number(),
  status: InvoiceStatus
})

export type SetInvoiceStatusInput = z.infer<typeof SetInvoiceStatusInput>
