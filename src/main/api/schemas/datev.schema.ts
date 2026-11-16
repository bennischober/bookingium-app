import { z } from 'zod'

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

export const DatevTransferDto = z.object({
  id: z.number(),
  invoiceId: z.number(),
  status: DatevTransferStatus,
  /** The DATEV upload address it went to */
  to: z.string(),
  fileName: z.string(),
  /** When the send started (UTC `YYYY-MM-DD HH:MM:SS`) */
  createdAt: z.string(),
  /** When the send was confirmed, null while pending */
  sentAt: z.string().nullable()
})
export type DatevTransferDto = z.infer<typeof DatevTransferDto>

/** '' clears the address; anything else must be a mail address */
export const DatevUploadEmail = z.union([z.literal(''), z.email()])

export const SetDatevUploadEmailInput = z.object({
  companyId: z.number().int().positive(),
  datevUploadEmail: z.string().trim().pipe(DatevUploadEmail)
})
export type SetDatevUploadEmailInput = z.infer<typeof SetDatevUploadEmailInput>
