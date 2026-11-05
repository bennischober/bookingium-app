// #65: the tray icon (Infobereich) and the desktop notification for new mail. The icon is there
// while the mail client is on and has an account; its tooltip has the INBOX unread counts and a
// red dot marks unread mail. index.ts decides when it shows, what a click opens, and whether new
// mail is announced here (app in the background) or in the app.
import { Menu, Notification, Tray, nativeImage, type NativeImage } from 'electron'
import { trayTooltip, withUnreadDot, type MailNotice, type TrayAccount } from './trayText'

export interface MailTrayDeps {
  icon: string
  /** The configured accounts, in their order */
  accounts: () => { id: string; email: string }[]
  /** Brings the main window up (shows it if it is hidden in the tray) */
  showApp: () => void
  /** Brings the main window up on the mail page */
  showMail: () => void
  quit: () => void
}

/** Tray icons are drawn at 16 px on Windows (32 px on a 200 % screen) */
const TRAY_SIZE = 32
/** New-mail notifications kept alive for their click */
const HELD_NOTIFICATIONS = 10

export class MailTray {
  private tray: Tray | null = null
  private unread: Record<string, number> = {}
  // A notification that is collected loses its click handler
  private readonly shown = new Set<Notification>()
  private readonly plain: NativeImage
  private readonly dotted: NativeImage

  constructor(private readonly deps: MailTrayDeps) {
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

  setVisible(visible: boolean): void {
    if (visible === this.visible) return
    if (!visible) {
      this.tray?.destroy()
      this.tray = null
      return
    }
    const tray = new Tray(this.plain)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Bookingium öffnen', click: () => this.deps.showApp() },
        { label: 'E-Mail öffnen', click: () => this.deps.showMail() },
        { type: 'separator' },
        { label: 'Beenden', click: () => this.deps.quit() }
      ])
    )
    tray.on('click', () => this.deps.showApp())
    this.tray = tray
    this.render()
  }

  setCounts(unread: Record<string, number>): void {
    this.unread = unread
    this.render()
  }

  /** Desktop notification for new mail (newMailNotice); a click opens the mail page */
  notifyNewMail(notice: MailNotice): void {
    if (!Notification.isSupported()) return
    const notification = new Notification({ ...notice, icon: this.plain })
    notification.on('click', () => {
      this.shown.delete(notification)
      this.deps.showMail()
    })
    // Windows emits 'close' when a toast moves to the notification centre, where it can still be
    // clicked: the latest few stay held instead
    this.shown.add(notification)
    if (this.shown.size > HELD_NOTIFICATIONS) this.shown.delete(this.shown.values().next().value!)
    notification.show()
  }

  /** A plain notice (no click action) */
  notify(notice: MailNotice): void {
    if (!Notification.isSupported()) return
    new Notification({ ...notice, icon: this.plain }).show()
  }

  private render(): void {
    const tray = this.tray
    if (!tray) return
    const accounts: TrayAccount[] = this.deps
      .accounts()
      .map((account) => ({ email: account.email, unread: this.unread[account.id] ?? 0 }))
    const total = accounts.reduce((sum, account) => sum + account.unread, 0)
    tray.setImage(total > 0 ? this.dotted : this.plain)
    tray.setToolTip(trayTooltip(accounts))
  }
}
