import { z } from 'zod'
import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { TourImportService } from '../../services/TourImportService'
import { TourImportRequest } from '../schemas/tour_import.schema'

const t = initTRPC.create()
const service = container.resolve(TourImportService)

/** Tour import (Tourdaten): own events from a tour sheet; the file is picked via import:pickFile */
export const tourImportRouter = t.router({
  /** The columns, tour and defaults for a picked file: remembered for its layout, else detected */
  suggest: t.procedure
    .input(z.object({ headers: z.array(z.string()) }))
    .query(({ input }) => service.suggest(input.headers)),

  preview: t.procedure.input(TourImportRequest).query(({ input }) => service.preview(input)),

  commit: t.procedure.input(TourImportRequest).mutation(({ input }) => {
    try {
      return service.commit(input)
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Import fehlgeschlagen'
      })
    }
  }),

  /** The tours the events name, for the filters */
  tours: t.procedure.query(() => service.tours())
})
