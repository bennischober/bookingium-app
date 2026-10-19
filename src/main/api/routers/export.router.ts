import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'path'
import { ExportService, type ListTable } from '../../services/ExportService'
import { EXPORT_LIST_LABELS, ExportListInput, type ExportResultDto } from '../schemas/export.schema'

const t = initTRPC.create()
const service = container.resolve(ExportService)

// Only files written by this router may be opened via openExport
const exportedFiles = new Set<string>()

const today = (): string => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Save dialog (Documents, prefilled name), then writes the tables */
async function saveWorkbook(tables: ListTable[], fileName: string): Promise<ExportResultDto> {
  const owner = BrowserWindow.getFocusedWindow()
  const options: Electron.SaveDialogOptions = {
    title: 'Als Excel-Datei exportieren',
    defaultPath: join(app.getPath('documents'), fileName),
    filters: [{ name: 'Excel-Arbeitsmappe', extensions: ['xlsx'] }]
  }
  const result = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { canceled: true, filePath: null, rows: 0 }
  try {
    await service.workbook(tables).xlsx.writeFile(result.filePath)
  } catch (error) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: error instanceof Error ? error.message : 'Export fehlgeschlagen'
    })
  }
  exportedFiles.add(result.filePath)
  return {
    canceled: false,
    filePath: result.filePath,
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

  /** Opens a file exported in this session with its default app */
  openExport: t.procedure.input(z.string()).mutation(async ({ input }) => {
    if (!exportedFiles.has(input)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unbekannte Datei' })
    }
    const error = await shell.openPath(input)
    if (error) throw new TRPCError({ code: 'BAD_REQUEST', message: error })
  })
})
