import { app, ipcMain } from 'electron'
import { container } from 'tsyringe'
import { readImportFile } from '../import/readImportFile'
import { ImportService } from '../services/ImportService'
import { SettingsService } from '../services/SettingsService'
import { failure, showOpenDialogFor } from './handlerUtils'

/** The CSV import's file picker; planning and running the import go through tRPC */
export function registerImportIpc(): void {
  /** Picks a CSV file and returns its rows (as text, plus a suggested column mapping) */
  ipcMain.handle('import:pickFile', async (event) => {
    try {
      const result = await showOpenDialogFor(event.sender, {
        title: 'CSV-Datei importieren',
        properties: ['openFile'],
        filters: [{ name: 'CSV-Datei', extensions: ['csv', 'txt'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return { success: true, canceled: true }
      const { defaultCountry } = container.resolve(SettingsService).get()
      // Detected mappings, or the ones used last time for the same columns
      const file = container
        .resolve(ImportService)
        .withRememberedMappings(
          await readImportFile(result.filePaths[0], defaultCountry, app.getSystemLocale())
        )
      return { success: true, canceled: false, file }
    } catch (error) {
      console.error('Error reading import file:', error)
      return failure(error)
    }
  })
}
