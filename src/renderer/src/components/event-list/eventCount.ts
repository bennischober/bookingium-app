import { t, uiLocale } from '../../../../main/i18n/translate'
/** "1 Event" / "3 Events" */
export function eventCount(count: number): string {
  return `${count.toLocaleString(uiLocale())} ${count === 1 ? t('Event') : t('Events')}`
}
