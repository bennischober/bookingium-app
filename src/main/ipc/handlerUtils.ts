import { BrowserWindow, dialog } from 'electron'

/**
 * Shared parts of the native IPC channels (`ipcMain.handle`) that live outside tRPC:
 * the failure answer and dialogs attached to the window that asked.
 */

/** The answer of a channel that failed: the error's message, never its stack */
export function failure(error: unknown): { success: false; error: string } {
  return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
}

/** A save dialog in front of the window that sent the request (free-standing without one) */
export function showSaveDialogFor(
  sender: Electron.WebContents,
  options: Electron.SaveDialogOptions
): Promise<Electron.SaveDialogReturnValue> {
  const owner = BrowserWindow.fromWebContents(sender)
  return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
}

/** An open dialog in front of the window that sent the request (free-standing without one) */
export function showOpenDialogFor(
  sender: Electron.WebContents,
  options: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> {
  const owner = BrowserWindow.fromWebContents(sender)
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
}
