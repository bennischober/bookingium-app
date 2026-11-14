import { z } from 'zod'
import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { ExternalBookingService } from '../../services/ExternalBookingService'
import { PaginationInput } from '../schemas/base.schema'
import {
  ExternalBookingBandRangeInput,
  ExternalBookingImportRequest,
  ExternalBookingRangeInput
} from '../schemas/external_booking.schema'

const t = initTRPC.create()
const service = container.resolve(ExternalBookingService)

/**
 * #103: Agenturbuchungen. Read-only: no create or update procedure - rows come
 * from importing an agency's export (the file is picked via import:pickFile)
 * and can only be removed.
 */
export const externalBookingRouter = t.router({
  getAllPaginated: t.procedure
    .input(PaginationInput.extend({ agency: z.string().optional() }))
    .query(({ input }) => service.getAllPaginated(input)),

  listBetween: t.procedure
    .input(ExternalBookingRangeInput)
    .query(({ input }) => service.listBetween(input.from, input.to)),

  listForBand: t.procedure
    .input(ExternalBookingBandRangeInput)
    .query(({ input }) => service.listForBand(input.bandId, input.from, input.to)),

  agencies: t.procedure.query(() => service.agencies()),

  suggestImport: t.procedure
    .input(z.object({ headers: z.array(z.string()) }))
    .query(({ input }) => service.suggest(input.headers)),

  previewImport: t.procedure
    .input(ExternalBookingImportRequest)
    .query(({ input }) => service.preview(input)),

  commitImport: t.procedure.input(ExternalBookingImportRequest).mutation(({ input }) => {
    try {
      return service.commit(input)
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Import fehlgeschlagen'
      })
    }
  }),

  delete: t.procedure.input(z.number().int()).mutation(({ input }) => service.delete(input)),

  deleteAgency: t.procedure
    .input(z.string().min(1))
    .mutation(({ input }) => service.deleteAgency(input))
})
