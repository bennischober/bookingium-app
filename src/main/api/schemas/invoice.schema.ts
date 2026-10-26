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
// cancelled -> final; the invoice and its number stay on record, and a
//              Stornorechnung (kind cancellation) with its own number
//              offsets it. Stornorechnungen are issued and never change.

const INVOICE_STATUS_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ['issued'],
  issued: ['paid', 'overdue', 'cancelled'],
  overdue: ['issued', 'paid', 'cancelled'],
  paid: ['issued', 'overdue', 'cancelled'],
  cancelled: []
}

export const InvoiceKind = z.enum(['invoice', 'cancellation'])
export type InvoiceKind = z.infer<typeof InvoiceKind>

// What "Per E-Mail senden" created: the invoice itself, a Zahlungserinnerung
// or a Mahnung about it
export const InvoiceEmailKind = z.enum(['invoice', 'reminder', 'dunning'])
export type InvoiceEmailKind = z.infer<typeof InvoiceEmailKind>
/** Zahlungserinnerung (the first) or Mahnung (every one after it) */
export type ReminderKind = Exclude<InvoiceEmailKind, 'invoice'>

/** Only open invoices (not Stornorechnungen) get payment reminders */
export function canRemind(invoice: { kind: InvoiceKind; status: InvoiceStatus }): boolean {
  return invoice.kind === 'invoice' && (invoice.status === 'issued' || invoice.status === 'overdue')
}

/**
 * The payment reminder an invoice is due for: a Zahlungserinnerung first,
 * a Mahnung after that; none while it isn't overdue (marked overdue, or
 * "gestellt" past its due date; `today` is the local calendar day)
 */
export function nextReminderKind(
  invoice: {
    kind: InvoiceKind
    status: InvoiceStatus
    dueDate: string | null
    emails: Array<{ kind: InvoiceEmailKind }>
  },
  today: string
): ReminderKind | null {
  if (!canRemind(invoice)) return null
  const overdue =
    invoice.status === 'overdue' || (invoice.dueDate !== null && invoice.dueDate < today)
  if (!overdue) return null
  return invoice.emails.some((email) => email.kind !== 'invoice') ? 'dunning' : 'reminder'
}

/** Statuses an invoice in `from` may move to (excluding staying put) */
export function nextInvoiceStatuses(
  from: InvoiceStatus,
  kind: InvoiceKind = 'invoice'
): readonly InvoiceStatus[] {
  return kind === 'cancellation' ? [] : INVOICE_STATUS_TRANSITIONS[from]
}

export function canChangeInvoiceStatus(
  from: InvoiceStatus,
  to: InvoiceStatus,
  kind: InvoiceKind = 'invoice'
): boolean {
  return from === to || nextInvoiceStatuses(from, kind).includes(to)
}

/** Only drafts may be edited or deleted; everything else is on record */
export function isInvoiceLocked(status: InvoiceStatus): boolean {
  return status !== 'draft'
}

export const InvoiceRecipientKind = z.enum(['company', 'band', 'person', 'other'])
export type InvoiceRecipientKind = z.infer<typeof InvoiceRecipientKind>

// Stored per line; mapped to the EN 16931 VAT categories in einvoice/codes.ts
export const InvoiceTaxCode = z.enum([
  'standard',
  'reduced',
  'zero_rated',
  'reverse_charge',
  'exempt',
  'intra_community',
  'export',
  'not_taxable',
  'other'
])
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
  bic: z.string(),
  contactName: z.string(),
  contactPhone: z.string(),
  contactEmail: z.string()
})

export type InvoicePartySnapshotDto = z.infer<typeof InvoicePartySnapshotDto>

export const InvoiceListItemDto = z.object({
  id: z.number(),
  // null while the invoice is a draft (assigned on issue)
  invoiceNumber: z.number().nullable(),
  kind: InvoiceKind,
  // Stornorechnung: number of the invoice it cancels
  cancelsInvoiceNumber: z.number().nullable(),
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
  totalAmount: z.number(),
  // Last "Per E-Mail senden" (datetime, UTC) and the address, '' for none
  emailedAt: z.string().nullable(),
  emailedTo: z.string()
})

export type InvoiceListItemDto = z.infer<typeof InvoiceListItemDto>

export const InvoiceEmailDto = z.object({
  kind: InvoiceEmailKind,
  createdAt: z.string(),
  to: z.string()
})
export type InvoiceEmailDto = z.infer<typeof InvoiceEmailDto>

/** C4: one mail of an invoice, sent by bookingum or an answer to it */
export const InvoiceMailDto = z.object({
  /** 'sent' = the invoice mail itself, 'reply' = an answer to it */
  role: z.enum(['sent', 'reply']),
  /** null for a reply: it is not one of the invoice's own sends */
  kind: InvoiceEmailKind.nullable(),
  /** when bookingum sent it; null for mails an external program sent */
  sentAt: z.string().nullable(),
  accountId: z.string().nullable(),
  messageId: z.string().nullable(),
  /** the mail store's row id, for opening the window; null when gone */
  storeId: z.number().nullable(),
  subject: z.string().nullable(),
  fromName: z.string().nullable(),
  fromEmail: z.string().nullable(),
  date: z.string().nullable(),
  hasAttachments: z.boolean()
})
export type InvoiceMailDto = z.infer<typeof InvoiceMailDto>

/** C4: the mails of one invoice plus whether an answer arrived */
export const InvoiceMailsDto = z.object({
  mails: z.array(InvoiceMailDto),
  /** true as soon as one reply exists */
  answered: z.boolean()
})
export type InvoiceMailsDto = z.infer<typeof InvoiceMailsDto>

/** An invoice to chase (Dashboard), with the payment reminders sent so far */
export const OverdueInvoiceDto = InvoiceListItemDto.extend({
  // Zahlungserinnerungen and Mahnungen, oldest first
  emails: z.array(InvoiceEmailDto)
})
export type OverdueInvoiceDto = z.infer<typeof OverdueInvoiceDto>

export const InvoiceDto = InvoiceListItemDto.extend({
  notes: z.string(),
  paymentTerms: z.string(),
  reverseChargeNote: z.string(),
  buyerReference: z.string(),
  xrechnung: z.boolean(),
  // Stornorechnung: the invoice it cancels
  cancelsInvoiceId: z.number().nullable(),
  cancelsInvoiceIssueDate: z.string().nullable(),
  // Cancelled invoice: its Stornorechnung
  cancelledByInvoiceId: z.number().nullable(),
  cancelledByInvoiceNumber: z.number().nullable(),
  lineItems: z.array(InvoiceLineItemDto),
  // Every "Per E-Mail senden", latest first (datetime, UTC; '' for no address)
  emails: z.array(InvoiceEmailDto),
  // Each status it moved to, in order (datetime UTC; a plain date for the
  // ones from before the Verlauf existed)
  statusChanges: z.array(z.object({ status: InvoiceStatus, createdAt: z.string() }))
}).extend(TimestampFields.shape)

export type InvoiceDto = z.infer<typeof InvoiceDto>

export const InvoicePrintDto = z.object({
  invoice: InvoiceDto,
  issuer: InvoicePartySnapshotDto.nullable(),
  recipient: InvoicePartySnapshotDto.nullable(),
  venueName: z.string().nullable(),
  // Date of the linked event (date of supply in the e-invoice)
  eventDate: z.string().nullable(),
  // Set for a quarterly management share (billed to the band's company)
  managementShare: z.object({ bandName: z.string() }).nullable(),
  // The artist the invoice is about: the management share's band, else the
  // linked event's band
  bandName: z.string().nullable()
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
  buyerReference: z.string().optional().default(''),
  xrechnung: z.boolean().optional().default(false),
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
  buyerReference: z.string().optional(),
  xrechnung: z.boolean().optional(),
  notes: z.string().optional()
})

export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceInput>

export const SetInvoiceStatusInput = z.object({
  id: z.number(),
  status: InvoiceStatus
})

export type SetInvoiceStatusInput = z.infer<typeof SetInvoiceStatusInput>

// ========================================
// E-invoice (ZUGFeRD/Factur-X)
// ========================================
// ready      -> issued and complete: the saved PDF carries the XML
// draft      -> complete so far; the XML comes once the invoice is issued
// incomplete -> `missing` lists what the e-invoice still needs
// cancelled  -> cancelled invoices get no e-invoice
// disabled   -> switched off in the settings

export const EInvoiceState = z.enum(['ready', 'draft', 'incomplete', 'cancelled', 'disabled'])
export type EInvoiceState = z.infer<typeof EInvoiceState>

export const EInvoiceCheckDto = z.object({
  state: EInvoiceState,
  missing: z.array(z.string()),
  // XRechnung profile (public-sector buyers) instead of plain EN 16931
  xrechnung: z.boolean()
})
export type EInvoiceCheckDto = z.infer<typeof EInvoiceCheckDto>

/** Issuer/recipient choice of the invoice form, to preview the frozen parties */
export const PreviewInvoicePartiesInput = z.object({
  dealMemoId: z.number().nullable().optional(),
  companyId: z.number().nullable().optional(),
  recipientKind: InvoiceRecipientKind.optional(),
  recipientCompanyId: z.number().nullable().optional(),
  recipientBandId: z.number().nullable().optional(),
  recipientPersonId: z.number().nullable().optional(),
  recipientNameOverride: z.string().optional()
})
export type PreviewInvoicePartiesInput = z.infer<typeof PreviewInvoicePartiesInput>

/**
 * I7: mail.sendInvoice. The mail is passed on as the editor built it - the core checks it,
 * as for every other send. Every object here is passthrough: a plain z.object would strip
 * the recipients' names and the send would fail inside the core.
 */
export const SendInvoiceMailInput = z.object({
  token: z.string().min(1),
  accountId: z.string().min(1),
  draftUid: z.number().int().nullable(),
  mail: z.object({ to: z.array(z.object({ email: z.string() }).passthrough()) }).passthrough()
})
export type SendInvoiceMailInput = z.infer<typeof SendInvoiceMailInput>
