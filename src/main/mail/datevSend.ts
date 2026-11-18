// Handing an invoice to DATEV Unternehmen online by "DATEV Upload Mail": the invoice PDF
// (with its e-invoice) is mailed to the upload address of the issuing company's DATEV client.
// DATEV files each mailed PDF as one document (Beleg), so every mail carries exactly one.
//
// No compose window: the mail is the app's own bookkeeping, not a letter, so it goes out from
// the invoice sending account (Einstellungen › E-Mail › Senden von) on one click. The send has
// the same exactly-once bookkeeping as an invoice mail (I7): recorded as pending before the
// send, marked sent once the server confirmed it - right away, or later, when an unclear send
// turns up in Sent.
//
// Pure apart from the injected deps (no Electron), so it can be unit tested.
import type { DraftInput, OpSummary } from '../mailclient/core/types'
import type { InvoicePrintDto } from '../api/schemas/invoice.schema'
import type { DatevCategory } from '../api/schemas/datev.schema'
import { formatMoney } from '../invoice/money'
import { fromCents } from '../einvoice/amounts'
import { formatDate } from './invoiceEmail'
import { bareMessageId, sendKeyOf, UNCLEAR } from './invoiceSend'

/** Why this invoice cannot go to DATEV yet, null when it can */
export function datevRefusal(invoice: InvoicePrintDto['invoice']): string | null {
  if (invoice.status === 'draft' || invoice.invoiceNumber === null) {
    return 'Ein Entwurf geht nicht an DATEV – die Rechnung zuerst stellen'
  }
  return null
}

/** "Rechnung 12 – Club XY", the subject DATEV keeps with the document */
export function datevSubject(data: InvoicePrintDto): string {
  const { invoice, recipient } = data
  const document = invoice.kind === 'cancellation' ? 'Stornorechnung' : 'Rechnung'
  const recipientName = recipient?.legalName || invoice.recipientName
  return [`${document} ${invoice.invoiceNumber ?? ''}`.trim(), recipientName]
    .filter(Boolean)
    .join(' – ')
}

/** The mail to the DATEV upload address: one PDF, a short text for whoever opens it there */
export function datevMail(input: {
  data: InvoicePrintDto
  to: string
  fileName: string
  pdf: Uint8Array
  sendKey: string
}): DraftInput {
  const { invoice } = input.data
  const amount = formatMoney(invoice.totalGrossAmount, invoice.currency, 'de-DE')
  const subject = datevSubject(input.data)
  return {
    to: [{ name: '', email: input.to }],
    cc: [],
    bcc: [],
    subject,
    bodyText: `${subject}\nRechnungsdatum: ${formatDate(invoice.issueDate)}\nBetrag: ${amount}\n`,
    bodyHtml: null,
    inReplyTo: null,
    references: [],
    attachments: [
      {
        filename: input.fileName,
        contentType: 'application/pdf',
        base64: Buffer.from(input.pdf).toString('base64')
      }
    ],
    sendKey: input.sendKey
  }
}

/** The receipt fields the DATEV mail names (#225) */
export type DatevReceipt = {
  categoryLabel: string
  receiptDate: string | null
  amountCents: number | null
  currency: string
  supplierName: string
  reference: string
}

/** "Rechnungseingang – Hotel Beispiel – RE-17", the subject DATEV keeps with a receipt */
export function receiptDatevSubject(receipt: DatevReceipt): string {
  return [receipt.categoryLabel, receipt.supplierName, receipt.reference]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' – ')
}

/** The mail carrying one receipt (#225): its file and a short text with what is known of it */
export function receiptDatevMail(input: {
  receipt: DatevReceipt
  to: string
  fileName: string
  contentType: string
  bytes: Uint8Array
  sendKey: string
}): DraftInput {
  const { receipt } = input
  const subject = receiptDatevSubject(receipt)
  const lines = [
    subject,
    receipt.receiptDate ? `Belegdatum: ${formatDate(receipt.receiptDate)}` : '',
    receipt.amountCents !== null
      ? `Betrag: ${formatMoney(fromCents(receipt.amountCents), receipt.currency, 'de-DE')}`
      : ''
  ].filter(Boolean)
  return {
    to: [{ name: '', email: input.to }],
    cc: [],
    bcc: [],
    subject,
    bodyText: `${lines.join('\n')}\n`,
    bodyHtml: null,
    inReplyTo: null,
    references: [],
    attachments: [
      {
        filename: input.fileName,
        contentType: input.contentType,
        base64: Buffer.from(input.bytes).toString('base64')
      }
    ],
    sendKey: input.sendKey
  }
}

/** The pending-transfer bookkeeping (DatevTransferRepository) */
export type DatevSendLedger = {
  addPending(input: {
    /** The document: an issued invoice or a receipt (#225), exactly one */
    invoiceId?: number
    receiptId?: number
    category: DatevCategory
    to: string
    fileName: string
    mailAccountId: string
    sendKey: string
  }): void
  dropPending(sendKey: string): void
  hasPending(mailAccountId: string): boolean
  confirm(sendKey: string, mailAccountId: string, messageId: string): number | null
}

/**
 * Sends one invoice to DATEV. Recorded as pending first, so an unclear send can still be
 * confirmed after a restart; a send refused before the server took it is forgotten again.
 */
export async function sendDatevMail(
  deps: {
    ledger: DatevSendLedger
    send: (mail: DraftInput, accountId: string) => Promise<{ messageId: string }>
  },
  input: {
    /** The document: an issued invoice or a receipt (#225), exactly one */
    invoiceId?: number
    receiptId?: number
    category: DatevCategory
    accountId: string
    mail: DraftInput
  }
): Promise<{ messageId: string }> {
  if ((input.invoiceId === undefined) === (input.receiptId === undefined)) {
    throw new Error('Eine Mail an DATEV trägt genau einen Beleg')
  }
  const sendKey = input.mail.sendKey
  if (!sendKey) throw new Error('Senden ohne Sendeschlüssel ist nicht möglich')
  const attachment = input.mail.attachments[0]
  if (input.mail.attachments.length !== 1 || !attachment?.base64) {
    throw new Error('Eine Mail an DATEV trägt genau ein PDF')
  }
  deps.ledger.addPending({
    invoiceId: input.invoiceId,
    receiptId: input.receiptId,
    category: input.category,
    to: input.mail.to.map((a) => a.email).join(', '),
    fileName: attachment.filename,
    mailAccountId: input.accountId,
    sendKey
  })
  let sent: { messageId: string }
  try {
    sent = await deps.send(input.mail, input.accountId)
  } catch (error) {
    // An unclear send stays pending - the startup probe or "Prüfen" may still find it in Sent
    const message = error instanceof Error ? error.message : String(error)
    if (!UNCLEAR.test(message)) deps.ledger.dropPending(sendKey)
    throw error
  }
  confirmDatevSend(deps.ledger, input.accountId, sent.messageId)
  return sent
}

function confirmDatevSend(ledger: DatevSendLedger, accountId: string, messageId: string): void {
  const sendKey = sendKeyOf(messageId)
  if (sendKey) ledger.confirm(sendKey, accountId, bareMessageId(messageId))
}

/**
 * A send op the core settled as delivered: if it was a DATEV mail that is still pending, it is
 * marked sent now (the counterpart of confirmInvoiceSendFromOp)
 */
export async function confirmDatevSendFromOp(
  deps: { ledger: DatevSendLedger; listOps: (accountId: string) => Promise<OpSummary[]> },
  event: { type?: string; accountId?: string; opId?: string; kind?: string; outcome?: string }
): Promise<void> {
  if (event.type !== 'op-event' || event.kind !== 'send') return
  if (event.outcome !== 'done' && event.outcome !== 'noop') return
  const accountId = event.accountId
  if (!accountId || !event.opId || !deps.ledger.hasPending(accountId)) return
  const op = (await deps.listOps(accountId)).find((o) => o.id === event.opId)
  if (op?.kind !== 'send' || !op.messageId) return
  confirmDatevSend(deps.ledger, accountId, op.messageId)
}
