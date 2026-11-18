import { initTRPC, TRPCError } from '@trpc/server'
import { randomUUID } from 'crypto'
import { shell } from 'electron'
import { z } from 'zod'
import { container } from 'tsyringe'
import { ReceiptService } from '../../services/ReceiptService'
import { DatevService } from '../../services/DatevService'
import { SettingsService } from '../../services/SettingsService'
import { documentSender } from '../../mail/documentSender'
import { receiptDatevMail, sendDatevMail } from '../../mail/datevSend'
import { mailClient } from '../../mailclient/MailClientService'
import { ReceiptMapper } from '../mappers/receipt.mapper'
import { DatevMapper } from '../mappers/datev.mapper'
import { attachmentFileName, readSourceFile } from '../sourceFiles'
import {
  CreateReceiptInput,
  RECEIPT_CATEGORY_LABELS,
  RECEIPT_FILE_TYPES,
  ReceiptListInput,
  ReceiptSource,
  UpdateReceiptInput
} from '../schemas/receipt.schema'
import { DATEV_CATEGORY_LABELS } from '../schemas/datev.schema'

const t = initTRPC.create()
const service = container.resolve(ReceiptService)
const datev = container.resolve(DatevService)

const WRONG_TYPE = 'Belege können PDF-, XML-, JPG- oder PNG-Dateien sein.'

const badRequest = (error: unknown, fallback: string): TRPCError =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error && error.message ? error.message : fallback
  })

const IdInput = z.object({ id: z.number().int().positive() })

function requireReceipt(id: number) {
  const row = service.getById(id)
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Beleg nicht gefunden' })
  return row
}

/** #225: received documents (Belege) and their hand-over to DATEV */
export const receiptRouter = t.router({
  list: t.procedure.input(ReceiptListInput).query(({ input }) => {
    const result = service.list(input)
    return {
      ...result,
      items: result.items.map((row) => ReceiptMapper.toDto(row)),
      totalPages: Math.ceil(result.total / result.pageSize)
    }
  }),

  getById: t.procedure
    .input(IdInput)
    .query(({ input }) => ReceiptMapper.toDto(requireReceipt(input.id))),

  /** Receipts of DATEV companies not handed over yet, oldest first (Dashboard) */
  listNotHandedOver: t.procedure.query(() =>
    service.listNotHandedOver().map((row) => ReceiptMapper.toPendingDto(row))
  ),

  /** A receipt's hand-overs to DATEV, newest first */
  listTransfers: t.procedure
    .input(IdInput)
    .query(({ input }) =>
      service.listTransfers(input.id).map((row) => DatevMapper.toTransferDto(row))
    ),

  /** What a file suggests for a new receipt; nothing is stored yet */
  read: t.procedure.input(ReceiptSource).mutation(async ({ input }) => {
    const { bytes, fileName } = await readSourceFile(input, RECEIPT_FILE_TYPES, WRONG_TYPE)
    try {
      return await service.read(bytes, fileName || (await attachmentFileName(input)))
    } catch (error) {
      throw badRequest(error, 'Datei konnte nicht gelesen werden')
    }
  }),

  /** Stores the file (photos as PDF) with the confirmed fields */
  create: t.procedure.input(CreateReceiptInput).mutation(async ({ input }) => {
    const { source, ...fields } = input
    const { bytes } = await readSourceFile(source, RECEIPT_FILE_TYPES, WRONG_TYPE)
    try {
      const id = await service.create(
        fields,
        bytes,
        source.kind === 'attachment'
          ? { messageId: source.storeMessageId ?? null, mailAccountId: source.accountId }
          : null
      )
      return ReceiptMapper.toDto(requireReceipt(id))
    } catch (error) {
      throw badRequest(error, 'Beleg konnte nicht gespeichert werden')
    }
  }),

  update: t.procedure.input(UpdateReceiptInput).mutation(({ input }) => {
    requireReceipt(input.id)
    service.update(input)
    return ReceiptMapper.toDto(requireReceipt(input.id))
  }),

  /** The file goes to the OS trash (recoverable), then the record */
  delete: t.procedure.input(IdInput).mutation(async ({ input }) => {
    requireReceipt(input.id)
    const path = await service.filePath(input.id)
    if (path) {
      try {
        await shell.trashItem(path)
      } catch (error) {
        throw badRequest(error, 'Datei konnte nicht in den Papierkorb verschoben werden')
      }
    }
    service.deleteRecord(input.id)
  }),

  open: t.procedure.input(IdInput).mutation(async ({ input }) => {
    const path = await service.filePath(input.id)
    if (!path) throw new TRPCError({ code: 'NOT_FOUND', message: 'Die Datei fehlt.' })
    const error = await shell.openPath(path)
    if (error) throw badRequest(new Error(error), 'Datei konnte nicht geöffnet werden')
  }),

  showInFolder: t.procedure.input(IdInput).mutation(async ({ input }) => {
    const path = await service.filePath(input.id)
    if (!path) throw new TRPCError({ code: 'NOT_FOUND', message: 'Die Datei fehlt.' })
    shell.showItemInFolder(path)
  }),

  /**
   * Mails the receipt to the DATEV Upload Mail address of its company for its category, from
   * the invoice sending account; the same exactly-once bookkeeping as invoices
   * (mail/datevSend.ts). `setup` names what is missing for the UI to point at.
   */
  sendToDatev: t.procedure.input(IdInput).mutation(async ({ input }) => {
    const row = requireReceipt(input.id)
    const receipt = ReceiptMapper.toDto(row)
    if (receipt.companyId === null) {
      return {
        success: false as const,
        error: 'Der Beleg gehört zu keiner eigenen Firma. Bitte eine Firma wählen.',
        setup: null
      }
    }
    const to = await datev.uploadEmailOf(receipt.companyId, receipt.category)
    if (!to) {
      return {
        success: false as const,
        error: `Für ${receipt.companyName || 'diese Firma'} ist keine DATEV-Adresse für „${DATEV_CATEGORY_LABELS[receipt.category]}“ hinterlegt.`,
        setup: 'datev' as const
      }
    }
    const sender = documentSender(container.resolve(SettingsService).get())
    if ('error' in sender)
      return { success: false as const, error: sender.error, setup: 'mail' as const }
    try {
      const file = await service.fileBytes(input.id)
      const sent = await sendDatevMail(
        {
          ledger: datev,
          send: (mail, accountId) =>
            mailClient.call('sendMail', [mail, null, accountId]) as Promise<{ messageId: string }>
        },
        {
          receiptId: input.id,
          category: receipt.category,
          accountId: sender.account.id,
          mail: receiptDatevMail({
            receipt: {
              categoryLabel: RECEIPT_CATEGORY_LABELS[receipt.category],
              receiptDate: receipt.receiptDate,
              amountCents: receipt.amountCents,
              currency: receipt.currency,
              supplierName: receipt.supplierName,
              reference: receipt.reference
            },
            to,
            fileName: receipt.fileName,
            contentType: file.contentType,
            bytes: file.bytes,
            sendKey: randomUUID()
          })
        }
      )
      return { success: true as const, to, messageId: sent.messageId }
    } catch (error) {
      throw badRequest(error, 'Beleg konnte nicht an DATEV übergeben werden')
    }
  })
})
