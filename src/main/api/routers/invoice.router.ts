import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { InvoiceService } from '../../services/InvoiceService'
import { EInvoiceService } from '../../services/EInvoiceService'
import { mailClient } from '../../mailclient/MailClientService'
import type { MessageListItem } from '../../mailclient/core/types'
import { InvoiceMapper } from '../mappers/invoice.mapper'
import {
  CreateInvoiceInput,
  CreateInvoiceForDealMemoInput,
  PreviewInvoicePartiesInput,
  SetInvoiceStatusInput,
  UpdateInvoiceInput,
  UpsertCompanyInvoiceSettingsInput,
  type InvoiceEmailKind,
  type InvoiceMailDto
} from '../schemas/invoice.schema'
import { PaginationInput } from '../schemas/base.schema'

const t = initTRPC.create()
const invoiceService = container.resolve(InvoiceService)
const eInvoiceService = container.resolve(EInvoiceService)

export const invoiceRouter = t.router({
  getAllPaginated: t.procedure.input(PaginationInput).query(async ({ input }) => {
    const result = await invoiceService.getAllInvoicesPaginated(input)
    return {
      ...result,
      items: InvoiceMapper.toListItemDtoList(result.items)
    }
  }),

  getById: t.procedure.input(z.number()).query(async ({ input }) => {
    const entity = await invoiceService.getInvoiceById(input)
    if (!entity) throw new TRPCError({ code: 'NOT_FOUND' })
    return InvoiceMapper.toDto(entity)
  }),

  /**
   * C4: the invoice's own mails and the answers to them. Only the mails bookingum
   * sent carry a Message-ID; for the rest there is nothing to match a reply against,
   * so they are listed without one.
   */
  mails: t.procedure.input(z.number()).query(async ({ input }) => {
    const entity = await invoiceService.getInvoiceById(input)
    if (!entity) throw new TRPCError({ code: 'NOT_FOUND' })
    const sent = (entity.emails ?? []).filter((email) => email.message_id && email.mail_account_id)

    const replies = new Map<string, MessageListItem>()
    const byAccount = new Map<string, string[]>()
    for (const email of sent) {
      const account = email.mail_account_id as string
      const ids = byAccount.get(account) ?? []
      ids.push(email.message_id as string)
      byAccount.set(account, ids)
    }
    for (const [account, ids] of byAccount) {
      const found = (await mailClient
        .call('findReplies', [ids, account])
        .catch(() => [])) as MessageListItem[]
      // one mail can quote several invoice mails; it is still one reply
      for (const mail of found) replies.set(`${account}:${mail.id}`, mail)
    }

    const mails: InvoiceMailDto[] = []
    for (const email of entity.emails ?? []) {
      mails.push({
        role: 'sent',
        kind: email.kind as InvoiceEmailKind,
        sentAt: email.created_at,
        accountId: email.mail_account_id ?? null,
        messageId: email.message_id ?? null,
        storeId: null,
        subject: null,
        fromName: null,
        fromEmail: email.to,
        date: email.created_at,
        hasAttachments: false
      })
    }
    for (const item of replies.values()) {
      mails.push({
        role: 'reply',
        // an answer is not one of the invoice's own sends
        kind: null,
        sentAt: null,
        accountId: null,
        messageId: item.messageId,
        storeId: item.id,
        subject: item.subject,
        fromName: item.fromName,
        fromEmail: item.fromEmail,
        date: item.date,
        hasAttachments: item.hasAttachments
      })
    }
    return {
      mails,
      answered: replies.size > 0
    }
  }),

  getPrintData: t.procedure.input(z.number()).query(async ({ input }) => {
    const entity = await invoiceService.getInvoicePrintData(input)
    if (!entity) throw new TRPCError({ code: 'NOT_FOUND' })
    return InvoiceMapper.toPrintDto(
      entity,
      entity.issuerSnapshot ?? null,
      entity.recipientSnapshot ?? null
    )
  }),

  /** E-invoice state of an invoice: ready, or what is missing (print page) */
  eInvoiceCheck: t.procedure.input(z.number()).query(async ({ input }) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { xml, ...check } = await eInvoiceService.check(input)
    return check
  }),

  /** Issuer and recipient as the form's choice would freeze them (e-invoice check) */
  previewParties: t.procedure.input(PreviewInvoicePartiesInput).query(({ input }) => {
    try {
      return eInvoiceService.previewParties(input)
    } catch {
      return null
    }
  }),

  getByDealMemoId: t.procedure.input(z.number()).query(async ({ input }) => {
    const entities = await invoiceService.getInvoicesByDealMemoId(input)
    return InvoiceMapper.toListItemDtoList(entities)
  }),

  /** Invoices a company issued or received (company page) */
  listByCompany: t.procedure.input(z.number()).query(async ({ input }) => {
    return InvoiceMapper.toListItemDtoList(await invoiceService.listInvoicesByCompany(input))
  }),

  /** Overdue invoices to chase, with their reminders (Dashboard); input: local today */
  listOverdue: t.procedure
    .input(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .query(async ({ input }) => {
      const entities = await invoiceService.listOverdueInvoices(input)
      return entities.map((entity) => InvoiceMapper.toOverdueDto(entity))
    }),

  /** Invoices addressed to a person (person page) */
  listByPerson: t.procedure.input(z.number()).query(async ({ input }) => {
    return InvoiceMapper.toListItemDtoList(
      await invoiceService.listInvoicesByRecipientPerson(input)
    )
  }),

  create: t.procedure.input(CreateInvoiceInput).mutation(async ({ input }) => {
    try {
      const entity = await invoiceService.createInvoice(input)
      return InvoiceMapper.toDto(entity)
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to create invoice'
      })
    }
  }),

  createForDealMemo: t.procedure
    .input(CreateInvoiceForDealMemoInput)
    .mutation(async ({ input }) => {
      try {
        const entity = await invoiceService.createInvoiceForDealMemo(input)
        return InvoiceMapper.toDto(entity)
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to create invoice'
        })
      }
    }),

  update: t.procedure.input(UpdateInvoiceInput).mutation(async ({ input }) => {
    try {
      const entity = await invoiceService.updateInvoice(input)
      return InvoiceMapper.toDto(entity)
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to update invoice'
      })
    }
  }),

  setStatus: t.procedure.input(SetInvoiceStatusInput).mutation(async ({ input }) => {
    try {
      const entity = await invoiceService.setInvoiceStatus(input.id, input.status)
      return InvoiceMapper.toDto(entity)
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to change invoice status'
      })
    }
  }),

  delete: t.procedure.input(z.number()).mutation(async ({ input }) => {
    try {
      await invoiceService.deleteInvoice(input)
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Failed to delete invoice'
      })
    }
  }),

  getCompanySettings: t.procedure.input(z.number()).query(async ({ input }) => {
    const settings = await invoiceService.getCompanyInvoiceSettings(input)
    return settings ? InvoiceMapper.toSettingsDto(settings) : null
  }),

  upsertCompanySettings: t.procedure
    .input(UpsertCompanyInvoiceSettingsInput)
    .mutation(async ({ input }) => {
      const settings = await invoiceService.upsertCompanyInvoiceSettings(input)
      return InvoiceMapper.toSettingsDto(settings)
    })
})
