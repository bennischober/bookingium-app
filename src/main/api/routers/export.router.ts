import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { ExportService, type ListTable } from '../../services/ExportService'
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

/** Save dialog, then writes the tables */
async function saveWorkbook(tables: ListTable[], fileName: string): Promise<ExportResultDto> {
  const filePath = await askSavePath(fileName, 'Als Excel-Datei exportieren', {
    name: 'Excel-Arbeitsmappe',
    extensions: ['xlsx']
  })
  if (!filePath) return { canceled: true, filePath: null, rows: 0 }
  try {
    await service.workbook(tables).xlsx.writeFile(filePath)
  } catch (error) {
    throw exportFailed(error)
  }
  exportedFiles.add(filePath)
  return {
    canceled: false,
    filePath,
    rows: tables.reduce((sum, table) => sum + table.rows.length, 0)
  }
}

export const exportRouter = t.router({
  /** The list as its grid shows it (search/filter, all pages) */
  exportList: t.procedure.input(ExportListInput).mutation(async ({ input }) => {
    const table = await service.table(input)
    const filtered = input.search || input.kind ? ' (gefiltert)' : ''
    return saveWorkbook([table], `${EXPORT_LIST_LABELS[input.list]}${filtered} ${today()}.xlsx`)
  }),

  /** Every list in one workbook, one sheet each */
  exportAll: t.procedure.mutation(async () =>
    saveWorkbook(await service.allTables(), `Bookingium Export ${today()}.xlsx`)
  ),

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

  /** Opens a file exported in this session with its default app */
  openExport: t.procedure.input(z.string()).mutation(async ({ input }) => {
    if (!exportedFiles.has(input)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unbekannte Datei' })
    }
    const error = await shell.openPath(input)
    if (error) throw new TRPCError({ code: 'BAD_REQUEST', message: error })
  })
})
