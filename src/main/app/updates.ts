import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatusDto } from '../api/schemas/updates.schema'
import {
  initialUpdateStatus,
  nextUpdateStatus,
  updateErrorMessage,
  type UpdateEvent
} from '../updates/state'

/**
 * Auto-update (#49): the installed app looks for a newer release of the public GitHub repository
 * (electron-builder.yml `publish`), downloads it in the background and installs it when the app
 * is closed - or right away when the user clicks "Jetzt neu starten". Development and the e2e
 * app (unpackaged) never update themselves.
 *
 * Checks: shortly after start, then every few hours, on "Nach Updates suchen", and when the sync
 * sees another computer on a newer version (so both are on the same one again soon).
 */

const FIRST_CHECK_MS = 30_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let status: UpdateStatusDto = initialUpdateStatus('0.0.0', false)
let checking: Promise<void> | null = null
let started = false

function apply(event: UpdateEvent): void {
  const before = status.phase
  status = nextUpdateStatus(status, event)
  if (status.phase === 'ready' && before !== 'ready') {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed())
        window.webContents.send('app:updateReady', { version: status.version })
  }
}

const now = () => new Date().toISOString()

export function updateStatus(): UpdateStatusDto {
  return status
}

/** A check now; a second call while one runs joins it. Never throws (status.error) */
export function checkForUpdates(): Promise<void> {
  if (status.phase === 'unsupported') return Promise.resolve()
  if (!checking) {
    checking = autoUpdater
      .checkForUpdates()
      .then(() => undefined)
      .catch((error: unknown) => {
        apply({
          type: 'error',
          message: updateErrorMessage(error instanceof Error ? error.message : String(error)),
          at: now()
        })
      })
      .finally(() => {
        checking = null
      })
  }
  return checking
}

/** "Jetzt neu starten": closes the app (sync and mail shut down as usual) and installs */
export function installUpdateNow(): void {
  if (status.phase !== 'ready') throw new Error('Es ist kein Update bereit.')
  // silent install, and Bookingium starts again afterwards
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}

export function startUpdates(): void {
  if (started) return
  started = true
  status = initialUpdateStatus(app.getVersion(), app.isPackaged)
  if (!app.isPackaged) return
  autoUpdater.logger = null
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.on('checking-for-update', () => apply({ type: 'checking', at: now() }))
  autoUpdater.on('update-available', (info) => apply({ type: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => apply({ type: 'not-available', at: now() }))
  autoUpdater.on('download-progress', (progress) =>
    apply({ type: 'progress', percent: progress.percent })
  )
  autoUpdater.on('update-downloaded', (info) =>
    apply({ type: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (error) =>
    apply({ type: 'error', message: updateErrorMessage(error.message), at: now() })
  )
  const check = () => {
    void checkForUpdates()
  }
  setTimeout(check, FIRST_CHECK_MS).unref()
  setInterval(check, CHECK_INTERVAL_MS).unref()
}
