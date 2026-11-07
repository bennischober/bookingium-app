// #65, #142: the tray icon (Infobereich) and the app's desktop notifications. The icon is there
// while the app runs; with mail accounts its tooltip has the INBOX unread counts, a red dot marks
// unread mail and the menu has "E-Mail öffnen". index.ts decides what a click opens and whether
// something is announced here (app in the background) or in the app.
import { Menu, Notification, Tray, nativeImage, type NativeImage } from 'electron'
import { trayTooltip, withUnreadDot, type Notice, type TrayAccount } from './noticeText'

export interface AppTrayDeps {
  icon: string
  /** The configured mail accounts, in their order (none: no mail parts) */
  mailAccounts: () => { id: string; email: string }[]
  /** Brings the main window up (shows it if it is hidden in the tray) */
  showApp: () => void
  /** Brings the main window up on the mail page; with an account, on its newest unread mail */
  showMail: (accountId?: string) => void
  quit: () => void
}

/** Tray icons are drawn at 16 px on Windows (32 px on a 200 % screen) */
const TRAY_SIZE = 32
/** Notifications kept alive for their click */
const HELD_NOTIFICATIONS = 10

export class AppTray {
  private tray: Tray | null = null
  private unread: Record<string, number> = {}
  private menuWithMail: boolean | null = null
  // A notification that is collected loses its click handler
  private readonly shown = new Set<Notification>()
  private readonly plain: NativeImage
  private readonly dotted: NativeImage

  constructor(private readonly deps: AppTrayDeps) {
    this.plain = nativeImage
      .createFromPath(deps.icon)
      .resize({ width: TRAY_SIZE, height: TRAY_SIZE })
    const { width, height } = this.plain.getSize()
    this.dotted = nativeImage.createFromBitmap(
      Buffer.from(withUnreadDot(this.plain.toBitmap(), width, height)),
      { width, height }
    )
  }

  get visible(): boolean {
    return this.tray !== null
  }

  /** Puts the icon into the tray (once) */
  show(): void {
    if (this.tray) return
    const tray = new Tray(this.plain)
    tray.on('click', () => this.deps.showApp())
    this.tray = tray
    this.refresh()
  }

  setCounts(unread: Record<string, number>): void {
    this.unread = unread
    this.refresh()
  }

  /** Redraws icon, tooltip and menu, e.g. after a mail account was added or removed */
  refresh(): void {
    const tray = this.tray
    if (!tray) return
    const accounts: TrayAccount[] = this.deps
      .mailAccounts()
      .map((account) => ({ email: account.email, unread: this.unread[account.id] ?? 0 }))
    const total = accounts.reduce((sum, account) => sum + account.unread, 0)
    tray.setImage(total > 0 ? this.dotted : this.plain)
    tray.setToolTip(trayTooltip(accounts))
    const withMail = accounts.length > 0
    if (withMail === this.menuWithMail) return
    this.menuWithMail = withMail
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Bookingium öffnen', click: () => this.deps.showApp() },
        ...(withMail ? [{ label: 'E-Mail öffnen', click: () => this.deps.showMail() }] : []),
        { type: 'separator' },
        { label: 'Beenden', click: () => this.deps.quit() }
      ])
    )
  }

  /** A desktop notification; with `onClick`, a click on it (or in the notification centre) */
  notify(notice: Notice, onClick?: () => void): void {
    if (!Notification.isSupported()) return
    const notification = new Notification({ ...notice, icon: this.plain })
    if (onClick) {
      notification.on('click', () => {
        this.shown.delete(notification)
        onClick()
      })
      // Windows emits 'close' when a toast moves to the notification centre, where it can still
      // be clicked: the latest few stay held instead
      this.shown.add(notification)
      if (this.shown.size > HELD_NOTIFICATIONS) this.shown.delete(this.shown.values().next().value!)
    }
    notification.show()
  }
}
