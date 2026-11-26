import { clipboard, ipcMain } from 'electron'
import { openComposeWindow, openMailWindow, takeComposeHandoff } from '../app/windows'
import { copyableLinkUrl } from '../mail/linkClipboard'

/** The mail page's native channels; everything else of the mail client goes through tRPC */
export function registerMailIpc(): void {
  /**
   * Opens a mail in its own window (double-click in the list), or brings the window
   * that already shows it to the front
   */
  ipcMain.handle(
    'mail:openWindow',
    (_event, { accountId, messageId }: { accountId: string; messageId: number }) => {
      if (typeof accountId !== 'string' || !accountId || !Number.isSafeInteger(messageId)) return
      openMailWindow(accountId, messageId)
    }
  )

  /** #307: an editor of the main window moves to a window of its own */
  ipcMain.handle(
    'mail:popOutCompose',
    (_event, { accountId, state }: { accountId: string; state: unknown }) => {
      if (typeof accountId !== 'string' || !accountId || typeof state !== 'object' || !state) return
      openComposeWindow(accountId, state)
    }
  )

  /** #307: the new window takes the editor it was opened for */
  ipcMain.handle('mail:takeCompose', (_event, { token }: { token: string }) =>
    typeof token === 'string' ? takeComposeHandoff(token) : null
  )

  /**
   * Copy a link address from a mail to the clipboard.
   *
   * The renderer has no clipboard access by design (CSP 'self', and no navigator.clipboard use
   * anywhere), so the copy goes through the main process like every other copy in the app.
   *
   * The scheme allowlist is deliberate: a mail can contain a link we would never open, and
   * "copy" must not become a way to hand the user a file:// path or a javascript: URL to paste
   * elsewhere.
   */
  ipcMain.handle('mail:copyLink', (_event, { url }: { url: string }) => {
    const copyable = copyableLinkUrl(url)
    if (!copyable.ok) return { success: false, error: copyable.error }
    clipboard.writeText(copyable.url)
    return { success: true }
  })
}
