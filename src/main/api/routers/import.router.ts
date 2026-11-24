import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { ImportService } from '../../services/ImportService'
import { SyncService } from '../../services/SyncService'
import { ImportRequest } from '../schemas/import.schema'
import { adminOnly } from '../access'

const t = initTRPC.create()
const service = container.resolve(ImportService)
// #262: the CSV import of master data is closed in staff access
const adminProcedure = t.procedure.use(t.middleware(adminOnly))

// The CSV file itself is read in main via the import:pickFile IPC
// handler; these procedures take its rows plus the user's column mapping
export const importRouter = t.router({
  preview: adminProcedure.input(ImportRequest).query(({ input }) => service.preview(input)),

  commit: adminProcedure.input(ImportRequest).mutation(({ input }) => {
    try {
      const result = service.commit(input)
      // #262: the employee's bridge sends the shared records with the next sync run
      if (input.shareWith !== null) container.resolve(SyncService).nudge()
      return result
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Import fehlgeschlagen'
      })
    }
  })
})
