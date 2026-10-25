import 'reflect-metadata'
import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, extname } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createIPCHandler } from 'electron-trpc/main'

// Data folder (database, documents): %APPDATA%/bookingum-app for the dev
// and the installed app alike. Electron would derive it from the app name,
// which is "Bookingium" when packaged. Tests pass their own temp folder.
if (process.env.BOOKINGIUM_USER_DATA) {
  app.setPath('userData', process.env.BOOKINGIUM_USER_DATA)
} else {
  app.setPath('userData', join(app.getPath('appData'), 'bookingum-app'))
}
// One app per data folder: a second one would open the same database and mail
// store. The lock is taken per userData, so tests with their own folder still run
// next to the app. A second start brings the running window to the front instead.
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) app.exit(0)
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
import { EInvoiceService } from './services/EInvoiceService'
import { InvoiceService } from './services/InvoiceService'
import type { EInvoiceCheckDto, InvoiceEmailKind } from './api/schemas/invoice.schema'
import { EMAIL_TEMPLATES } from './api/schemas/settings.schema'
import { InvoiceMapper } from './api/mappers/invoice.mapper'
import { invoiceEmail, type Lang } from './mail/invoiceEmail'
import { openEmail, showEmailFile } from './mail/openEmail'
import { readWorkbook } from './import/readWorkbook'
import { mailClient } from './mailclient/MailClientService'
import type { ComposeDraft, ComposeResult } from './mail/composeWindow'
import { cleanAttachmentTemp } from './api/routers/mail.router'
import { MailLinkService } from './services/MailLinkService'
import { listMailAccounts } from './mailclient/accounts'

// One tRPC handler for all windows; each new window is attached to it
let ipcHandler: ReturnType<typeof createIPCHandler> | null = null
let mainWindow: BrowserWindow | null = null
// Mails opened in their own window, by `${accountId}:${messageId}`
const mailWindows = new Map<string, BrowserWindow>()

/** A renderer window showing the route `hash` (e.g. '/mail/window?…'), or the app's start page */
function createAppWindow(
  options: Electron.BrowserWindowConstructorOptions,
  hash?: string
): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    // macOS takes the icon from the app bundle
    ...(process.platform !== 'darwin' ? { icon } : {}),
    ...options,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (ipcHandler) ipcHandler.attachWindow(window)
  else ipcHandler = createIPCHandler({ router, windows: [window] })

  window.on('ready-to-show', () => {
    window.show()
  })

  // F5/F15: the renderer's beforeunload holds the unload while it saves a draft, and
  // the same event fires for a RELOAD. The window's own 'close' event is the only
  // reliable signal: it fires for a real close and never for a reload.
  let closing = false
  window.on('close', () => {
    closing = true
  })
  window.webContents.on('will-prevent-unload', (event) => {
    // preventDefault() means "ignore the renderer, let the unload happen".
    // A reload always goes through. A close is let through too, and the window is
    // destroyed here - the renderer never calls window.close() itself, because
    // beforeunload cannot tell the two apart.
    event.preventDefault()
    if (closing && !window.isDestroyed()) window.destroy()
  })

  // Links open in the default browser or mail program; other schemes (file:,
  // custom protocol handlers, ...) are dropped, links in mails included
  window.webContents.setWindowOpenHandler((details) => {
    try {
      const { protocol } = new URL(details.url)
      if (['http:', 'https:', 'mailto:'].includes(protocol)) {
        void shell.openExternal(details.url)
      }
    } catch {
      // Not a valid URL
    }
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'] + (hash ? `#${hash}` : ''))
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
  return window
}

function createWindow(): void {
  mainWindow = createAppWindow({
    width: 900,
    height: 670,
    // Narrowest size the layout supports (sidebar + content, breadcrumbs,
    // scrolling tables); below that the window can't be shrunk
    minWidth: 800,
    minHeight: 600
  })
  // The mail windows belong to it; each saves an unsaved reply before it closes
  mainWindow.on('closed', () => {
    mainWindow = null
    for (const window of mailWindows.values()) window.close()
  })
}

/**
 * Opens a mail in its own window (double-click in the list), or brings the window
 * that already shows it to the front
 */
ipcMain.handle(
  'mail:openWindow',
  (_event, { accountId, messageId }: { accountId: string; messageId: number }) => {
    if (typeof accountId !== 'string' || !accountId || !Number.isSafeInteger(messageId)) return
    const key = `${accountId}:${messageId}`
    const open = mailWindows.get(key)
    if (open && !open.isDestroyed()) {
      if (open.isMinimized()) open.restore()
      open.focus()
      return
    }
    const search = new URLSearchParams({ account: accountId, message: String(messageId) })
    const window = createAppWindow(
      { width: 820, height: 720, minWidth: 480, minHeight: 400 },
      `/mail/window?${search}`
    )
    mailWindows.set(key, window)
    window.on('closed', () => mailWindows.delete(key))
  }
)

/**
 * C1: opens bookingum's own editor for a prepared draft and resolves with what the
 * user did. Only this path knows whether the mail was really sent, so an invoice is
 * marked as emailed after a successful send - not when a window opens.
 */
const composeWindows = new Map<string, (result: ComposeResult) => void>()
/** C1: the PDFs a compose window was opened with - only these may be read back */
const composePdfs = new Set<string>()

async function openComposeWindow(input: {
  accountId: string
  draft: ComposeDraft
  pdfPath: string
  pdfName: string
}): Promise<ComposeResult> {
  if (!input?.accountId || !input.draft) return { sent: false }
  // only this file may be read back by the window
  composePdfs.add(input.pdfPath)
  const key = `compose:${Date.now()}:${Math.random().toString(36).slice(2)}`
  const search = new URLSearchParams({
    account: input.accountId,
    mode: 'compose',
    key,
    // base64: the JSON has characters that would break the URL fragment
    draft: Buffer.from(JSON.stringify(input.draft), 'utf8').toString('base64'),
    pdfPath: input.pdfPath,
    pdfName: input.pdfName
  })
  return new Promise<ComposeResult>((resolve) => {
    let settled = false
    const finish = (result: ComposeResult): void => {
      if (settled) return
      settled = true
      composeWindows.delete(key)
      resolve(result)
    }
    composeWindows.set(key, finish)
    const window = createAppWindow(
      { width: 900, height: 760, minWidth: 520, minHeight: 460 },
      `/mail/window?${search}`
    )
    // A closed window means the user did not send
    window.on('closed', () => finish({ sent: false }))
  })
}

ipcMain.handle('mail:composeWindow', (_event, input: Parameters<typeof openComposeWindow>[0]) =>
  openComposeWindow(input)
)

/** C1: the compose window reports a successful send */
ipcMain.handle(
  'mail:composeSent',
  (_event, { key, messageId }: { key: string; messageId: string }) => {
    composeWindows.get(key)?.({ sent: true, messageId })
  }
)

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
// One print job per window at a time: printToPDF fails ("Printing failed")
// while another one runs, e.g. a save or email during the preview
const printQueues = new WeakMap<Electron.WebContents, Promise<unknown>>()

// A4 with 20mm margins (0.787in), mirroring the sheet padding / @page CSS
function printWindowToPdf(wc: Electron.WebContents): Promise<Buffer> {
  const job = (printQueues.get(wc) ?? Promise.resolve())
    .catch(() => {})
    .then(() =>
      wc.printToPDF({
        landscape: false,
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.787, bottom: 0.787, left: 0.787, right: 0.787 }
      })
    )
  printQueues.set(wc, job)
  return job
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

/**
 * The window's print output; for an invoice with the e-invoice XML embedded
 * when it is complete (ZUGFeRD/Factur-X)
 */
async function documentPdf(
  wc: Electron.WebContents,
  fileName: string,
  invoiceId?: number
): Promise<{ pdf: Uint8Array; eInvoice?: EInvoiceCheckDto }> {
  const pdf = await printWindowToPdf(wc)
  if (!invoiceId) return { pdf }
  return container.resolve(EInvoiceService).attachToPdf(invoiceId, pdf, fileName)
}

// Only PDFs saved through print:savePdf may be opened via print:openPdf
const savedPdfPaths = new Set<string>()

/**
 * IPC Handler: save the real print output of the current window as a PDF,
 * via a save dialog prefilled with the given file name (in Documents).
 * For an invoice, the e-invoice XML is embedded when it is complete
 * (ZUGFeRD/Factur-X); `eInvoice` tells the renderer whether it was.
 */
ipcMain.handle(
  'print:savePdf',
  async (
    event,
    { defaultFileName, invoiceId }: { defaultFileName: string; invoiceId?: number }
  ) => {
    try {
      const { pdf, eInvoice } = await documentPdf(
        event.sender,
        defaultFileName.replace(/\.pdf$/i, ''),
        invoiceId
      )
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
      return { success: true, canceled: false, filePath: result.filePath, eInvoice }
    } catch (error) {
      console.error('Error saving PDF:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
)

/**
 * IPC Handler: save an invoice's e-invoice as a bare XML file (XRechnung
 * for portals of public-sector buyers), via a save dialog
 */
ipcMain.handle(
  'einvoice:saveXml',
  async (event, { invoiceId, defaultFileName }: { invoiceId: number; defaultFileName: string }) => {
    try {
      const { xml, ...eInvoice } = await container.resolve(EInvoiceService).check(invoiceId)
      if (!xml) return { success: true, canceled: true, eInvoice }
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.SaveDialogOptions = {
        title: 'E-Rechnung als XML speichern',
        defaultPath: join(app.getPath('documents'), defaultFileName),
        filters: [{ name: 'XML', extensions: ['xml'] }]
      }
      const result = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { success: true, canceled: true, eInvoice }
      await writeFile(result.filePath, xml, 'utf-8')
      return { success: true, canceled: false, filePath: result.filePath, eInvoice }
    } catch (error) {
      console.error('Error saving e-invoice XML:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
)

/**
 * IPC Handler: "Per E-Mail senden" — writes the invoice PDF (with e-invoice)
 * and an .eml draft, opens it in the mail program (see mail/openEmail.ts)
 * and remembers the email on the invoice. `kind` reminder or dunning sends
 * a Zahlungserinnerung or Mahnung about an open invoice instead.
 */
ipcMain.handle(
  'invoice:email',
  async (
    event,
    {
      invoiceId,
      fileName,
      lang,
      kind = 'invoice'
    }: { invoiceId: number; fileName: string; lang: Lang; kind?: InvoiceEmailKind }
  ) => {
    try {
      const invoiceService = container.resolve(InvoiceService)
      const entity = await invoiceService.getInvoicePrintData(invoiceId)
      if (!entity) return { success: false, error: 'Rechnung nicht gefunden' }
      const data = InvoiceMapper.toPrintDto(
        entity,
        entity.issuerSnapshot ?? null,
        entity.recipientSnapshot ?? null
      )
      if (kind !== 'invoice') invoiceService.assertRemindable(data.invoice)
      const settings = container.resolve(SettingsService).get()
      const draft = invoiceEmail(data, lang, settings[EMAIL_TEMPLATES[kind][lang].key])
      const name = fileName.replace(/\.pdf$/i, '')
      const { pdf, eInvoice } = await documentPdf(event.sender, name, invoiceId)
      const result = await openEmail({ draft, pdf, fileName: name, setting: settings.mailProgram })
      // C1: only the own editor knows whether the mail was really sent. Every external
      // program keeps marking the invoice when its window opens, as before.
      if (result.method === 'bookingum') {
        const account = listMailAccounts().find((a) => a.kind === 'sandbox')
        if (!account) {
          return { success: false, error: 'Kein Postfach mit Schreibrecht eingerichtet' }
        }
        const composed = await openComposeWindow({
          accountId: account.id,
          draft: { to: draft.to, subject: draft.subject, body: draft.body },
          pdfPath: result.pdfPath,
          pdfName: `${name}.pdf`
        })
        if (!composed.sent) return { success: false, error: 'Nicht gesendet' }
        invoiceService.markInvoiceEmailed(invoiceId, draft.to, kind, {
          messageId: composed.messageId,
          mailAccountId: account.id
        })
        return { success: true, ...result, to: draft.to, eInvoice }
      }
      invoiceService.markInvoiceEmailed(invoiceId, draft.to, kind)
      return { success: true, ...result, to: draft.to, eInvoice }
    } catch (error) {
      console.error('Error creating invoice email:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
)

/**
 * C1: the invoice PDF a compose window was opened with. Only a path the compose flow
 * itself registered is readable - the renderer cannot ask for arbitrary files.
 */
ipcMain.handle('mail:readComposePdf', async (_event, { filePath }: { filePath: string }) => {
  if (typeof filePath !== 'string' || !composePdfs.has(filePath)) return ''
  try {
    return (await readFile(filePath)).toString('base64')
  } catch {
    return ''
  }
})

ipcMain.handle('mail:showFile', (_event, { filePath }: { filePath: string }) => {
  showEmailFile(filePath)
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
app.on('second-instance', () => {
  const window = mainWindow
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return
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
  // Mail client (utility process): background sync for configured accounts
  mailClient.startIfConfigured()
  // C2: link incoming mail to the records it belongs to, after each folder sync.
  // The linker yields between batches, so a big mailbox never blocks the app.
  const mailLinks = container.resolve(MailLinkService)
  // One run per account at a time. A folder event that arrives during a run must not
  // be dropped: the mails it announced may have been synced after the run's cursor
  // passed them, so the run is repeated once instead.
  const linkRunning = new Set<string>()
  const linkAgain = new Set<string>()
  const runLinker = (accountId: string): void => {
    if (linkRunning.has(accountId)) {
      linkAgain.add(accountId)
      return
    }
    linkRunning.add(accountId)
    const ownEmail = listMailAccounts().find((a) => a.id === accountId)?.email ?? ''
    void mailLinks
      .linkAccount(accountId, ownEmail)
      .catch(() => undefined)
      .finally(() => {
        linkRunning.delete(accountId)
        // Work that arrived during the run gets its own pass
        if (linkAgain.delete(accountId)) runLinker(accountId)
      })
  }
  mailClient.events.on('event', (event) => {
    const e = event as {
      type?: string
      accountId?: string
      event?: { type?: string; path?: string }
    }
    if (e.type !== 'sync-event' || e.event?.type !== 'folder-done') return
    // INBOX and Sent are where the mails that matter arrive
    const path = e.event.path?.toUpperCase()
    if (path !== 'INBOX' && !path?.endsWith('SENT')) return
    if (!e.accountId) return
    runLinker(e.accountId)
  })
  // B6: opened attachments live a day at most
  void cleanAttachmentTemp()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (!mainWindow) createWindow()
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

// Let the mail core finish its shutdown (journal, SQLite, data-dir lock)
// before the app exits; the service kills the worker after a timeout
let mailStopped = false
app.on('before-quit', (event) => {
  if (mailStopped) return
  event.preventDefault()
  void mailClient
    .stop()
    .catch((error) => console.error('Stopping the mail client failed:', error))
    .finally(() => {
      mailStopped = true
      app.quit()
    })
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
