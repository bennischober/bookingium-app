import { t } from '../../../../main/i18n/translate'
// Settings page tabs; the active one is kept in the URL (?tab=...) so other
// places (e.g. the search palette) can link straight to it
export const SETTINGS_TABS = ['general', 'invoices', 'email', 'calendar', 'data'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]
export function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === 'string' && (SETTINGS_TABS as readonly string[]).includes(value)
}

/** #262: tabs left out while this computer is in staff access and locked */
export const STAFF_LOCKED_TABS: readonly SettingsTab[] = ['invoices']

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  general: t('Allgemein'),
  invoices: t('Rechnungen'),
  email: 'E-Mail',
  calendar: t('Kalender'),
  data: t('Daten')
}
