import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'
import { container } from 'tsyringe'
import { SettlementService } from '../../services/SettlementService'
import { SaveSettlementInput } from '../schemas/settlement.schema'

const t = initTRPC.create()
const service = container.resolve(SettlementService)

const badRequest = (error: unknown, fallback: string): TRPCError =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error && error.message ? error.message : fallback
  })

const EventInput = z.object({ eventId: z.number().int().positive() })

/** #228: a show's settlement (Konzertabrechnung) and the management fee invoice from it */
export const settlementRouter = t.router({
  get: t.procedure.input(EventInput).query(({ input }) => {
    try {
      return service.get(input.eventId)
    } catch (error) {
      throw new TRPCError({ code: 'NOT_FOUND', message: (error as Error).message })
    }
  }),

  save: t.procedure.input(SaveSettlementInput).mutation(({ input }) => {
    try {
      return service.save(input)
    } catch (error) {
      throw badRequest(error, 'Abrechnung konnte nicht gespeichert werden')
    }
  }),

  /** Reads the promoter's sheet from a picked path; the dialog shows it before saving */
  readFile: t.procedure.input(z.object({ path: z.string().min(1) })).mutation(async ({ input }) => {
    try {
      return await service.readFile(input.path)
    } catch (error) {
      throw badRequest(error, 'Datei konnte nicht gelesen werden')
    }
  }),

  /** Keeps the promoter's file as a document of the event */
  attachFile: t.procedure
    .input(EventInput.extend({ path: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        await service.attachFile(input.eventId, input.path)
      } catch (error) {
        throw badRequest(error, 'Datei konnte nicht abgelegt werden')
      }
    }),

  createFeeInvoice: t.procedure.input(EventInput).mutation(({ input }) => {
    try {
      return { invoiceId: service.createFeeInvoice(input.eventId) }
    } catch (error) {
      throw badRequest(error, 'Managementbeteiligung konnte nicht erstellt werden')
    }
  })
})
