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

/** ISO date as German short date ("11.06.2026") */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}
