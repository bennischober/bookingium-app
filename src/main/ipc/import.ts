import { app, ipcMain } from 'electron'
import { container } from 'tsyringe'
import { readImportFile } from '../import/readImportFile'
import { ImportService } from '../services/ImportService'
import { SettingsService } from '../services/SettingsService'
import { failure, showOpenDialogFor } from './handlerUtils'

const IMPORT_EXTENSIONS = ['xlsx', 'csv', 'txt']

/** The CSV import's file picker; planning and running the import go through tRPC */
export function registerImportIpc(): void {
  /**
   * Picks a CSV or Excel file and returns its rows (as text, plus a suggested column mapping).
   * With `droppedPath` (a file dropped onto the dialog) the picker is skipped.
   */
  ipcMain.handle('import:pickFile', async (event, droppedPath?: unknown) => {
    try {
      let path: string
      if (typeof droppedPath === 'string' && droppedPath) {
        const extension = droppedPath.split('.').pop()?.toLowerCase() ?? ''
        if (!IMPORT_EXTENSIONS.includes(extension))
          throw new Error('Bitte eine Excel-Datei (.xlsx) oder CSV-Datei ablegen.')
        path = droppedPath
      } else {
        const result = await showOpenDialogFor(event.sender, {
          title: 'Liste importieren',
          properties: ['openFile'],
          filters: [
            { name: 'Excel- oder CSV-Datei', extensions: IMPORT_EXTENSIONS },
            { name: 'Excel-Datei', extensions: ['xlsx'] },
            { name: 'CSV-Datei', extensions: ['csv', 'txt'] }
          ]
        })
        if (result.canceled || result.filePaths.length === 0)
          return { success: true, canceled: true }
        path = result.filePaths[0]
      }
      const { defaultCountry } = container.resolve(SettingsService).get()
      // Detected mappings, or the ones used last time for the same columns
      const file = container
        .resolve(ImportService)
        .withRememberedMappings(await readImportFile(path, defaultCountry, app.getSystemLocale()))
      return { success: true, canceled: false, file }
    } catch (error) {
      console.error('Error reading import file:', error)
      return failure(error)
    }
  })

  /** #228: picks a promoter's settlement (.xlsx); reading it goes through tRPC */
  ipcMain.handle('settlement:pickFile', async (event): Promise<string | null> => {
    const result = await showOpenDialogFor(event.sender, {
      title: 'Abrechnung des Veranstalters wählen',
      properties: ['openFile'],
      filters: [{ name: 'Excel-Datei', extensions: ['xlsx'] }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  /** #222: picks a received e-invoice; reading it goes through tRPC (einvoiceParty.read) */
  ipcMain.handle('einvoice:pickFile', async (event): Promise<string | null> => {
    const result = await showOpenDialogFor(event.sender, {
      title: 'E-Rechnung wählen',
      properties: ['openFile'],
      filters: [{ name: 'E-Rechnung (PDF oder XML)', extensions: ['pdf', 'xml'] }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  /** #289: picks a label copy; reading and merging it go through tRPC (release.planLabelCopy) */
  ipcMain.handle('release:pickLabelCopy', async (event): Promise<string | null> => {
    const result = await showOpenDialogFor(event.sender, {
      title: 'Labelcopy wählen',
      properties: ['openFile'],
      filters: [{ name: 'Labelcopy (Excel oder PDF)', extensions: ['xlsx', 'pdf'] }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  /** Show-Ordner: picks the agency's folder of a show, or single files of it */
  ipcMain.handle('showFolder:pick', async (event, mode: unknown): Promise<string[]> => {
    const folder = mode === 'folder'
    const result = await showOpenDialogFor(event.sender, {
      title: folder ? 'Show-Ordner wählen' : 'Dateien des Show-Ordners wählen',
      properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections']
    })
    return result.canceled ? [] : result.filePaths
  })

  /** #225: picks receipts, several at once; storing them goes through tRPC (receipt.create) */
  ipcMain.handle('receipt:pickFiles', async (event): Promise<string[]> => {
    const result = await showOpenDialogFor(event.sender, {
      title: 'Belege wählen',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Belege (PDF, XML, JPG, PNG)', extensions: ['pdf', 'xml', 'jpg', 'jpeg', 'png'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })
}
