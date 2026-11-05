// #65: what the tray icon and the new-mail notification say, and the dot the icon gets while
// mail is unread. Counts and account addresses only, never a subject or a sender: they would show
// on the lock screen and in the notification history. Kept free of Electron for the tests.

export interface TrayAccount {
  email: string
  unread: number
}

/** A notification's text: the desktop notification and the in-app popup say the same */
export interface MailNotice {
  title: string
  body: string
}

/** Windows cuts a tray tooltip at 127 characters */
export const TRAY_TOOLTIP_MAX = 127

const mails = (n: number): string => `${n} ${n === 1 ? 'ungelesene E-Mail' : 'ungelesene E-Mails'}`

/** The tray icon's tooltip: the total, then each account's share when there are several */
export function trayTooltip(accounts: TrayAccount[]): string {
  const total = accounts.reduce((sum, account) => sum + account.unread, 0)
  const lines = [`Bookingium – ${mails(total)}`]
  if (accounts.length > 1) {
    for (const account of accounts) lines.push(`${account.email}: ${account.unread}`)
  }
  const text = lines.join('\n')
  return text.length > TRAY_TOOLTIP_MAX ? `${text.slice(0, TRAY_TOOLTIP_MAX - 1)}…` : text
}

/** The desktop notification for `count` new mails in one account */
export function newMailNotice(count: number, email: string): MailNotice {
  return {
    title: count === 1 ? 'Neue E-Mail' : `${count} neue E-Mails`,
    body: email ? `Im Posteingang von ${email}` : 'Im Posteingang'
  }
}

/** Shown once per session when closing the window keeps the app in the tray */
export const STILL_RUNNING_NOTICE: MailNotice = {
  title: 'Bookingium läuft weiter',
  body: 'E-Mails werden weiter abgerufen. Beenden über das Symbol im Infobereich.'
}

/**
 * The icon with a red dot in its lower right corner, for unread mail. Works on a raw 32-bit
 * bitmap as Electron's `NativeImage.toBitmap()` returns it (BGRA, rows top to bottom), and
 * returns a new buffer.
 */
export function withUnreadDot(bitmap: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(bitmap)
  const radius = Math.max(2, Math.round(Math.min(width, height) * 0.22))
  const cx = width - radius - 0.5
  const cy = height - radius - 0.5
  // A light ring keeps the dot readable on a dark taskbar and on the icon itself
  const ring = Math.max(1, Math.round(radius / 4))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot(x - cx, y - cy)
      if (distance > radius) continue
      const i = (y * width + x) * 4
      const edge = distance > radius - ring
      out[i] = edge ? 0xff : 0x2b // B
      out[i + 1] = edge ? 0xff : 0x2b // G
      out[i + 2] = edge ? 0xff : 0xdc // R
      out[i + 3] = 0xff // A
    }
  }
  return out
}
