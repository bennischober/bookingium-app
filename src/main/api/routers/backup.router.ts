import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { BackupService } from '../../services/BackupService'
import type { BackupStatusDto, PreparedRestoreDto } from '../schemas/backup.schema'

const t = initTRPC.create()
const service = container.resolve(BackupService)

const badRequest = (error: unknown, fallback: string) =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error ? error.message : fallback
  })

async function pickFolder(title: string, defaultPath: string): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow()
  const options: Electron.OpenDialogOptions = {
    title,
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  }
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

/** Einstellungen › Daten › "Automatische Sicherung" and "Sicherung wiederherstellen…" */
export const backupRouter = t.router({
  status: t.procedure.query((): BackupStatusDto => service.status()),

  /** Asks for the target folder; choosing one switches automatic backups on */
  chooseFolder: t.procedure.mutation(async (): Promise<BackupStatusDto> => {
    const current = service.status().folder
    const folder = await pickFolder(
      'Ordner für automatische Sicherungen wählen',
      current || app.getPath('documents')
    )
    if (!folder) return service.status()
    try {
      service.setFolder(folder)
    } catch (error) {
      throw badRequest(error, 'Ordner kann nicht verwendet werden')
    }
    // The first backup right away when none is recent; it runs on in the background
    void service.runIfDue()
    return service.status()
  }),

  setEnabled: t.procedure.input(z.boolean()).mutation(({ input }): BackupStatusDto => {
    try {
      service.setEnabled(input)
      if (input) void service.runIfDue()
      return service.status()
    } catch (error) {
      throw badRequest(error, 'Einstellung konnte nicht gespeichert werden')
    }
  }),

  /** "Jetzt sichern"; the outcome is in the returned status */
  runNow: t.procedure.mutation(async (): Promise<BackupStatusDto> => {
    await service.run()
    return service.status()
  }),

  openFolder: t.procedure.mutation(async () => {
    const { folder } = service.status()
    if (!folder) throw badRequest(null, 'Kein Ordner gewählt')
    const error = await shell.openPath(folder)
    if (error) throw badRequest(new Error(error), 'Ordner konnte nicht geöffnet werden')
  }),

  /** Asks for a backup folder, copies and checks it; nothing is replaced yet */
  pickRestore: t.procedure.mutation(async (): Promise<PreparedRestoreDto> => {
    const folder = await pickFolder(
      'Sicherung zum Wiederherstellen wählen',
      service.status().folder || app.getPath('documents')
    )
    if (!folder) return { canceled: true, folder: null, backupCreatedAt: null, hasStorage: false }
    try {
      const prepared = await service.prepareRestore(folder)
      return {
        canceled: false,
        folder: prepared.source,
        backupCreatedAt: prepared.backupCreatedAt,
        hasStorage: prepared.hasStorage
      }
    } catch (error) {
      throw badRequest(error, 'Sicherung kann nicht wiederhergestellt werden')
    }
  }),

  cancelRestore: t.procedure.mutation(() => service.cancelRestore()),

  /**
   * After the user confirmed: backs up the current state, stages the restore and restarts the
   * app, which applies it before the database opens
   */
  confirmRestore: t.procedure.mutation(async () => {
    let result: { beforeRestoreFolder: string }
    try {
      result = await service.confirmRestore()
    } catch (error) {
      throw badRequest(error, 'Wiederherstellen fehlgeschlagen')
    }
    // Give the answer time to reach the renderer before the windows close
    setTimeout(() => {
      app.relaunch()
      app.quit()
    }, 500)
    return result
  })
})
