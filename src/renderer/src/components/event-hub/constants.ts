import { t, uiLocale } from '../../../../main/i18n/translate'
export const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-800 border-green-200',
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200'
}

export const STATUS_LABELS: Record<string, string> = {
  confirmed: t('Bestätigt'),
  pending: t('Ausstehend'),
  cancelled: t('Storniert')
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(uiLocale(), {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  })
}

// Event hub tabs; the active one is kept in the URL (?tab=...)
export const EVENT_TABS = [
  'overview',
  'itinerary',
  'financials',
  'advancing',
  'tickets',
  'settlement',
  'documents',
  'mails'
] as const
export type EventTab = (typeof EVENT_TABS)[number]

export function isEventTab(value: unknown): value is EventTab {
  return typeof value === 'string' && (EVENT_TABS as readonly string[]).includes(value)
}

/**
 * Former tabs, now sections: Advancing in Ablauf (`itinerary`), Tickets and Abrechnung in Geld
 * (`financials`); E-Mails are part of Dokumente
 */
export const EVENT_TAB_ALIASES: Partial<Record<string, EventTab>> = {
  advancing: 'itinerary',
  tickets: 'financials',
  settlement: 'financials',
  mails: 'documents'
}
