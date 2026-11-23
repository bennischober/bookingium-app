import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { SyncService } from '../../services/SyncService'
import type {
  SyncBriefDto,
  SyncFolderDto,
  SyncJoinDto,
  SyncStatusDto
} from '../schemas/sync.schema'
import { adminOnly } from '../access'

const t = initTRPC.create()
// #262: setting up and leaving the sync is closed in staff access; status and "sync now" stay open
const adminProcedure = t.procedure.use(t.middleware(adminOnly))
const service = container.resolve(SyncService)

const badRequest = (error: unknown, fallback: string) =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error ? error.message : fallback
  })

const Folder = z.string().min(1).max(4096)

/** Einstellungen › Daten › "Abgleich mit anderen Computern" */
export const syncRouter = t.router({
  status: t.procedure.query((): Promise<SyncStatusDto> => service.status()),

  /** The top bar's indicator */
  brief: t.procedure.query((): Promise<SyncBriefDto> => service.brief()),

  /** Asks for the shared folder and says whether it starts a new sync or joins one */
  chooseFolder: adminProcedure.mutation(async (): Promise<SyncFolderDto | null> => {
    const owner = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Gemeinsamen Ordner für den Abgleich wählen (z. B. in OneDrive oder Google Drive)',
      defaultPath: app.getPath('home'),
      properties: ['openDirectory', 'createDirectory']
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    try {
      return await service.inspectFolder(result.filePaths[0])
    } catch (error) {
      throw badRequest(error, 'Ordner kann nicht verwendet werden')
    }
  }),

  /** The folder chosen before (the switch turned on again): set up there or join */
  inspectFolder: adminProcedure
    .input(Folder)
    .mutation(async ({ input }): Promise<SyncFolderDto> => {
      try {
        return await service.inspectFolder(input)
      } catch (error) {
        throw badRequest(error, 'Ordner kann nicht verwendet werden')
      }
    }),

  /** The first computer */
  setUp: adminProcedure.input(Folder).mutation(async ({ input }): Promise<SyncStatusDto> => {
    try {
      return await service.setUp(input)
    } catch (error) {
      throw badRequest(error, 'Abgleich konnte nicht eingerichtet werden')
    }
  }),

  /** A further computer: merges, backs up the current state, then restarts the app */
  join: adminProcedure.input(Folder).mutation(async ({ input }): Promise<SyncJoinDto> => {
    let result: SyncJoinDto
    try {
      result = await service.join(input)
    } catch (error) {
      throw badRequest(error, 'Beitreten fehlgeschlagen')
    }
    // Give the answer time to reach the renderer before the windows close
    setTimeout(() => {
      app.relaunch()
      app.quit()
    }, 1500)
    return result
  }),

  runNow: t.procedure.mutation(async (): Promise<SyncStatusDto> => {
    await service.run()
    return service.status()
  }),

  leave: adminProcedure.mutation((): Promise<SyncStatusDto> => service.leave()),

  // #243: an earlier entry of a computer that never wrote a change
  removeDevice: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }): Promise<SyncStatusDto> => {
      try {
        return await service.removeDevice(input.id)
      } catch (error) {
        throw badRequest(error, 'Eintrag konnte nicht entfernt werden')
      }
    }),

  openFolder: adminProcedure.mutation(async () => {
    const { folder } = service.readState()
    if (!folder) throw badRequest(null, 'Kein Ordner gewählt')
    const error = await shell.openPath(folder)
    if (error) throw badRequest(new Error(error), 'Ordner konnte nicht geöffnet werden')
  })
})
