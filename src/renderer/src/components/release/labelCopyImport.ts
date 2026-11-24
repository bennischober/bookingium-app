import type {
  ApplyLabelCopyResult,
  ImportStatus
} from '../../../../main/api/schemas/release_import.schema'
import { t } from '../../../../main/i18n/translate'

// Texts of the label copy import (#289). Pure, so vitest covers it.

/** The target picker's value for "a new release" (release ids are positive) */
export const NEW_RELEASE = -1

export function statusLabel(status: ImportStatus): string {
  switch (status) {
    case 'new':
      return t('neu')
    case 'fill':
      return t('ergänzt')
    case 'conflict':
      return t('weicht ab')
    case 'same':
      return t('unverändert')
  }
}

/** "2 Tracks neu, 1 ergänzt · 3 Produkte neu · 1 Maßnahme · Datei abgelegt" */
export function importSummary(result: ApplyLabelCopyResult): string {
  const parts: string[] = []
  const pair = (added: number, updated: number, one: string, many: string) => {
    if (added + updated === 0) return
    const noun = added + updated === 1 ? one : many
    const bits = [
      added > 0 && t('{{count}} neu', { count: added }),
      updated > 0 && t('{{count}} ergänzt', { count: updated })
    ].filter(Boolean)
    parts.push(`${noun}: ${bits.join(', ')}`)
  }
  pair(result.tracksAdded, result.tracksUpdated, t('Track'), t('Tracks'))
  pair(result.productsAdded, result.productsUpdated, t('Produkt'), t('Produkte'))
  if (result.measuresAdded > 0)
    parts.push(
      result.measuresAdded === 1
        ? t('1 Maßnahme')
        : t('{{count}} Maßnahmen', { count: result.measuresAdded })
    )
  if (result.documentStored) parts.push(t('Datei abgelegt'))
  return parts.length > 0 ? parts.join(' · ') : t('Es gab nichts zu ändern.')
}
