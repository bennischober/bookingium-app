import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { initErrorLog, logError } from '../utils/errorLog'

/**
 * Real bugs only, on this machine (utils/errorLog.ts): the main process's uncaught errors,
 * renderers and helper processes that died, and what the renderer reports. Called right after
 * the data folder is set, before anything else can fail.
 */
export function startErrorLogging(): void {
  initErrorLog({ folder: join(app.getPath('userData'), 'logs'), version: app.getVersion() })
  // The monitor leaves Electron's own handling of an uncaught exception as it was.
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
    if (
      details.type === 'Utility' ||
      details.reason === 'clean-exit' ||
      details.reason === 'killed'
    )
      return
    logError(
      'process',
      `${details.type} process gone: ${details.reason} (exit code ${details.exitCode})`,
      { fatal: true }
    )
  })
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
}
