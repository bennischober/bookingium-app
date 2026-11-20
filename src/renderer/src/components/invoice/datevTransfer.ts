import { formatShortDate } from '@/lib/utils'
import {
  DATEV_CATEGORY_LABELS,
  type DatevTransferDto
} from '../../../../main/api/schemas/datev.schema'
import { t } from '../../../../main/i18n/translate'

/** "An DATEV übergeben am 12.11.2026 (Rechnungsausgang)", or that it is still being confirmed */
export function datevTransferLabel(transfer: DatevTransferDto): string {
  const category = DATEV_CATEGORY_LABELS[transfer.category]
  return transfer.sentAt
    ? t('An DATEV übergeben am {{formatShortDate}} ({{category}})', {
        formatShortDate: formatShortDate(transfer.sentAt),
        category
      })
    : t('Übergabe an DATEV wird bestätigt ({{category}})', { category })
}
