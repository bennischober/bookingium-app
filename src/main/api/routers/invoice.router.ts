import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { InvoiceService } from '../../services/InvoiceService'
import { EInvoiceService } from '../../services/EInvoiceService'
import { InvoiceMapper } from '../mappers/invoice.mapper'
import {
  CreateInvoiceInput,
  CreateInvoiceForDealMemoInput,
  PreviewInvoicePartiesInput,
  SetInvoiceStatusInput,
  UpdateInvoiceInput,
  UpsertCompanyInvoiceSettingsInput
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
