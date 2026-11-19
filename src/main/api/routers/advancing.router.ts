import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'
import { container } from 'tsyringe'
import { AdvancingService } from '../../services/AdvancingService'
import {
  LocalContactFromMailInput,
  MailShowsInput,
  SaveAdvancingInput,
  SetStageInput,
  SaveTicketQuotaInput,
  SaveTicketReportInput,
  TourOverviewInput
} from '../schemas/advancing.schema'

const t = initTRPC.create()
const service = container.resolve(AdvancingService)

const badRequest = (error: unknown, fallback: string): TRPCError =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error && error.message ? error.message : fallback
  })

/** #232: advancing and ticket quota of a show, and the tour overview */
export const advancingRouter = t.router({
  get: t.procedure.input(z.object({ eventId: z.number().int().positive() })).query(({ input }) => {
    try {
      return service.get(input.eventId)
    } catch (error) {
      throw new TRPCError({ code: 'NOT_FOUND', message: (error as Error).message })
    }
  }),

  save: t.procedure.input(SaveAdvancingInput).mutation(({ input }) => {
    try {
      return service.saveAdvancing(input)
    } catch (error) {
      throw badRequest(error, 'Advancing konnte nicht gespeichert werden')
    }
  }),

  saveQuota: t.procedure.input(SaveTicketQuotaInput).mutation(({ input }) => {
    try {
      return service.saveQuota(input)
    } catch (error) {
      throw badRequest(error, 'Kontingent konnte nicht gespeichert werden')
    }
  }),

  saveReport: t.procedure.input(SaveTicketReportInput).mutation(({ input }) => {
    try {
      return service.saveReport(input)
    } catch (error) {
      throw badRequest(error, 'Verkaufsmeldung konnte nicht gespeichert werden')
    }
  }),

  deleteReport: t.procedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => service.deleteReport(input.id)),

  tour: t.procedure.input(TourOverviewInput).query(({ input }) => service.tour(input)),

  /** #235: the shows a mail belongs to, with what it suggests */
  forMail: t.procedure.input(MailShowsInput).query(({ input }) => service.forMail(input)),

  setStage: t.procedure.input(SetStageInput).mutation(({ input }) => {
    try {
      return service.setStage(input)
    } catch (error) {
      throw badRequest(error, 'Advancing konnte nicht gespeichert werden')
    }
  }),

  localContactFromMail: t.procedure.input(LocalContactFromMailInput).mutation(({ input }) => {
    try {
      return service.localContactFromMail(input)
    } catch (error) {
      throw badRequest(error, 'Kontakt vor Ort konnte nicht übernommen werden')
    }
  })
})
