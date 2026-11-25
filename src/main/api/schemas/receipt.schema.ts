import { z } from 'zod'
import { PaginationInput, createPaginatedResponse } from './base.schema'
import { DATEV_CATEGORY_LABELS, DatevCategory } from './datev.schema'

// #225: received documents (Belege) - incoming invoices, credit card and cash receipts,
// travel expenses - stored as one PDF each and handed to DATEV under their category.

/** The categories a receipt can have: every DATEV category but Rechnungsausgang */
export const ReceiptCategory = DatevCategory.exclude(['outgoing'])
export type ReceiptCategory = z.infer<typeof ReceiptCategory>

export const RECEIPT_CATEGORY_LABELS: Record<ReceiptCategory, string> = {
  incoming: DATEV_CATEGORY_LABELS.incoming,
  credit_card: DATEV_CATEGORY_LABELS.credit_card,
  cash: DATEV_CATEGORY_LABELS.cash,
  other: DATEV_CATEGORY_LABELS.other
}

/** Shown in this order */
export const RECEIPT_CATEGORIES: readonly ReceiptCategory[] = [
  'incoming',
  'credit_card',
  'cash',
  'other'
]

/** File types a receipt can come from; images become a PDF on the way in */
export const RECEIPT_FILE_TYPES = ['pdf', 'xml', 'jpg', 'jpeg', 'png'] as const

/** Where the file comes from: a dropped or picked path, or a mail attachment */
export const ReceiptSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), path: z.string().min(1) }),
  z.object({
    kind: z.literal('attachment'),
    accountId: z.string().min(1),
    messageId: z.number().int().positive(),
    partId: z.string().min(1),
    /** The mail's Message-ID, kept with the receipt */
    storeMessageId: z.string().nullable().optional()
  })
])
export type ReceiptSource = z.infer<typeof ReceiptSource>

/** DATEV state of a receipt: never handed over, a send waiting for confirmation, or sent */
// external (#246): uploaded to DATEV directly, not from here
export const ReceiptDatevState = z.enum(['none', 'pending', 'sent', 'external'])
export type ReceiptDatevState = z.infer<typeof ReceiptDatevState>

export const ReceiptDto = z.object({
  id: z.number(),
  companyId: z.number().nullable(),
  companyName: z.string(),
  category: ReceiptCategory,
  /** ISO date or null */
  receiptDate: z.string().nullable(),
  amountCents: z.number().nullable(),
  currency: z.string(),
  supplierCompanyId: z.number().nullable(),
  /** The linked company's name, else the name as typed */
  supplierName: z.string(),
  reference: z.string(),
  notes: z.string(),
  fileName: z.string(),
  fileSize: z.number(),
  fromMail: z.boolean(),
  /** #225 step 2: the trip it belongs to (it goes to DATEV inside the trip's report) */
  tripId: z.number().nullable(),
  /** The report of a trip itself */
  tripReport: z.boolean(),
  datev: ReceiptDatevState,
  /** When it went to DATEV (UTC timestamp), null if not yet */
  datevSentAt: z.string().nullable(),
  createdAt: z.string()
})
export type ReceiptDto = z.infer<typeof ReceiptDto>

export const PaginatedReceiptResponse = createPaginatedResponse(ReceiptDto)

export const ReceiptListInput = PaginationInput.extend({
  category: ReceiptCategory.optional(),
  /** Only receipts not handed to DATEV yet */
  notSent: z.boolean().optional()
})
export type ReceiptListInput = z.infer<typeof ReceiptListInput>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** The fields of a receipt the user fills in */
export const ReceiptFields = z.object({
  /** null: the default company */
  companyId: z.number().int().positive().nullable(),
  category: ReceiptCategory,
  receiptDate: z.string().regex(ISO_DATE, 'Datum im Format JJJJ-MM-TT').nullable(),
  amountCents: z.number().int().nullable(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, 'Währung mit 3 Buchstaben (z. B. EUR)')
    .default('EUR'),
  supplierCompanyId: z.number().int().positive().nullable(),
  supplierName: z.string().trim().default(''),
  reference: z.string().trim().default(''),
  notes: z.string().trim().default(''),
  /** The name DATEV shows; ".pdf" is added when missing */
  fileName: z.string().trim().min(1, 'Dateiname ist erforderlich'),
  /** #246: "Schon direkt in DATEV hochgeladen" */
  inDatev: z.boolean().default(false)
})
export type ReceiptFields = z.infer<typeof ReceiptFields>

export const CreateReceiptInput = ReceiptFields.extend({ source: ReceiptSource })
export type CreateReceiptInput = z.infer<typeof CreateReceiptInput>

export const UpdateReceiptInput = ReceiptFields.extend({ id: z.number().int().positive() })
export type UpdateReceiptInput = z.infer<typeof UpdateReceiptInput>

/** What reading a file suggests for a new receipt; e-invoices fill most of it */
export const ReceiptDraft = z.object({
  sourceName: z.string(),
  isEInvoice: z.boolean(),
  isImage: z.boolean(),
  /** Date, amount, number or supplier were guessed from a plain PDF's text: check them */
  readFromText: z.boolean(),
  /** The supplier's USt-IdNr. from the file, for "Als Firma anlegen" on a plain receipt */
  supplierVatId: z.string(),
  fields: ReceiptFields,
  /** The supplier as the e-invoice names it, for "create company" (#222) */
  supplierMatch: z.object({ id: z.number(), name: z.string() }).nullable()
})
export type ReceiptDraft = z.infer<typeof ReceiptDraft>

/** A receipt of a DATEV company not handed over yet (Dashboard) */
export const ReceiptPendingDto = z.object({
  id: z.number(),
  category: ReceiptCategory,
  receiptDate: z.string().nullable(),
  amountCents: z.number().nullable(),
  currency: z.string(),
  supplierName: z.string(),
  fileName: z.string()
})
export type ReceiptPendingDto = z.infer<typeof ReceiptPendingDto>
