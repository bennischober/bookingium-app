// #65: what the tray icon and the notifications say, and the dot the icon gets while mail is
// unread. Counts and account addresses only, never a subject, a sender or a follow-up's note:
// they would show on the lock screen and in the notification history. #142: the tray and the
// notifications belong to the app, mail only adds its counts. Kept free of Electron for the tests.

export interface TrayAccount {
  email: string
  unread: number
}

/** A notification's text: the desktop notification and the in-app popup say the same */
export interface Notice {
  title: string
  body: string
}

/** Windows cuts a tray tooltip at 127 characters */
export const TRAY_TOOLTIP_MAX = 127

const mails = (n: number): string => `${n} ${n === 1 ? 'ungelesene E-Mail' : 'ungelesene E-Mails'}`

/**
 * The tray icon's tooltip: the app's name, and with mail accounts the unread total, then each
 * account's share when there are several
 */
export function trayTooltip(accounts: TrayAccount[]): string {
  if (accounts.length === 0) return 'Bookingium'
  const total = accounts.reduce((sum, account) => sum + account.unread, 0)
  const lines = [`Bookingium – ${mails(total)}`]
  if (accounts.length > 1) {
    for (const account of accounts) lines.push(`${account.email}: ${account.unread}`)
  }
  const text = lines.join('\n')
  return text.length > TRAY_TOOLTIP_MAX ? `${text.slice(0, TRAY_TOOLTIP_MAX - 1)}…` : text
}

/** The desktop notification for `count` new mails in one account */
export function newMailNotice(count: number, email: string): Notice {
  return {
    title: count === 1 ? 'Neue E-Mail' : `${count} neue E-Mails`,
    body: email ? `Im Posteingang von ${email}` : 'Im Posteingang'
  }
}

/** Which window has the focus when something is announced: none (the app is in the background) */
export type WindowFocus = 'none' | 'main' | 'other'

/**
 * #133: where new mail is announced, if at all. In the background Windows announces it, with the
 * main window in front the app's own popup, and in a mail window nothing: the user is reading mail
 * already. Each has its own switch, both off by default; the unread counts show either way.
 */
export function newMailChannel(
  focus: WindowFocus,
  settings: { desktop: boolean; inApp: boolean }
): 'desktop' | 'app' | null {
  if (focus === 'none') return settings.desktop ? 'desktop' : null
  if (focus === 'main') return settings.inApp ? 'app' : null
  return null
}

/**
 * #142: where a reminder is announced (its switch is checked before): with the main window in
 * front the app's popup, otherwise Windows. Unlike new mail, a mail window in front does not
 * swallow it.
 */
export const reminderChannel = (focus: WindowFocus): 'desktop' | 'app' =>
  focus === 'main' ? 'app' : 'desktop'

/** #142: the daily summary of open follow-ups due today or earlier; the count only */
export function followUpSummaryNotice(count: number): Notice {
  return {
    title: count === 1 ? '1 Wiedervorlage fällig' : `${count} Wiedervorlagen fällig`,
    body: 'Heute fällig oder überfällig. Zur Übersicht im Dashboard.'
  }
}

/** #71: when a reminded appointment starts; YYYY-MM-DD and HH:MM (null: all-day) */
export interface AppointmentStart {
  startDate: string
  startTime: string | null
}

/** "heute", "morgen" or "am 14.11." for a day, seen from `today` (all YYYY-MM-DD) */
function dayWords(isoDate: string, today: string): string {
  if (isoDate === today) return 'heute'
  const [year, month, day] = today.split('-').map(Number)
  const next = new Date(year, month - 1, day + 1)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const tomorrow = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`
  if (isoDate === tomorrow) return 'morgen'
  const [, m, d] = isoDate.split('-')
  return `am ${d}.${m}.`
}

/**
 * #71: the reminder of own appointments that are due, the earliest first. The day and time only,
 * never the title: like the mail notices it would show on the lock screen.
 */
export function appointmentReminderNotice(due: AppointmentStart[], today: string): Notice {
  const first = due[0]
  const when = [dayWords(first.startDate, today), first.startTime && `um ${first.startTime}`]
    .filter(Boolean)
    .join(' ')
  return due.length === 1
    ? { title: `Termin ${when}`, body: 'Erinnerung an einen eigenen Termin. Zum Kalender.' }
    : {
        title: `${due.length} Termine, der erste ${when}`,
        body: 'Erinnerung an eigene Termine. Zum Kalender.'
      }
}

/** Shown once per session when closing the window keeps the app in the tray */
export function stillRunningNotice(hasMail: boolean): Notice {
  return {
    title: 'Bookingium läuft weiter',
    body: hasMail
      ? 'Erinnerungen und E-Mails kommen weiter. Beenden über das Symbol im Infobereich.'
      : 'Erinnerungen kommen weiter. Beenden über das Symbol im Infobereich.'
  }
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
