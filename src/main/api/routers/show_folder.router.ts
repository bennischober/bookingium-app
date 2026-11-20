import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { ShowFolderService } from '../../services/ShowFolderService'
import { ShowFolderAnalyzeInput, ShowFolderApplyInput } from '../schemas/show_folder.schema'

const t = initTRPC.create()
const service = container.resolve(ShowFolderService)

const badRequest = (error: unknown, fallback: string): TRPCError =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error && error.message ? error.message : fallback
  })

/** "Show-Ordner einlesen" on the event page: read the files, then apply what was ticked */
export const showFolderRouter = t.router({
  analyze: t.procedure.input(ShowFolderAnalyzeInput).mutation(async ({ input }) => {
    try {
      return await service.analyze(input)
    } catch (error) {
      throw badRequest(error, 'Show-Ordner konnte nicht gelesen werden')
    }
  }),

  apply: t.procedure.input(ShowFolderApplyInput).mutation(async ({ input }) => {
    try {
      return await service.apply(input)
    } catch (error) {
      throw badRequest(error, 'Übernahme fehlgeschlagen')
    }
  })
})
