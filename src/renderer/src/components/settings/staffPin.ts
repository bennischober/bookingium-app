import { t } from '../../../../main/i18n/translate'

/** #262: what is wrong with a new staff access PIN, or null; `optional` allows none at all */
export function staffPinProblem({
  pin,
  repeat,
  optional
}: {
  pin: string
  repeat: string
  optional: boolean
}): string | null {
  if (pin === '' && repeat === '') return optional ? null : t('Bitte eine PIN eingeben.')
  if (!/^\d{4,12}$/.test(pin)) return t('Die PIN besteht aus 4 bis 12 Ziffern.')
  if (pin !== repeat) return t('Die beiden PINs stimmen nicht überein.')
  return null
}
