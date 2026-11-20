import { z } from 'zod'
import { t } from '../../i18n/translate'

/**
 * DATEV hand-over of documents (Belege) to DATEV Unternehmen online by "DATEV Upload Mail":
 * each document is mailed, as a PDF and one per mail, to the upload address of the issuing
 * company's DATEV client (Mandant). The model is not invoice-specific on purpose: received
 * documents (Eingangsbelege) take the same path later.
 */

/**
 * A transfer is `pending` from just before the send until the mail is confirmed as sent
 * (right away, or later when an unclear send turns up in Sent), then `sent`
 */
export const DatevTransferStatus = z.enum(['pending', 'sent'])
export type DatevTransferStatus = z.infer<typeof DatevTransferStatus>

/**
 * The document category (Belegkategorie) of DATEV Upload Mail. DATEV gives each client one
 * upload address per category, and files a document by the address it arrived at.
 */
export const DatevCategory = z.enum(['outgoing', 'incoming', 'cash', 'other', 'credit_card'])
export type DatevCategory = z.infer<typeof DatevCategory>

/** The categories as DATEV names them */
export const DATEV_CATEGORY_LABELS: Record<DatevCategory, string> = {
  outgoing: t('Rechnungsausgang'),
  incoming: t('Rechnungseingang'),
  cash: t('Kasse'),
  other: t('Sonstige'),
  credit_card: t('Kreditkartenbelege')
}

/** Upload address per category, '' for none */
export const DatevUploadEmails = z.object({
  outgoing: z.string(),
  incoming: z.string(),
  cash: z.string(),
  other: z.string(),
  credit_card: z.string()
})
export type DatevUploadEmails = z.infer<typeof DatevUploadEmails>

export const DatevTransferDto = z.object({
  id: z.number(),
  /** The document: an issued invoice or a receipt (#225) */
  invoiceId: z.number().nullable(),
  receiptId: z.number().nullable(),
  status: DatevTransferStatus,
  /** The category it was filed under, by the address it went to */
  category: DatevCategory,
  /** The DATEV upload address it went to */
  to: z.string(),
  fileName: z.string(),
  /** When the send started (UTC `YYYY-MM-DD HH:MM:SS`) */
  createdAt: z.string(),
  /** When the send was confirmed, null while pending */
  sentAt: z.string().nullable()
})
export type DatevTransferDto = z.infer<typeof DatevTransferDto>

/** An issued invoice not yet handed to DATEV (Dashboard) */
export const DatevPendingInvoiceDto = z.object({
  id: z.number(),
  invoiceNumber: z.number(),
  kind: z.enum(['invoice', 'cancellation']),
  issueDate: z.string(),
  totalAmount: z.number(),
  currency: z.string(),
  recipientName: z.string()
})
export type DatevPendingInvoiceDto = z.infer<typeof DatevPendingInvoiceDto>

/** '' clears the address; anything else must be a mail address */
export const DatevUploadEmail = z.union([z.literal(''), z.email()])

export const SetDatevUploadEmailInput = z.object({
  companyId: z.number().int().positive(),
  /** Rechnungsausgang when not given */
  category: DatevCategory.default('outgoing'),
  datevUploadEmail: z.string().trim().pipe(DatevUploadEmail)
})
/** As callers pass it: the category may be left out */
export type SetDatevUploadEmailInput = z.input<typeof SetDatevUploadEmailInput>
