import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * For modal sheets and dialogs: a click on a toast (its "Rückgängig", say)
 * is not a click outside, so it doesn't close them
 */
export function keepOpenOnToast(event: {
  detail: { originalEvent: Event }
  preventDefault: () => void
}): void {
  const target = event.detail.originalEvent.target
  if (target instanceof Element && target.closest('[data-sonner-toaster]')) event.preventDefault()
}

/**
 * A date or timestamp as a Date. Database timestamps are UTC "YYYY-MM-DD HH:MM:SS" without a
 * zone (#153), which `new Date` would read as local time
 */
export function parseTimestamp(value: string): Date {
  const utc = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)
  return new Date(utc ? `${value.replace(' ', 'T')}Z` : value)
}

/** ISO date or database timestamp as German short date ("11.06.2026") */
export function formatShortDate(iso: string): string {
  // A date without a time is a calendar day, not UTC midnight
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (day) return `${day[3]}.${day[2]}.${day[1]}`
  return parseTimestamp(iso).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

/** A free-text date field (a band's founding): an ISO date in German, anything else (a year) as typed */
export function formatLooseDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatShortDate(value) : value
}
