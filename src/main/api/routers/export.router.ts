import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { ExportService } from '../../services/ExportService'
import { ContactListService, contactListCsv } from '../../services/ContactListService'
import { ContactListFilters } from '../schemas/contactList.schema'
import { EXPORT_LIST_LABELS, ExportListInput, type ExportResultDto } from '../schemas/export.schema'

const t = initTRPC.create()
const service = container.resolve(ExportService)
const contactListService = container.resolve(ContactListService)

// Only files written by this router may be opened via openExport
const exportedFiles = new Set<string>()

const today = (): string => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Save dialog (Documents, prefilled name); null when canceled */
async function askSavePath(
  fileName: string,
  title: string,
  filter: Electron.FileFilter
): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow()
  const options: Electron.SaveDialogOptions = {
    title,
    defaultPath: join(app.getPath('documents'), fileName),
    filters: [filter]
  }
  const result = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

function exportFailed(error: unknown): TRPCError {
  return new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error ? error.message : 'Export fehlgeschlagen'
  })
}

/** Folder dialog (Documents); null when canceled */
async function askFolder(title: string): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow()
  const options: Electron.OpenDialogOptions = {
    title,
    defaultPath: app.getPath('documents'),
    buttonLabel: 'Hier speichern',
    properties: ['openDirectory', 'createDirectory']
  }
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

/** A new folder `name` in `parent`, numbered when the name is taken */
async function newFolder(parent: string, name: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const path = join(parent, attempt === 1 ? name : `${name} (${attempt})`)
    try {
      await mkdir(path)
      return path
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}

// CSV in the regional format of the system, as Excel there expects it
const locale = (): string => app.getSystemLocale() || 'de-DE'

export const exportRouter = t.router({
  /** The list as its grid shows it (search/filter, all pages) */
  exportList: t.procedure
    .input(ExportListInput)
    .mutation(async ({ input }): Promise<ExportResultDto> => {
      const table = await service.table(input)
      const filtered = input.search || input.kind ? ' (gefiltert)' : ''
      const fileName = `${EXPORT_LIST_LABELS[input.list]}${filtered} ${today()}.csv`
      const filePath = await askSavePath(fileName, 'Als CSV-Datei exportieren', {
        name: 'CSV-Datei',
        extensions: ['csv']
      })
      if (!filePath) return { canceled: true, filePath: null, rows: 0 }
      try {
        await writeFile(filePath, service.csv(table, locale()), 'utf-8')
      } catch (error) {
        throw exportFailed(error)
      }
      exportedFiles.add(filePath)
      return { canceled: false, filePath, rows: table.rows.length }
    }),

  /** Every list, one CSV file each, in a new folder */
  exportAll: t.procedure.mutation(async (): Promise<ExportResultDto> => {
    const parent = await askFolder('Ordner für den Export wählen')
    if (!parent) return { canceled: true, filePath: null, rows: 0 }
    const tables = await service.allTables()
    let folder: string
    try {
      folder = await newFolder(parent, `Bookingium Export ${today()}`)
      for (const table of tables) {
        await writeFile(join(folder, `${table.name}.csv`), service.csv(table, locale()), 'utf-8')
      }
    } catch (error) {
      throw exportFailed(error)
    }
    exportedFiles.add(folder)
    return {
      canceled: false,
      filePath: folder,
      rows: tables.reduce((sum, table) => sum + table.rows.length, 0)
    }
  }),

  /** A mailing list (Verteiler) as CSV for newsletter services */
  exportContactList: t.procedure
    .input(z.object({ filters: ContactListFilters, name: z.string().default('') }))
    .mutation(async ({ input }): Promise<ExportResultDto> => {
      const { recipients } = contactListService.build(input.filters)
      const listName = input.name.trim().replace(/[\\/:*?"<>|]/g, '-') || 'Verteiler'
      const fileName = `${listName} ${today()}.csv`
      const filePath = await askSavePath(fileName, 'Als CSV-Datei exportieren', {
        name: 'CSV-Datei',
        extensions: ['csv']
      })
      if (!filePath) return { canceled: true, filePath: null, rows: 0 }
      try {
        await writeFile(filePath, contactListCsv(recipients), 'utf-8')
      } catch (error) {
        throw exportFailed(error)
      }
      exportedFiles.add(filePath)
      return { canceled: false, filePath, rows: recipients.length }
    }),

  /** Opens a file (or folder) exported in this session with its default app */
  openExport: t.procedure.input(z.string()).mutation(async ({ input }) => {
    if (!exportedFiles.has(input)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unbekannte Datei' })
    }
    const error = await shell.openPath(input)
    if (error) throw new TRPCError({ code: 'BAD_REQUEST', message: error })
  })
})
