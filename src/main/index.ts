import 'reflect-metadata'
import { app, BrowserWindow, powerMonitor, safeStorage, session, shell } from 'electron'
import { join } from 'path'
import { hostname } from 'os'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { container } from 'tsyringe'
import { startErrorLogging } from './app/errorLogging'
import { setUpMailWatch, startMailClient, startMailLinking } from './app/mailServices'
import { migrateDatabase } from './app/migrateDatabase'
import { checkForUpdates, startUpdates } from './app/updates'
import { setUpReminders } from './app/reminders'
import { keepInTray, setUpTray } from './app/tray'
import {
  createMainWindow,
  getMainWindow,
  markQuitting,
  setMainWindowHideOnClose,
  showMainWindow
} from './app/windows'
import { cleanAttachmentTemp } from './api/routers/mail.router'
import { seedDatabase } from './db/seed'
import { registerDocumentMailIpc } from './ipc/documentMail'
import { registerDocumentIpc } from './ipc/documents'
import { registerImportIpc } from './ipc/import'
import { registerMailIpc } from './ipc/mail'
import { registerPrintIpc } from './ipc/print'
import { mailClient } from './mailclient/MailClientService'
import { TILE_REQUEST_URLS, tileUserAgent } from './map/tileRequests'
import { BackupService } from './services/BackupService'
import { CalendarFeedService } from './services/CalendarFeedService'
import { DocumentService } from './services/DocumentService'
import { SyncService } from './services/SyncService'

/**
 * The main process's start: the data folder, the single-instance lock, the native IPC channels
 * and the startup order once Electron is ready. What each step does lives in `app/` (windows,
 * tray, reminders, mail, migrations, error log) and `ipc/` (channels outside tRPC).
 */

// Data folder (database, documents): %APPDATA%/bookingum-app for the dev
// and the installed app alike. Electron would derive it from the app name,
// which is "Bookingium" when packaged. Tests pass their own temp folder.
if (process.env.BOOKINGIUM_USER_DATA) {
  app.setPath('userData', process.env.BOOKINGIUM_USER_DATA)
} else {
  app.setPath('userData', join(app.getPath('appData'), 'bookingum-app'))
}
startErrorLogging()
// One app per data folder: a second one would open the same database and mail
// store. The lock is taken per userData, so tests with their own folder still run
// next to the app. A second start brings the running window to the front instead.
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) app.exit(0)

// Native channels outside tRPC (src/preload/index.ts), registered before any window loads
registerMailIpc()
registerDocumentIpc()
registerPrintIpc()
registerDocumentMailIpc()
registerImportIpc()

// #65: closing the main window may only hide it in the tray
setMainWindowHideOnClose(keepInTray)

app.on('second-instance', () => {
  // also when it waits hidden in the tray
  if (getMainWindow()) showMainWindow()
})

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return
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
  // Demo data belongs to development and the e2e app, which both run unpackaged.
  // An installed app starts with an empty database.
  if (!app.isPackaged) {
    await seedDatabase().catch((error) => {
      console.error('Database seeding failed:', error)
    })
  }

  // Sync with other computers (Einstellungen › Daten › Abgleich): checks the identity, switches
  // the change triggers on and runs every few seconds; changes from elsewhere refresh the windows
  await container
    .resolve(SyncService)
    .start({
      appVersion: app.getVersion(),
      deviceName: hostname(),
      removeFile: (file) => shell.trashItem(file),
      onChanged: () => {
        for (const window of BrowserWindow.getAllWindows())
          if (!window.isDestroyed()) window.webContents.send('app:dataChanged')
        void container.resolve(CalendarFeedService).update()
      },
      // another computer runs a newer version: fetch it here too, so both match again soon
      onNewerVersionElsewhere: () => void checkForUpdates()
    })
    .catch((error) => console.error('Starting sync failed:', error))
  // Waking up (a laptop opened again) or coming back to the window: sync right away
  powerMonitor.on('resume', () => container.resolve(SyncService).nudge())
  powerMonitor.on('unlock-screen', () => container.resolve(SyncService).nudge())
  app.on('browser-window-focus', () => container.resolve(SyncService).nudge())

  createMainWindow()
  // Automatic backups: checked after startup, then hourly; each run copies in the background
  // #54: the key of password-encrypted backups is sealed by the system between runs
  container.resolve(BackupService).start(app.getVersion(), {
    available: () => safeStorage.isEncryptionAvailable(),
    seal: (plain) => safeStorage.encryptString(plain).toString('base64'),
    open: (sealed) => safeStorage.decryptString(Buffer.from(sealed, 'base64'))
  })
  // #49: the installed app updates itself from GitHub Releases (installed when it closes)
  startUpdates()
  startMailClient()
  // #65, #142: the tray icon, reminders, and new-mail notifications from each INBOX's unread count
  const tray = setUpTray()
  setUpReminders(tray)
  setUpMailWatch(tray)
  startMailLinking()
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
  markQuitting()
  if (mailStopped) return
  event.preventDefault()
  container.resolve(BackupService).stop()
  void Promise.all([
    mailClient.stop().catch((error) => console.error('Stopping the mail client failed:', error)),
    // the last edits go to the other computers before the app closes (a few seconds at most)
    container
      .resolve(SyncService)
      .stop()
      .catch((error) => console.error('Stopping sync failed:', error))
  ]).finally(() => {
    mailStopped = true
    app.quit()
  })
})
