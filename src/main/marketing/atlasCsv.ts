// The band's atlas working list as a CSV file (a mail merge, a call list). Pure, unit tested.
import { CSV_BOM, csvSeparator, toCsv } from '../csv/csv'
import {
  MARKETING_CATEGORY_LABELS,
  MARKETING_QUALITY_LABELS,
  MARKETING_STATUS_LABELS,
  type MarketingItemDto
} from '../api/schemas/marketing.schema'
import { t } from '../i18n/translate'

const HEADERS = (): string[] => [
  t('Name'),
  t('Reiter'),
  t('Gruppe'),
  t('Land'),
  t('Art'),
  t('Priorität'),
  t('Qualität'),
  t('Status'),
  t('Status seit'),
  t('Notiz'),
  t('E-Mail'),
  t('Kontakt-Link'),
  t('Kontakt-Hinweis'),
  t('Adressbuch'),
  t('Warum'),
  t('Weg'),
  t('Timing'),
  t('Quelle')
]

/** dd.mm.yyyy from an ISO date; '' without one */
const day = (date: string | null): string =>
  date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split('-').reverse().join('.') : ''

export function atlasCsv(items: MarketingItemDto[], locale: string): string {
  const rows = [
    HEADERS(),
    ...items.map((item) => [
      item.name,
      MARKETING_CATEGORY_LABELS[item.category],
      item.group,
      item.country,
      item.type,
      item.priority,
      MARKETING_QUALITY_LABELS[item.quality],
      MARKETING_STATUS_LABELS[item.status],
      day(item.statusDate),
      item.statusNote,
      item.contactEmail,
      item.contactUrl,
      item.contactNote,
      item.companyName ?? item.venueName ?? '',
      item.reason,
      item.approach,
      item.timing,
      item.sourceUrl
    ])
  ]
  return CSV_BOM + toCsv(rows, csvSeparator(locale))
}
