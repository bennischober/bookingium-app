import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { SettingsService } from '../../services/SettingsService'
import { BackupService } from '../../services/BackupService'
import { errorLogFolder } from '../../utils/errorLog'
import { UpdateAppSettingsInput, type BackupResultDto } from '../schemas/settings.schema'
import { adminOnly, requireAdmin } from '../access'

const t = initTRPC.create()
// #262: the manual backup is closed in staff access
const adminProcedure = t.procedure.use(t.middleware(adminOnly))
const service = container.resolve(SettingsService)
const backups = container.resolve(BackupService)

// #262: settings of the Rechnungen tab, closed in staff access
const INVOICE_SETTING_KEYS = ['nextCustomerNumber', 'eInvoiceEmbed', 'paymentQr'] as const

// Only folders created by createBackup may be opened via openBackup
const createdBackups = new Set<string>()

const badRequest = (error: unknown, fallback: string) =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error ? error.message : fallback
  })

export const settingsRouter = t.router({
  get: t.procedure.query(() => service.get()),

  update: t.procedure.input(UpdateAppSettingsInput).mutation(({ input }) => {
    // #262: the invoice settings (Einstellungen › Rechnungen) are company-internal
    if (INVOICE_SETTING_KEYS.some((key) => input[key] !== undefined)) requireAdmin()
    return service.update(input)
  }),

  /** Where the app keeps its database and documents */
  dataLocations: t.procedure.query(() => service.dataLocations()),

  openDataFolder: t.procedure.mutation(async () => {
    const error = await shell.openPath(service.dataLocations().dataFolder)
    if (error) throw badRequest(new Error(error), 'Ordner konnte nicht geöffnet werden')
  }),

  /** The folder of the local error log (utils/errorLog.ts); it exists even before the first entry */
  openErrorLog: t.procedure.mutation(async () => {
    const folder = errorLogFolder()
    if (!folder) throw badRequest(null, 'Kein Fehlerprotokoll eingerichtet')
    const error = await shell.openPath(folder)
    if (error) throw badRequest(new Error(error), 'Ordner konnte nicht geöffnet werden')
  }),

  /** Asks for a target folder, then copies database and documents into it */
  createBackup: adminProcedure.mutation(async (): Promise<BackupResultDto> => {
    const owner = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Ordner für die Sicherung wählen',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory']
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { canceled: true, folder: null }
    try {
      const folder = await backups.createManualBackup(result.filePaths[0])
      createdBackups.add(folder)
      return { canceled: false, folder }
    } catch (error) {
      throw badRequest(error, 'Sicherung fehlgeschlagen')
    }
  }),

  /** Opens a backup folder created in this session */
  openBackup: adminProcedure.input(z.string()).mutation(async ({ input }) => {
    if (!createdBackups.has(input)) throw badRequest(null, 'Unbekannte Sicherung')
    const error = await shell.openPath(input)
    if (error) throw badRequest(new Error(error), 'Ordner konnte nicht geöffnet werden')
  })
})
