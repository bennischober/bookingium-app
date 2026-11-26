import { BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { is } from '@electron-toolkit/utils'
import { createIPCHandler } from 'electron-trpc/main'
import icon from '../../../resources/icon.png?asset'
import { router } from '../api/router'
import { isAppDocument } from '../utils/navigation'
import type { WindowFocus } from '../notifications/noticeText'

/**
 * The app's windows: the main window, one window per opened mail, the compose windows.
 * All of them share one tRPC handler and the same close and navigation rules.
 */

// One tRPC handler for all windows; each new window is attached to it
let ipcHandler: ReturnType<typeof createIPCHandler> | null = null
let mainWindow: BrowserWindow | null = null
// Mails opened in their own window, by `${accountId}:${messageId}`
const mailWindows = new Map<string, BrowserWindow>()
// The app is quitting (or Windows is ending the session): a close is a close, never a hide
let quitting = false
// #65: asked when the main window closes; true keeps the app in the tray instead
let hideMainOnClose: () => boolean = () => false

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

/** From now on a close really closes (app quit, end of the Windows session) */
export function markQuitting(): void {
  quitting = true
}

/** #65: what decides whether closing the main window only hides it */
export function setMainWindowHideOnClose(decide: () => boolean): void {
  hideMainOnClose = decide
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/**
 * A renderer window showing the route `hash` (e.g. '/mail/window?…'), or the app's start page.
 * `hideOnClose`: asked on each close; true hides the window instead (#65, the tray).
 */
export function createAppWindow(
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

export function createMainWindow(hash?: string): void {
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
    () => hideMainOnClose()
  )
  // The mail windows belong to it; each saves an unsaved reply before it closes
  mainWindow.on('closed', () => {
    mainWindow = null
    for (const window of mailWindows.values()) window.close()
  })
}

/** Which of the app's windows has the focus, if any */
export function windowFocus(): WindowFocus {
  const focused = BrowserWindow.getFocusedWindow()
  return !focused ? 'none' : focused === mainWindow ? 'main' : 'other'
}

/** Brings the main window up: shown again from the tray, restored, focused; or opened anew */
export function showMainWindow(hash?: string): BrowserWindow | null {
  const window = mainWindow
  if (!window) {
    createMainWindow(hash)
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
export function showMailPage(accountId?: string): void {
  const hash = accountId ? `/mail?newMail=${encodeURIComponent(accountId)}` : '/mail'
  showMainWindow(hash)?.webContents.send('app:openMailPage', accountId)
}

/** #142: the main window on the dashboard, whose card lists the due follow-ups */
export function showFollowUps(): void {
  showMainWindow('/')?.webContents.send('app:openDashboard')
}

/** #71: the main window on the calendar, that day selected (an appointment's reminder) */
export function showCalendarDay(day: string): void {
  showMainWindow(`/calendar?day=${day}`)?.webContents.send('app:openCalendar', day)
}

/**
 * Opens a mail in its own window (double-click in the list), or brings the window
 * that already shows it to the front
 */
export function openMailWindow(accountId: string, messageId: number): void {
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

/**
 * #307: editors handed from the main window to a window of their own. The state stays here,
 * keyed by a one-time token, until the new window takes it: a draft with attachments is far
 * too big for the window's query.
 */
const composeHandoffs = new Map<string, unknown>()

/** #307: opens the editor the main window hands over in its own window */
export function openComposeWindow(accountId: string, state: unknown): void {
  const token = randomUUID()
  composeHandoffs.set(token, state)
  const search = new URLSearchParams({ account: accountId, handoff: token })
  const window = createAppWindow(
    { width: 820, height: 720, minWidth: 480, minHeight: 400 },
    `/mail/window?${search}`
  )
  window.on('closed', () => composeHandoffs.delete(token))
}

/** #307: the handed-over editor state, once; a second call (a reload) gets null */
export function takeComposeHandoff(token: string): unknown {
  const state = composeHandoffs.get(token) ?? null
  composeHandoffs.delete(token)
  return state
}
