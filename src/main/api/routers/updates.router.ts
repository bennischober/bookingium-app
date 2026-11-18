import { initTRPC, TRPCError } from '@trpc/server'
import { checkForUpdates, installUpdateNow, updateStatus } from '../../app/updates'
import type { UpdateStatusDto } from '../schemas/updates.schema'

const t = initTRPC.create()

/** Einstellungen › Daten › "Version und Updates" (#49) */
export const updatesRouter = t.router({
  status: t.procedure.query((): UpdateStatusDto => updateStatus()),

  /** "Nach Updates suchen"; the outcome is in the returned status */
  check: t.procedure.mutation(async (): Promise<UpdateStatusDto> => {
    await checkForUpdates()
    return updateStatus()
  }),

  /** "Jetzt neu starten": installs the downloaded update and starts the new version */
  install: t.procedure.mutation(() => {
    try {
      installUpdateNow()
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Update kann nicht installiert werden'
      })
    }
  })
})
