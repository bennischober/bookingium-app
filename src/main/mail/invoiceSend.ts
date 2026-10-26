// I7: sending an invoice from bookingum's own editor.
//
// The compose window never sees a file path. The invoice:email handler registers what the
// window is for under an opaque token; the window sends through main with that token, and
// main reads the PDF it registered and attaches it. The invoice counts as emailed once the
// send is confirmed - by the send itself, or later, when an unclear send turns up in Sent.
import { randomUUID } from 'crypto'
import { sendRefusal, writeRefusal, type WriteAccount } from '../mailclient/core/write_guard'
import type { DraftInput, OpSummary } from '../mailclient/core/types'
import type { MailAccountDto } from '../mailclient/accounts'
import type { InvoiceEmailKind } from '../api/schemas/invoice.schema'
import type { ComposeResult } from './composeWindow'

/** I7: what one compose window was opened for */
export type InvoiceCompose = {
  invoiceId: number
  kind: InvoiceEmailKind
  accountId: string
  pdfPath: string
  /** The attachment's name, which is all the window learns about the file */
  fileName: string
}

function toWriteAccount(account: MailAccountDto): WriteAccount {
  return {
    id: account.id,
    kind: account.kind,
    imapHost: account.host,
    imapPort: account.port,
    security: account.security,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    smtpSecurity: account.smtpSecurity,
    email: account.email,
    canary: account.canary
  }
}

/**
 * I7 (MR-12): the account an invoice goes out from is the one chosen in Einstellungen ›
 * E-Mail, never the first one that happens to be writable. Fails closed: no choice, a
 * deleted account, or one the write guard would refuse, and nothing is opened.
 */
export function invoiceSendAccount(
  accountId: string,
  accounts: readonly MailAccountDto[],
  to: string
): { account: MailAccountDto } | { error: string } {
  if (!accountId) {
    return { error: 'Kein Absenderkonto gewählt (Einstellungen › E-Mail › Senden von)' }
  }
  const account = accounts.find((a) => a.id === accountId)
  if (!account) return { error: 'Das gewählte Absenderkonto gibt es nicht mehr' }
  const write = toWriteAccount(account)
  const refusal = writeRefusal(write) ?? sendRefusal(write, to ? [to] : [])
  return refusal ? { error: refusal } : { account }
}

/** The send key of a Message-ID: the core builds it as `<sendKey@domain>` */
export function sendKeyOf(messageId: string): string {
  const bare = bareMessageId(messageId)
  const at = bare.lastIndexOf('@')
  return at > 0 ? bare.slice(0, at) : ''
}

function bareMessageId(messageId: string): string {
  return messageId.trim().replace(/^</, '').replace(/>$/, '')
}

/**
 * I7 (MR-21): the open compose windows, by token. A token is only ever created by the
 * invoice:email handler and is gone when its window closes, so the renderer cannot make
 * main read a file it chose.
 */
export function createInvoiceComposeRegistry(newToken: () => string = randomUUID) {
  const entries = new Map<
    string,
    InvoiceCompose & { sendKeys: Set<string>; messageId: string | null }
  >()
  return {
    register(compose: InvoiceCompose): string {
      const token = newToken()
      entries.set(token, { ...compose, sendKeys: new Set(), messageId: null })
      return token
    },
    /** The window's compose, only for the account it was opened with */
    get(token: string, accountId: string): InvoiceCompose | undefined {
      const entry = entries.get(token)
      return entry && entry.accountId === accountId ? entry : undefined
    },
    /** A send of this window is starting under this key */
    noteSend(token: string, sendKey: string): void {
      entries.get(token)?.sendKeys.add(sendKey)
    },
    /** A send was confirmed; the window that made it reports it when it closes */
    confirmed(sendKey: string, messageId: string): void {
      for (const entry of entries.values()) {
        if (entry.sendKeys.has(sendKey)) entry.messageId = messageId
      }
    },
    /** The window closed: forget the token and say whether its mail went out */
    release(token: string): ComposeResult {
      const entry = entries.get(token)
      entries.delete(token)
      return entry?.messageId ? { sent: true, messageId: entry.messageId } : { sent: false }
    }
  }
}

export type InvoiceComposeRegistry = ReturnType<typeof createInvoiceComposeRegistry>

/** The one registry of the running app */
export const invoiceComposes = createInvoiceComposeRegistry()

/** The pending-send bookkeeping (InvoiceService) */
export type InvoiceSendLedger = {
  queueInvoiceEmail(input: {
    invoiceId: number
    kind: InvoiceEmailKind
    to: string
    mailAccountId: string
    sendKey: string
  }): void
  dropQueuedInvoiceEmail(sendKey: string): void
  hasQueuedInvoiceEmails(mailAccountId: string): boolean
  confirmInvoiceEmail(sendKey: string, mailAccountId: string, messageId: string): number | null
}

/** The core's wording for a send whose outcome it cannot know (core/index.ts sendMail) */
const UNCLEAR = /Versand unklar/

/**
 * I7: sends the invoice mail of a compose window. Main attaches the PDF it registered;
 * a PDF that cannot be read stops the send (MR-14) instead of mailing an invoice without
 * its invoice. The send is recorded as pending first, so an unclear one can still be
 * confirmed after the window closed or the app restarted.
 */
export async function sendInvoiceMail(
  deps: {
    registry: InvoiceComposeRegistry
    ledger: InvoiceSendLedger
    readPdf: (path: string) => Promise<Uint8Array>
    send: (
      mail: DraftInput,
      draftUid: number | null,
      accountId: string
    ) => Promise<{ messageId: string }>
  },
  input: { token: string; accountId: string; draftUid: number | null; mail: DraftInput }
): Promise<{ messageId: string }> {
  const compose = deps.registry.get(input.token, input.accountId)
  if (!compose) throw new Error('Diese E-Mail gehört zu keiner geöffneten Rechnung mehr')
  const sendKey = input.mail.sendKey
  if (!sendKey) throw new Error('Senden ohne Sendeschlüssel ist nicht möglich')
  let pdf: Uint8Array
  try {
    pdf = await deps.readPdf(compose.pdfPath)
  } catch {
    throw new Error('Rechnungs-PDF fehlt. Bitte „Per E-Mail senden“ erneut aufrufen.')
  }
  if (pdf.byteLength === 0) {
    throw new Error('Rechnungs-PDF ist leer. Bitte „Per E-Mail senden“ erneut aufrufen.')
  }
  const mail: DraftInput = {
    ...input.mail,
    attachments: [
      ...(input.mail.attachments ?? []),
      {
        filename: compose.fileName,
        contentType: 'application/pdf',
        base64: Buffer.from(pdf).toString('base64')
      }
    ]
  }
  deps.ledger.queueInvoiceEmail({
    invoiceId: compose.invoiceId,
    kind: compose.kind,
    to: mail.to.map((a) => a.email).join(', '),
    mailAccountId: input.accountId,
    sendKey
  })
  deps.registry.noteSend(input.token, sendKey)
  let sent: { messageId: string }
  try {
    sent = await deps.send(mail, input.draftUid, input.accountId)
  } catch (error) {
    // Refused before the server took it: this key will never be confirmed. An unclear
    // send stays pending - the startup probe or "Prüfen" may still find it in Sent.
    const message = error instanceof Error ? error.message : String(error)
    if (!UNCLEAR.test(message)) deps.ledger.dropQueuedInvoiceEmail(sendKey)
    throw error
  }
  confirmInvoiceSend(deps, input.accountId, sent.messageId)
  return sent
}

function confirmInvoiceSend(
  deps: { registry: InvoiceComposeRegistry; ledger: InvoiceSendLedger },
  accountId: string,
  messageId: string
): void {
  const sendKey = sendKeyOf(messageId)
  if (!sendKey) return
  const bare = bareMessageId(messageId)
  deps.ledger.confirmInvoiceEmail(sendKey, accountId, bare)
  deps.registry.confirmed(sendKey, bare)
}

/**
 * I7 (H3): a send op the core settled as delivered - the send itself, the startup probe
 * of an unclear send, or "Prüfen". If it was an invoice mail that is still pending, the
 * invoice is marked now, even though its window is long closed.
 */
export async function confirmInvoiceSendFromOp(
  deps: {
    registry: InvoiceComposeRegistry
    ledger: InvoiceSendLedger
    listOps: (accountId: string) => Promise<OpSummary[]>
  },
  event: { type?: string; accountId?: string; opId?: string; kind?: string; outcome?: string }
): Promise<void> {
  if (event.type !== 'op-event' || event.kind !== 'send') return
  if (event.outcome !== 'done' && event.outcome !== 'noop') return
  const accountId = event.accountId
  if (!accountId || !event.opId || !deps.ledger.hasQueuedInvoiceEmails(accountId)) return
  const op = (await deps.listOps(accountId)).find((o) => o.id === event.opId)
  if (op?.kind !== 'send' || !op.messageId) return
  confirmInvoiceSend(deps, accountId, op.messageId)
}
