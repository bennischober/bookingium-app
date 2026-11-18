import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { basename } from 'path'
import { container } from 'tsyringe'
import { InvoiceMapper } from '../api/mappers/invoice.mapper'
import type { FollowUpRecord } from '../api/schemas/followUp.schema'
import type { InvoiceEmailKind } from '../api/schemas/invoice.schema'
import type { EmailTemplate, EmailTemplateKind } from '../api/schemas/settings.schema'
import { createAppWindow } from '../app/windows'
import type { ComposeDraft, ComposeResult } from '../mail/composeWindow'
import {
  concertContractEmailData,
  contractEmail,
  managementContractEmailData,
  type ContractDocument,
  type ContractEmailData
} from '../mail/contractEmail'
import { datevMail, datevRefusal, sendDatevMail } from '../mail/datevSend'
import { DATEV_CATEGORY_LABELS, DatevCategory } from '../api/schemas/datev.schema'
import { saveEmailPdf } from '../mail/emailPdf'
import { invoiceEmail, type Lang } from '../mail/invoiceEmail'
import { invoiceComposes, type DocumentCompose } from '../mail/invoiceSend'
import { mailClient } from '../mailclient/MailClientService'
import { DatevService } from '../services/DatevService'
import { ContractService } from '../services/ContractService'
import { DealMemoService } from '../services/DealMemoService'
import { localIsoDate } from '../services/OpenItemsService'
import { InvoiceService } from '../services/InvoiceService'
import { MailTemplateService } from '../services/MailTemplateService'
import { ManagementContractService } from '../services/ManagementContractService'
import { SettingsService } from '../services/SettingsService'
import { failure } from './handlerUtils'
import { documentSender } from '../mail/documentSender'
import { documentPdf } from './print'

/**
 * "Per E-Mail senden" of the print pages: the window's PDF and a mail from the template,
 * opened in bookingum's compose window on the sending account (#136: the only way
 * invoices, reminders and contracts go out)
 */

/**
 * C1: opens bookingum's own editor for a prepared draft and resolves with what the
 * user did. Only this path knows whether the mail was really sent, so an invoice is
 * marked as emailed after a successful send - not when a window opens.
 *
 * I7 (MR-21): the window gets an opaque token, never the PDF's path. It sends through
 * mail.sendInvoice, where main attaches the PDF registered under that token; the token
 * is gone when the window closes. Not an IPC channel: only invoice:email and
 * contract:email (#120) open it.
 */
function openComposeWindow(input: {
  draft: ComposeDraft
  compose: DocumentCompose
  /** #121: where a "Wiedervorlage ohne Antwort" of this mail is filed */
  record: FollowUpRecord
}): Promise<ComposeResult> {
  const token = invoiceComposes.register(input.compose)
  const search = new URLSearchParams({
    account: input.compose.accountId,
    mode: 'compose',
    token,
    // base64 of the UTF-8 JSON: the JSON has characters that would break the URL fragment
    draft: Buffer.from(JSON.stringify(input.draft), 'utf8').toString('base64'),
    // the name only, for the attachment chip - the window never learns the path
    attachment: input.compose.fileName,
    record: `${input.record.type}:${input.record.id}`
  })
  return new Promise<ComposeResult>((resolve) => {
    const window = createAppWindow(
      { width: 900, height: 760, minWidth: 520, minHeight: 460 },
      `/mail/window?${search}`
    )
    // A window closed without a confirmed send means the user did not send
    window.on('closed', () => resolve(invoiceComposes.release(token)))
  })
}

/** #136: the fixed text of Einstellungen › E-Mail › E-Mail-Vorlagen, edited or default */
function mailTemplateText(kind: EmailTemplateKind, lang: 'de' | 'en'): EmailTemplate {
  return container.resolve(MailTemplateService).documentTemplate(kind, lang)
}

export function registerDocumentMailIpc(): void {
  /**
   * Writes the invoice PDF (with e-invoice) and opens the compose window with the mail from
   * the template, the PDF attached. The invoice is marked as emailed by the send itself
   * (mail.sendInvoice), or later, when an unclear send is confirmed - not here, where only
   * the window's end is known. `kind` reminder or dunning sends a Zahlungserinnerung or
   * Mahnung about an open invoice instead.
   */
  ipcMain.handle(
    'invoice:email',
    async (
      event,
      {
        invoiceId,
        fileName,
        lang,
        kind = 'invoice'
      }: { invoiceId: number; fileName: string; lang: Lang; kind?: InvoiceEmailKind }
    ) => {
      try {
        const invoiceService = container.resolve(InvoiceService)
        const entity = await invoiceService.getInvoicePrintData(invoiceId)
        if (!entity) return { success: false, error: 'Rechnung nicht gefunden' }
        const data = InvoiceMapper.toPrintDto(
          entity,
          entity.issuerSnapshot ?? null,
          entity.recipientSnapshot ?? null
        )
        if (kind !== 'invoice') invoiceService.assertRemindable(data.invoice)
        const settings = container.resolve(SettingsService).get()
        const sender = documentSender(settings)
        if ('error' in sender) return { success: false, ...sender }
        const draft = invoiceEmail(data, lang, mailTemplateText(kind, lang))
        const name = fileName.replace(/\.pdf$/i, '')
        const { pdf, eInvoice } = await documentPdf(event.sender, name, invoiceId)
        const pdfPath = await saveEmailPdf({ pdf, fileName: name })
        const composed = await openComposeWindow({
          draft,
          compose: {
            invoiceId,
            kind,
            accountId: sender.account.id,
            pdfPath,
            fileName: basename(pdfPath)
          },
          record: { type: 'invoice', id: invoiceId }
        })
        return { success: true, sent: composed.sent, eInvoice }
      } catch (error) {
        console.error('Error creating invoice email:', error)
        return failure(error)
      }
    }
  )

  /**
   * "An DATEV übergeben" of the invoice print page: the window's PDF (with e-invoice) mailed to
   * the DATEV Upload Mail address of the issuing company, from the invoice sending account.
   * No compose window - DATEV reads the attachment, not the letter (mail/datevSend.ts).
   */
  ipcMain.handle(
    'invoice:datev',
    async (
      event,
      {
        invoiceId,
        fileName,
        category = 'outgoing'
      }: { invoiceId: number; fileName: string; category?: DatevCategory }
    ) => {
      try {
        if (!DatevCategory.safeParse(category).success) {
          return { success: false, error: 'Unbekannte DATEV-Belegkategorie' }
        }
        const entity = await container.resolve(InvoiceService).getInvoicePrintData(invoiceId)
        if (!entity) return { success: false, error: 'Rechnung nicht gefunden' }
        const data = InvoiceMapper.toPrintDto(
          entity,
          entity.issuerSnapshot ?? null,
          entity.recipientSnapshot ?? null
        )
        const refusal = datevRefusal(data.invoice)
        if (refusal) return { success: false, error: refusal }
        const datev = container.resolve(DatevService)
        const to = await datev.uploadEmailOf(data.invoice.companyId, category)
        if (!to) {
          return {
            success: false,
            error: `Für ${data.invoice.companyName} ist keine DATEV-Adresse für „${DATEV_CATEGORY_LABELS[category]}“ hinterlegt.`,
            setup: 'datev' as const
          }
        }
        const sender = documentSender(container.resolve(SettingsService).get())
        if ('error' in sender) return { success: false, ...sender }
        const name = fileName.replace(/\.pdf$/i, '')
        const { pdf, eInvoice } = await documentPdf(event.sender, name, invoiceId)
        const sent = await sendDatevMail(
          {
            ledger: datev,
            send: (mail, accountId) =>
              mailClient.call('sendMail', [mail, null, accountId]) as Promise<{
                messageId: string
              }>
          },
          {
            invoiceId,
            category,
            accountId: sender.account.id,
            mail: datevMail({ data, to, fileName: `${name}.pdf`, pdf, sendKey: randomUUID() })
          }
        )
        return { success: true, to, category, messageId: sent.messageId, eInvoice }
      } catch (error) {
        console.error('Error handing an invoice to DATEV:', error)
        return failure(error)
      }
    }
  )

  /**
   * #120: a contract print page's mail, from the "Vertrag" template, opened in the compose
   * window like an invoice's. The recipient comes from the stored contract, not the renderer.
   * The contract has no email history; a sent concert contract only sets its event's
   * contract_sent_at (#201).
   */
  ipcMain.handle(
    'contract:email',
    async (
      event,
      {
        contract,
        id,
        fileName,
        lang
      }: { contract: ContractDocument; id: number; fileName: string; lang: Lang }
    ) => {
      try {
        const language: Lang = lang === 'en' ? 'en' : 'de'
        let data: ContractEmailData | null = null
        // #121: a concert contract's follow-up is on its event, a management contract's on the band
        let record: FollowUpRecord | null = null
        if (contract === 'management') {
          const print = await container.resolve(ManagementContractService).getPrintData(id)
          data = print ? managementContractEmailData(print) : null
          record = print ? { type: 'band', id: print.band.id } : null
        } else if (contract === 'concert') {
          const print = await container.resolve(ContractService).getContractData(id)
          data = print ? concertContractEmailData(print) : null
          record = { type: 'event', id }
        }
        if (!data || !record) return { success: false, error: 'Vertrag nicht gefunden' }
        const sender = documentSender(container.resolve(SettingsService).get())
        if ('error' in sender) return { success: false, ...sender }
        const draft = contractEmail(data, language, mailTemplateText('contract', language))
        const name = fileName.replace(/\.pdf$/i, '')
        const { pdf } = await documentPdf(event.sender, name)
        const pdfPath = await saveEmailPdf({ pdf, fileName: name, fallbackName: 'Vertrag' })
        const composed = await openComposeWindow({
          draft,
          compose: {
            contract: data.document,
            accountId: sender.account.id,
            pdfPath,
            fileName: basename(pdfPath)
          },
          record
        })
        // #201: a concert contract that really went out waits to come back signed
        if (composed.sent && contract === 'concert') {
          await container
            .resolve(DealMemoService)
            .updateDealMemo({ id, contractSentAt: localIsoDate() })
        }
        return { success: true, sent: composed.sent }
      } catch (error) {
        console.error('Error creating contract email:', error)
        return failure(error)
      }
    }
  )
}
