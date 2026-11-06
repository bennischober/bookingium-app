import 'reflect-metadata'
import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  clipboard,
  net,
  powerMonitor,
  safeStorage,
  session
} from 'electron'
import { basename, join, extname } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createIPCHandler } from 'electron-trpc/main'
import { copyableLinkUrl } from './mail/linkClipboard'
import { isAppDocument } from './utils/navigation'
import { TILE_REQUEST_URLS, tileUserAgent } from './map/tileRequests'
import { initErrorLog, logError } from './utils/errorLog'

// Data folder (database, documents): %APPDATA%/bookingum-app for the dev
// and the installed app alike. Electron would derive it from the app name,
// which is "Bookingium" when packaged. Tests pass their own temp folder.
if (process.env.BOOKINGIUM_USER_DATA) {
  app.setPath('userData', process.env.BOOKINGIUM_USER_DATA)
} else {
  app.setPath('userData', join(app.getPath('appData'), 'bookingum-app'))
}
// Real bugs only, on this machine (utils/errorLog.ts); set up before anything else can fail.
// The monitor leaves Electron's own handling of an uncaught exception as it was.
initErrorLog({ folder: join(app.getPath('userData'), 'logs'), version: app.getVersion() })
process.on('uncaughtExceptionMonitor', (error) => logError('main', error, { fatal: true }))
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason)
  logError('main', reason)
})
// A window's renderer or a helper process died; the mail worker's exit is recorded by
// MailClientService, which knows whether it was stopped on purpose
app.on('render-process-gone', (_event, _contents, details) => {
  if (details.reason === 'clean-exit' || details.reason === 'killed') return
  logError('process', `renderer gone: ${details.reason} (exit code ${details.exitCode})`, {
    fatal: true
  })
})
app.on('child-process-gone', (_event, details) => {
  if (details.type === 'Utility' || details.reason === 'clean-exit' || details.reason === 'killed')
    return
  logError(
    'process',
    `${details.type} process gone: ${details.reason} (exit code ${details.exitCode})`,
    { fatal: true }
  )
})
// One app per data folder: a second one would open the same database and mail
// store. The lock is taken per userData, so tests with their own folder still run
// next to the app. A second start brings the running window to the front instead.
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) app.exit(0)
import { router } from './api/router'
import icon from '../../resources/icon.png?asset'
import { runMigrations } from './db/migrate'
import { getSqlite } from './db'
import {
  copyBeforeUpdate,
  pruneBeforeUpdate,
  readLastVersion,
  writeLastVersion
} from './backup/beforeUpdate'
import { seedDatabase } from './db/seed'
import { container } from 'tsyringe'
import { getDocumentFullPath, copyLogoToStorage, deleteLogoFile } from './utils/fileStorage'
import { DocumentService } from './services/DocumentService'
import { SettingsService } from './services/SettingsService'
import { BackupService, backupLocations } from './services/BackupService'
import { ImportService } from './services/ImportService'
import { CalendarFeedService } from './services/CalendarFeedService'
import { EInvoiceService } from './services/EInvoiceService'
import { InvoiceService } from './services/InvoiceService'
import type { EInvoiceCheckDto, InvoiceEmailKind } from './api/schemas/invoice.schema'
import { EMAIL_TEMPLATES, type AppSettings } from './api/schemas/settings.schema'
import { InvoiceMapper } from './api/mappers/invoice.mapper'
import { invoiceEmail, type Lang } from './mail/invoiceEmail'
import {
  concertContractEmailData,
  contractEmail,
  managementContractEmailData,
  type ContractDocument,
  type ContractEmailData
} from './mail/contractEmail'
import { ContractService } from './services/ContractService'
import { ManagementContractService } from './services/ManagementContractService'
import { openEmail, showEmailFile } from './mail/openEmail'
import { readImportFile } from './import/readImportFile'
import { MAIL_CLIENT_OFF, mailClient } from './mailclient/MailClientService'
import type { ComposeDraft, ComposeResult } from './mail/composeWindow'
import {
  confirmInvoiceSendFromOp,
  invoiceComposes,
  invoiceSendAccount,
  type DocumentCompose
} from './mail/invoiceSend'
import { cleanAttachmentTemp } from './api/routers/mail.router'
import { MailLinkService, mailLinkRunner, ownMailAddresses } from './services/MailLinkService'
import { contactAddressEvents } from './repositories/contactEmails'
import { listMailAccounts } from './mailclient/accounts'
import type { MailEvent } from './mailclient/protocol'
import type { FollowUpRecord } from './api/schemas/followUp.schema'
import { watchSystemWake } from './mailclient/systemWake'
import type { FolderNode, OpSummary } from './mailclient/core/types'
import { inboxUnreadOf, inboxWatch } from './mailclient/inboxWatch'
import { MailTray } from './mailclient/mailTray'
import { STILL_RUNNING_NOTICE, newMailNotice } from './mailclient/trayText'

// One tRPC handler for all windows; each new window is attached to it
let ipcHandler: ReturnType<typeof createIPCHandler> | null = null
let mainWindow: BrowserWindow | null = null
// Mails opened in their own window, by `${accountId}:${messageId}`
const mailWindows = new Map<string, BrowserWindow>()
// #65: the tray icon while the mail client has an account (set up once the app is ready)
let mailTray: MailTray | null = null
// The app is quitting (or Windows is ending the session): a close is a close, never a hide
let quitting = false
let toldStillRunning = false

/**
 * #127: e2e runs open their windows without taking the focus from the user's other programs.
 * Playwright drives the page over CDP, so its input does not need the OS focus.
 */
const inBackground = process.env.BOOKINGIUM_E2E_BACKGROUND === '1'

/** Shows a window; in the background (e2e) without activating it */
function present(window: BrowserWindow): void {
  if (inBackground) window.showInactive()
  else window.show()
}

/** Gives a window the focus, except in the background (e2e) */
function bringToFront(window: BrowserWindow): void {
  if (!inBackground) window.focus()
}

/**
 * A renderer window showing the route `hash` (e.g. '/mail/window?…'), or the app's start page.
 * `hideOnClose`: asked on each close; true hides the window instead (#65, the tray).
 */
function createAppWindow(
  options: Electron.BrowserWindowConstructorOptions,
  hash?: string,
  hideOnClose?: () => boolean
): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    // macOS takes the icon from the app bundle
    ...(process.platform !== 'darwin' ? { icon } : {}),
    ...options,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The preload gets only Electron's renderer modules, not Node; electron-vite bundles its
      // dependencies (electron.vite.config.ts)
      sandbox: true
    }
  })

  if (ipcHandler) ipcHandler.attachWindow(window)
  else ipcHandler = createIPCHandler({ router, windows: [window] })

  window.on('ready-to-show', () => {
    present(window)
  })

  // F5/F15: the renderer's beforeunload holds the unload while it saves a draft, and
  // the same event fires for a RELOAD. The window's own 'close' event is the only
  // reliable signal: it fires for a real close and never for a reload.
  //
  // A close is therefore HELD while the renderer saves. The renderer then asks for it
  // through mail:closeWindow; `allowedToClose` is that permission, and the second close
  // is the only one that goes through - so a close can never beat the draft save.
  let closing = false
  let allowedToClose = false
  window.on('close', (event) => {
    // Hidden, the page stays loaded: nothing unloads, so no draft needs saving
    if (!quitting && hideOnClose?.()) {
      event.preventDefault()
      window.hide()
      return
    }
    closing = true
  })
  // Windows ends the session: let the windows close, the app goes with them
  window.on('query-session-end', () => {
    quitting = true
  })
  window.webContents.on('will-prevent-unload', (event) => {
    // preventDefault() means "ignore the renderer's hold, let the unload happen".
    //
    // A RELOAD always goes through: nothing is being closed, and holding it would block
    // the reload forever.
    if (!closing || allowedToClose) event.preventDefault()
  })
  // One window per mail; the request is answered by the window it came from
  const onCloseRequest = (event: Electron.IpcMainEvent): void => {
    if (event.sender !== window.webContents) return
    allowedToClose = true
    window.close()
  }
  ipcMain.on('mail:closeWindow', onCloseRequest)
  window.on('closed', () => {
    ipcMain.off('mail:closeWindow', onCloseRequest)
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

  // Nothing replaces the app's page: a file dropped on the window or a stray link would load
  // in its place. Mail links open as popups above, and hash routes never navigate.
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppDocument(url, window.webContents.getURL())) event.preventDefault()
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

function createWindow(hash?: string): void {
  mainWindow = createAppWindow(
    {
      width: 900,
      height: 670,
      // Narrowest size the layout supports (sidebar + content, breadcrumbs,
      // scrolling tables); below that the window can't be shrunk
      minWidth: 800,
      minHeight: 600
    },
    hash,
    keepInTray
  )
  // The mail windows belong to it; each saves an unsaved reply before it closes
  mainWindow.on('closed', () => {
    mainWindow = null
    for (const window of mailWindows.values()) window.close()
  })
}

/**
 * #65: closing the main window keeps the app in the tray while "Beim Schließen im Infobereich
 * weiterlaufen" is on and the tray icon is there to bring it back. The first time per session a
 * notice says so.
 */
function keepInTray(): boolean {
  if (!mailTray?.visible || !container.resolve(SettingsService).get().mailCloseToTray) return false
  if (!toldStillRunning) {
    toldStillRunning = true
    mailTray.notify(STILL_RUNNING_NOTICE)
  }
  return true
}

/** Brings the main window up: shown again from the tray, restored, focused; or opened anew */
function showMainWindow(hash?: string): BrowserWindow | null {
  const window = mainWindow
  if (!window) {
    createWindow(hash)
    return null
  }
  if (window.isMinimized()) window.restore()
  present(window)
  bringToFront(window)
  return window
}

/**
 * The main window on the mail page (tray menu). A click on a new-mail notification passes its
 * account: the page then shows that account's INBOX with the newest unread mail open.
 */
function showMailPage(accountId?: string): void {
  const hash = accountId ? `/mail?newMail=${encodeURIComponent(accountId)}` : '/mail'
  showMainWindow(hash)?.webContents.send('app:openMailPage', accountId)
}

/**
 * #65: the tray icon is there while the mail client is on and has an account; the watcher reads
 * each INBOX's unread count after every sync and every own write and announces new mail
 */
function setUpMailTray(): void {
  const settings = container.resolve(SettingsService)
  const tray = new MailTray({
    icon,
    accounts: listMailAccounts,
    showApp: () => void showMainWindow(),
    showMail: showMailPage,
    quit: () => app.quit()
  })
  mailTray = tray
  const watch = inboxWatch({
    accountIds: () => listMailAccounts().map((account) => account.id),
    inboxUnread: async (accountId) =>
      inboxUnreadOf((await mailClient.call('getFolders', [accountId])) as FolderNode[]),
    onCounts: (unread) => tray.setCounts(unread),
    onNewMail: (accountId, count) => {
      if (!settings.get().mailNotifications) return
      const email = listMailAccounts().find((account) => account.id === accountId)?.email ?? ''
      const notice = newMailNotice(count, email)
      // In the background: Windows announces it. In the main window: a popup in the app, which
      // leaves it out on the mail page. In a mail window the user is reading mail already.
      const focused = BrowserWindow.getFocusedWindow()
      if (!focused) tray.notifyNewMail(notice, accountId)
      else if (focused === mainWindow)
        focused.webContents.send('app:newMail', { ...notice, accountId })
    },
    log: (error) => console.warn('[mail] reading the INBOX unread count failed:', error)
  })
  // Started, stopped, restarted after an account change or the switch: show or hide the icon
  const sync = (): void => {
    tray.setVisible(settings.get().mailClient && listMailAccounts().length > 0)
    if (!tray.visible && mainWindow && !mainWindow.isVisible()) present(mainWindow)
  }
  mailClient.events.on('status', (status: { running: boolean }) => {
    sync()
    if (status.running) watch.onRunning()
  })
  mailClient.events.on('event', watch.onEvent)
  sync()
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
      bringToFront(open)
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
 *
 * I7 (MR-21): the window gets an opaque token, never the PDF's path. It sends through
 * mail.sendInvoice, where main attaches the PDF registered under that token; the token
 * is gone when the window closes. Not an IPC channel: only invoice:email and
 * contract:email (#120) open it.
 */
function openComposeWindow(input: {
  draft: ComposeDraft
  compose: DocumentCompose
  /** #121: where a "Wiedervorlage ohne Antwort" of this mail is filed */
  record: FollowUpRecord
}): Promise<ComposeResult> {
  const token = invoiceComposes.register(input.compose)
  const search = new URLSearchParams({
    account: input.compose.accountId,
    mode: 'compose',
    token,
    // base64 of the UTF-8 JSON: the JSON has characters that would break the URL fragment
    draft: Buffer.from(JSON.stringify(input.draft), 'utf8').toString('base64'),
    // the name only, for the attachment chip - the window never learns the path
    attachment: input.compose.fileName,
    record: `${input.record.type}:${input.record.id}`
  })
  return new Promise<ComposeResult>((resolve) => {
    const window = createAppWindow(
      { width: 900, height: 760, minWidth: 520, minHeight: 460 },
      `/mail/window?${search}`
    )
    // A window closed without a confirmed send means the user did not send
    window.on('closed', () => resolve(invoiceComposes.release(token)))
  })
}

/**
 * IPC Handler for opening files
 * Attempts to open the file with the system default application
 * Falls back to opening the folder if the file type is not recognized
 */
/**
 * Copy a link address from a mail to the clipboard.
 *
 * The renderer has no clipboard access by design (CSP 'self', and no navigator.clipboard use anywhere), so
 * the copy goes through the main process like every other copy in the app.
 *
 * The scheme allowlist is deliberate: a mail can contain a link we would never open, and "copy" must not
 * become a way to hand the user a file:// path or a javascript: URL to paste elsewhere.
 */
ipcMain.handle('mail:copyLink', (_event, { url }: { url: string }) => {
  const copyable = copyableLinkUrl(url)
  if (!copyable.ok) return { success: false, error: copyable.error }
  clipboard.writeText(copyable.url)
  return { success: true }
})

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
 * I7 (MR-12): with the mail program bookingum, the account chosen in the settings; checked
 * before anything is written or opened. null for every other mail program.
 */
function bookingumSender(settings: AppSettings): ReturnType<typeof invoiceSendAccount> | null {
  if (settings.mailProgram !== 'bookingum') return null
  if (!settings.mailClient) return { error: MAIL_CLIENT_OFF }
  return invoiceSendAccount(settings.invoiceMailAccountId, listMailAccounts())
}

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
      const sender = bookingumSender(settings)
      if (sender && 'error' in sender) return { success: false, error: sender.error }
      const name = fileName.replace(/\.pdf$/i, '')
      const { pdf, eInvoice } = await documentPdf(event.sender, name, invoiceId)
      const result = await openEmail({ draft, pdf, fileName: name, setting: settings.mailProgram })
      // C1: only the own editor knows whether the mail was really sent. Every external
      // program keeps marking the invoice when its window opens, as before.
      if (result.method === 'bookingum' && sender) {
        // The invoice is marked by the send itself (mail.sendInvoice), or later, when an
        // unclear send is confirmed - not here, where only the window's end is known
        const composed = await openComposeWindow({
          draft: { to: draft.to, subject: draft.subject, body: draft.body },
          compose: {
            invoiceId,
            kind,
            accountId: sender.account.id,
            pdfPath: result.pdfPath,
            fileName: basename(result.pdfPath)
          },
          record: { type: 'invoice', id: invoiceId }
        })
        if (!composed.sent) return { success: false, error: 'Nicht gesendet' }
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
 * #120 IPC Handler: "Per E-Mail senden" of a contract print page — the window's PDF and
 * an email from the "Vertrag" template, opened in the mail program like an invoice's.
 * The recipient comes from the stored contract, not the renderer. Nothing is recorded
 * on the contract: it has no email history.
 */
ipcMain.handle(
  'contract:email',
  async (
    event,
    {
      contract,
      id,
      fileName,
      lang
    }: { contract: ContractDocument; id: number; fileName: string; lang: Lang }
  ) => {
    try {
      const language: Lang = lang === 'en' ? 'en' : 'de'
      let data: ContractEmailData | null = null
      // #121: a concert contract's follow-up is on its event, a management contract's on the band
      let record: FollowUpRecord | null = null
      if (contract === 'management') {
        const print = await container.resolve(ManagementContractService).getPrintData(id)
        data = print ? managementContractEmailData(print) : null
        record = print ? { type: 'band', id: print.band.id } : null
      } else if (contract === 'concert') {
        const print = await container.resolve(ContractService).getContractData(id)
        data = print ? concertContractEmailData(print) : null
        record = { type: 'event', id }
      }
      if (!data || !record) return { success: false, error: 'Vertrag nicht gefunden' }
      const settings = container.resolve(SettingsService).get()
      const draft = contractEmail(data, language, settings[EMAIL_TEMPLATES.contract[language].key])
      const sender = bookingumSender(settings)
      if (sender && 'error' in sender) return { success: false, error: sender.error }
      const name = fileName.replace(/\.pdf$/i, '')
      const { pdf } = await documentPdf(event.sender, name)
      const result = await openEmail({
        draft,
        pdf,
        fileName: name,
        fallbackName: 'Vertrag',
        setting: settings.mailProgram
      })
      if (result.method === 'bookingum' && sender) {
        const composed = await openComposeWindow({
          draft: { to: draft.to, subject: draft.subject, body: draft.body },
          compose: {
            contract: data.document,
            accountId: sender.account.id,
            pdfPath: result.pdfPath,
            fileName: basename(result.pdfPath)
          },
          record
        })
        if (!composed.sent) return { success: false, error: 'Nicht gesendet' }
      }
      return { success: true, ...result, to: draft.to }
    } catch (error) {
      console.error('Error creating contract email:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
)

/**
 * The renderer's errors nothing caught, and render errors a boundary caught
 * (renderer lib/errorReporting.ts). Only the text and stack arrive; errorLog scrubs both.
 */
ipcMain.on('error-log:report', (event, report: unknown) => {
  if (!BrowserWindow.fromWebContents(event.sender)) return
  const { message, stack } = (report ?? {}) as { message?: unknown; stack?: unknown }
  if (typeof message !== 'string') return
  logError('renderer', { message, stack: typeof stack === 'string' ? stack : undefined })
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
 * IPC Handler: pick a CSV file for the import dialog and return its rows (as
 * text, plus a suggested column mapping)
 */
ipcMain.handle('import:pickFile', async (event) => {
  try {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'CSV-Datei importieren',
      properties: ['openFile'],
      filters: [{ name: 'CSV-Datei', extensions: ['csv', 'txt'] }]
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
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
  // also when it waits hidden in the tray
  if (mainWindow) showMainWindow()
})

/**
 * Brings the database to this version's schema. Before pending migrations change it, a copy
 * goes to backup/before-update/; a database from a newer version is left alone. On failure the
 * user gets the reason and the app quits instead of opening on a half-migrated database.
 */
function migrateDatabase(): boolean {
  const workDir = backupLocations(app.getPath('userData')).workDir
  let copy: string | null = null
  try {
    runMigrations({
      beforeApply: (pending) => {
        copy = copyBeforeUpdate({
          sqlite: getSqlite(),
          workDir,
          fromVersion: readLastVersion(workDir),
          now: new Date()
        })
        console.log(`Database copied before ${pending} migration(s): ${copy}`)
        try {
          pruneBeforeUpdate(workDir)
        } catch (error) {
          console.error('Removing old copies from before an update failed:', error)
        }
      }
    })
    writeLastVersion(workDir, app.getVersion())
    return true
  } catch (error) {
    console.error('Migrating the database failed:', error)
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(
      'Bookingium kann nicht starten',
      message.startsWith('Die ')
        ? message
        : 'Die Datenbank konnte nicht auf diese Version aktualisiert werden.' +
            (copy ? `\n\nEine Kopie von vorher liegt hier:\n${copy}` : '') +
            `\n\n${message}`
    )
    app.quit()
    return false
  }
}

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return
  // Set app user model id for windows
  // The appId of electron-builder.yml: Windows shows it on notifications and groups the taskbar
  // by it (the toolkit passes the executable's path in dev)
  electronApp.setAppUserModelId('com.bookingium.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Einstellungen › Daten › "Sicherung wiederherstellen…": a restore staged before the restart
  // replaces the data now, before anything opens the database
  try {
    container.resolve(BackupService).applyStagedRestore()
  } catch (error) {
    console.error('Applying a staged restore failed:', error)
  }
  if (!migrateDatabase()) return
  // Map preview (#102): OSM refuses tiles to the packaged app without an app User-Agent
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: TILE_REQUEST_URLS },
    (details, callback) => {
      callback({
        requestHeaders: { ...details.requestHeaders, 'User-Agent': tileUserAgent(app.getVersion()) }
      })
    }
  )
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
  // Automatic backups: checked after startup, then hourly; each run copies in the background
  // #54: the key of password-encrypted backups is sealed by the system between runs
  container.resolve(BackupService).start(app.getVersion(), {
    available: () => safeStorage.isEncryptionAvailable(),
    seal: (plain) => safeStorage.encryptString(plain).toString('base64'),
    open: (sealed) => safeStorage.decryptString(Buffer.from(sealed, 'base64'))
  })
  // I7 (H3): an invoice mail whose send was unclear is marked once the core confirms it -
  // by the startup probe too, so this listens before the client starts
  const invoiceLedger = container.resolve(InvoiceService)
  mailClient.events.on('event', (event) => {
    void confirmInvoiceSendFromOp(
      {
        registry: invoiceComposes,
        ledger: invoiceLedger,
        listOps: (accountId) => mailClient.call('listOps', [accountId]) as Promise<OpSummary[]>
      },
      event
    ).catch((error) => console.error('Confirming an invoice mail failed:', error))
  })
  // Mail client (utility process): background sync for configured accounts, only while
  // the "E-Mail (experimentell)" setting is on
  mailClient.setEnabledCheck(() => container.resolve(SettingsService).get().mailClient)
  mailClient.startIfConfigured()
  // After sleep the worker's sockets may be dead without either side knowing: it reconnects and
  // catches up once per wake
  watchSystemWake(() => mailClient.notifySystemResume(), {
    onResume: (listener) => powerMonitor.on('resume', listener),
    isOnline: () => net.isOnline()
  })
  // #65: tray icon and new-mail notifications, from each account's INBOX unread count
  setUpMailTray()
  // C2: link incoming mail to the records it belongs to, after each folder sync.
  // The linker yields between batches, so a big mailbox never blocks the app.
  const mailLinks = container.resolve(MailLinkService)
  // #55: the database keeps each account's address, so a backup can find its account again
  mailLinks.rememberAccounts(listMailAccounts())
  const mailLinkRuns = mailLinkRunner({
    // Every configured account's address and alias is the user's own (host L3)
    link: async (accountId) => {
      const result = await mailLinks.linkAccount(accountId, ownMailAddresses(listMailAccounts()))
      // #121: follow-ups closed by a reply; the open windows show them done
      if (result.answered > 0) {
        mailClient.events.emit('event', {
          type: 'follow-ups-answered',
          accountId,
          count: result.answered
        } satisfies MailEvent)
      }
      return result
    },
    log: (error) => console.error('Linking mail failed:', error)
  })
  mailClient.events.on('event', mailLinkRuns.onEvent)
  // A contact that gained an address gets its older mail too: the run sees the changed
  // addresses and starts again from the first mail
  contactAddressEvents.on('saved', () => {
    for (const account of listMailAccounts()) mailLinkRuns.run(account.id)
  })
  // B6: opened attachments live a day at most
  void cleanAttachmentTemp()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    showMainWindow()
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
  quitting = true
  if (mailStopped) return
  event.preventDefault()
  container.resolve(BackupService).stop()
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
