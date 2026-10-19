import 'reflect-metadata'
import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, extname } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createIPCHandler } from 'electron-trpc/main'

// Test-runner launches (playwright drives electron directly) get the bare
// 'Electron' userData path, which points at a different (empty) database
// than the dev/packaged app. Honor an explicit override so tests hit the
// same database as the real app.
if (process.env.BOOKINGIUM_USER_DATA) {
  app.setPath('userData', process.env.BOOKINGIUM_USER_DATA)
}
import { router } from './api/router'
import icon from '../../resources/icon.png?asset'
import { runMigrations } from './db/migrate'
import { seedDatabase } from './db/seed'
import { container } from 'tsyringe'
import { getDocumentFullPath, copyLogoToStorage, deleteLogoFile } from './utils/fileStorage'
import { DocumentService } from './services/DocumentService'
import { SettingsService } from './services/SettingsService'
import { ImportService } from './services/ImportService'
import { CalendarFeedService } from './services/CalendarFeedService'
import { readWorkbook } from './import/readWorkbook'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    // Narrowest size the layout supports (sidebar + content, breadcrumbs,
    // scrolling tables); below that the window can't be shrunk
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  createIPCHandler({ router, windows: [mainWindow] })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * IPC Handler for opening files
 * Attempts to open the file with the system default application
 * Falls back to opening the folder if the file type is not recognized
 */
ipcMain.handle('document:open', async (_event, { filePath }: { filePath: string }) => {
  try {
    const fullPath = await getDocumentFullPath(filePath)

    // Try to open the file with the default application
    await shell.openPath(fullPath)

    return { success: true }
  } catch (error) {
    console.error('Error opening document:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

/**
 * IPC Handler for revealing files in explorer/finder
 * Shows the file in the file explorer/finder window
 */
ipcMain.handle('document:revealInFolder', async (_event, { filePath }: { filePath: string }) => {
  try {
    const fullPath = await getDocumentFullPath(filePath)

    // Show the file in the file explorer/finder
    shell.showItemInFolder(fullPath)

    return { success: true }
  } catch (error) {
    console.error('Error revealing document:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

/**
 * IPC Handler for showing file open dialog
 */
ipcMain.handle('dialog:showOpenDialog', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections']
    })
    return result
  } catch (error) {
    console.error('Error showing file dialog:', error)
    return {
      canceled: true,
      filePaths: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

/**
 * IPC Handler for uploading a company logo.
 * Stores the image under storage/logos/<companyId>/ and returns the relative path.
 */
ipcMain.handle(
  'logo:upload',
  async (
    _event,
    { companyId, sourcePath, fileName }: { companyId: number; sourcePath: string; fileName: string }
  ) => {
    try {
      const relativePath = await copyLogoToStorage(sourcePath, companyId, fileName)
      return { success: true, relativePath }
    } catch (error) {
      console.error('Error uploading logo:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
)

/**
 * IPC Handler for deleting a company logo file.
 */
ipcMain.handle('logo:delete', async (_event, { relativePath }: { relativePath: string }) => {
  try {
    await deleteLogoFile(relativePath)
    return { success: true }
  } catch (error) {
    console.error('Error deleting logo:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

/**
 * IPC Handler for resolving a stored image as a data URL.
 * Used by the renderer to display images (e.g. company logos) regardless of
 * dev (http) vs production (file) renderer origin.
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
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

/**
 * IPC Handler: generate the real print output (printToPDF) of the current
 * window. Used by the print pages' exact preview.
 */
// A4 with 20mm margins (0.787in), mirroring the sheet padding / @page CSS
function printWindowToPdf(wc: Electron.WebContents): Promise<Buffer> {
  return wc.printToPDF({
    landscape: false,
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0.787, bottom: 0.787, left: 0.787, right: 0.787 }
  })
}

ipcMain.handle('print:previewPdf', async (event) => {
  try {
    const pdf = await printWindowToPdf(event.sender)
    // Raw bytes (arrive as Uint8Array) — the renderer draws the pages itself
    // with pdf.js; no temp files, no PDF plugin, no data: frames
    return { success: true, data: new Uint8Array(pdf) }
  } catch (error) {
    console.error('Error generating print preview:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

// Only PDFs saved through print:savePdf may be opened via print:openPdf
const savedPdfPaths = new Set<string>()

/**
 * IPC Handler: save the real print output of the current window as a PDF,
 * via a save dialog prefilled with the given file name (in Documents).
 */
ipcMain.handle('print:savePdf', async (event, { defaultFileName }: { defaultFileName: string }) => {
  try {
    const pdf = await printWindowToPdf(event.sender)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.SaveDialogOptions = {
      title: 'Als PDF speichern',
      defaultPath: join(app.getPath('documents'), defaultFileName),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    }
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { success: true, canceled: true }
    await writeFile(result.filePath, pdf)
    savedPdfPaths.add(result.filePath)
    return { success: true, canceled: false, filePath: result.filePath }
  } catch (error) {
    console.error('Error saving PDF:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

ipcMain.handle('print:openPdf', async (_event, { filePath }: { filePath: string }) => {
  if (!savedPdfPaths.has(filePath)) return { success: false, error: 'Unknown file' }
  const error = await shell.openPath(filePath)
  return error ? { success: false, error } : { success: true }
})

/**
 * IPC Handler: pick an Excel workbook for the import dialog and return its
 * sheets (rows as text plus a suggested column mapping)
 */
ipcMain.handle('import:pickWorkbook', async (event) => {
  try {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Excel-Datei importieren',
      properties: ['openFile'],
      filters: [{ name: 'Excel-Arbeitsmappe', extensions: ['xlsx', 'xlsm'] }]
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { success: true, canceled: true }
    const { defaultCountry } = container.resolve(SettingsService).get()
    // Detected mappings, or the ones used last time for the same columns
    const workbook = container
      .resolve(ImportService)
      .withRememberedMappings(await readWorkbook(result.filePaths[0], defaultCountry))
    return { success: true, canceled: false, workbook }
  } catch (error) {
    console.error('Error reading workbook:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  runMigrations()
  // Files from the old storage/events/<id>/ layout move to storage/documents/
  await container
    .resolve(DocumentService)
    .relocateLegacyFiles()
    .then(({ moved, missing }) => {
      if (moved || missing) console.log(`Documents relocated: ${moved} moved, ${missing} missing`)
    })
    .catch((error) => console.error('Relocating documents failed:', error))
  // Calendar file (Einstellungen › Kalender): refresh with the current events
  void container.resolve(CalendarFeedService).update()
  await seedDatabase().catch((error) => {
    console.error('Database seeding failed:', error)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
