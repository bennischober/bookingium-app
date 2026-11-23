import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { app, BrowserWindow, dialog } from 'electron'
import { ArchiveImportService } from '../../services/ArchiveImportService'
import { adminOnly } from '../access'
import { ArchiveApplyInput, ArchivePreviewInput, ArchiveScanInput } from '../schemas/archive.schema'

const t = initTRPC.create()
const service = container.resolve(ArchiveImportService)
// #262: importing is closed in staff access, like the list import
const adminProcedure = t.procedure.use(t.middleware(adminOnly))

const badRequest = (error: unknown, fallback: string): TRPCError =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error && error.message ? error.message : fallback
  })

/** "Booking-Archiv einlesen" (Import menu): a band's old booking folders, many at once */
export const archiveRouter = t.router({
  /** Asks for the folder with the show folders (or one show folder) */
  chooseRoot: adminProcedure.mutation(async (): Promise<string | null> => {
    const owner = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Ordner mit den Booking-Ordnern wählen',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory']
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  }),

  scan: adminProcedure.input(ArchiveScanInput).mutation(async ({ input }) => {
    try {
      return await service.scan(input)
    } catch (error) {
      throw badRequest(error, 'Ordner konnte nicht gelesen werden')
    }
  }),

  preview: adminProcedure.input(ArchivePreviewInput).mutation(async ({ input }) => {
    try {
      return await service.preview(input)
    } catch (error) {
      throw badRequest(error, 'Show-Ordner konnte nicht gelesen werden')
    }
  }),

  apply: adminProcedure.input(ArchiveApplyInput).mutation(async ({ input }) => {
    try {
      return await service.apply(input)
    } catch (error) {
      throw badRequest(error, 'Übernahme fehlgeschlagen')
    }
  })
})
