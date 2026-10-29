import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { ImportService } from '../../services/ImportService'
import { ImportRequest } from '../schemas/import.schema'

const t = initTRPC.create()
const service = container.resolve(ImportService)

// The CSV file itself is read in main via the import:pickFile IPC
// handler; these procedures take its rows plus the user's column mapping
export const importRouter = t.router({
  preview: t.procedure.input(ImportRequest).query(({ input }) => service.preview(input)),

  commit: t.procedure.input(ImportRequest).mutation(({ input }) => {
    try {
      return service.commit(input)
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Import fehlgeschlagen'
      })
    }
  })
})
