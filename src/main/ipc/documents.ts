import { dialog, ipcMain, shell } from 'electron'
import { extname } from 'path'
import { readFile } from 'fs/promises'
import { copyLogoToStorage, deleteLogoFile, getDocumentFullPath } from '../utils/fileStorage'
import { failure } from './handlerUtils'

/** Stored documents and company logos (storage/), and the plain file picker */
export function registerDocumentIpc(): void {
  /** Opens a stored document with the system's default application */
  ipcMain.handle('document:open', async (_event, { filePath }: { filePath: string }) => {
    try {
      await shell.openPath(await getDocumentFullPath(filePath))
      return { success: true }
    } catch (error) {
      console.error('Error opening document:', error)
      return failure(error)
    }
  })

  /** Shows a stored document in the file explorer/finder */
  ipcMain.handle('document:revealInFolder', async (_event, { filePath }: { filePath: string }) => {
    try {
      shell.showItemInFolder(await getDocumentFullPath(filePath))
      return { success: true }
    } catch (error) {
      console.error('Error revealing document:', error)
      return failure(error)
    }
  })

  ipcMain.handle('dialog:showOpenDialog', async () => {
    try {
      return await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
    } catch (error) {
      console.error('Error showing file dialog:', error)
      return { canceled: true, filePaths: [], error: failure(error).error }
    }
  })

  /** Stores a company logo under storage/logos/<companyId>/ and returns the relative path */
  ipcMain.handle(
    'logo:upload',
    async (
      _event,
      {
        companyId,
        sourcePath,
        fileName
      }: { companyId: number; sourcePath: string; fileName: string }
    ) => {
      try {
        const relativePath = await copyLogoToStorage(sourcePath, companyId, fileName)
        return { success: true, relativePath }
      } catch (error) {
        console.error('Error uploading logo:', error)
        return failure(error)
      }
    }
  )

  ipcMain.handle('logo:delete', async (_event, { relativePath }: { relativePath: string }) => {
    try {
      await deleteLogoFile(relativePath)
      return { success: true }
    } catch (error) {
      console.error('Error deleting logo:', error)
      return failure(error)
    }
  })

  /**
   * A stored image as a data URL, so the renderer shows company logos regardless of the dev
   * (http) or production (file) origin
   */
  ipcMain.handle('logo:getDataUrl', async (_event, { relativePath }: { relativePath: string }) => {
    try {
      const fullPath = await getDocumentFullPath(relativePath)
      const data = await readFile(fullPath)
      const ext = extname(fullPath).toLowerCase()
      const mime =
        ext === '.svg'
          ? 'image/svg+xml'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : 'image/png'
      return { success: true, dataUrl: `data:${mime};base64,${data.toString('base64')}` }
    } catch (error) {
      return failure(error)
    }
  })
}
