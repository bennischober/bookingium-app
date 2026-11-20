import { t, uiLocale } from '../../../main/i18n/translate'
// Dates for follow-ups (Wiedervorlagen). Due dates are plain local dates
// ("2026-10-21"), so "today" is the local calendar day, not UTC.

/** The local calendar day as 2026-10-21 */
export function localIsoDate(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 2026-10-21 plus 3 days -> 2026-10-24 */
export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  return localIsoDate(new Date(year, month - 1, day + days))
}

/** 2026-10-21 -> 21.10.2026 */
export const germanDate = (iso: string): string => iso.split('-').reverse().join('.')

/** Quick picks in the dialog, counted from today */
export const DUE_PRESETS = [
  { label: t('Morgen'), days: 1 },
  { label: t('In 3 Tagen'), days: 3 },
  { label: t('In 1 Woche'), days: 7 },
  { label: t('In 2 Wochen'), days: 14 }
] as const

export type DueState = 'overdue' | 'today' | 'upcoming'

export function dueState(dueDate: string, today: string = localIsoDate()): DueState {
  if (dueDate < today) return 'overdue'
  if (dueDate === today) return 'today'
  return 'upcoming'
}

/** "Überfällig seit 18.10.", "Heute", "Morgen" or "Fr, 24.10.2026" */
export function dueLabel(dueDate: string, today: string = localIsoDate()): string {
  const state = dueState(dueDate, today)
  if (state === 'overdue')
    return t('Überfällig seit {{germanDate}}', { germanDate: germanDate(dueDate) })
  if (state === 'today') return t('Heute')
  if (dueDate === addDays(today, 1)) return t('Morgen')
  const [year, month, day] = dueDate.split('-').map(Number)
  const weekday = new Date(year, month - 1, day).toLocaleDateString(uiLocale(), {
    weekday: 'short'
  })
  return `${weekday}, ${germanDate(dueDate)}`
}

/** A SQLite UTC time ("2026-11-06 09:30:00") as its local calendar day, or null */
function localDayOf(utc: string): string | null {
  const date = new Date(utc.replace(' ', 'T') + (utc.endsWith('Z') ? '' : 'Z'))
  return Number.isNaN(date.getTime()) ? null : localIsoDate(date)
}

/** done_at (SQLite UTC, "2026-11-06 09:30:00") -> "Erledigt am 06.11.2026", in local time */
export function doneLabel(doneAt: string): string {
  const day = localDayOf(doneAt)
  return day ? t('Erledigt am {{germanDate}}', { germanDate: germanDate(day) }) : t('Erledigt')
}

/** #121: replied_at (SQLite UTC) -> "Antwort erhalten am 06.11.2026", in local time */
export function repliedLabel(repliedAt: string): string {
  const day = localDayOf(repliedAt)
  return day
    ? t('Antwort erhalten am {{germanDate}}', { germanDate: germanDate(day) })
    : t('Antwort erhalten')
}

/**
 * #121: an open follow-up waiting for a reply to a sent mail, due today or earlier, and
 * still no reply - "Keine Antwort" in the list
 */
export const awaitsReply = (
  followUp: { dueDate: string; mail: unknown; repliedAt: string | null },
  today: string = localIsoDate()
): boolean => followUp.mail !== null && followUp.repliedAt === null && followUp.dueDate <= today

/** Open follow-ups due today or earlier (the sidebar badge) */
export const countDue = (followUps: { dueDate: string }[], today: string = localIsoDate()) =>
  followUps.filter((followUp) => followUp.dueDate <= today).length
