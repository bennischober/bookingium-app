import { formatShortDate } from '@/lib/utils'
import {
  DATEV_CATEGORY_LABELS,
  type DatevTransferDto
} from '../../../../main/api/schemas/datev.schema'

/** "An DATEV übergeben am 12.11.2026 (Rechnungsausgang)", or that it is still being confirmed */
export function datevTransferLabel(transfer: DatevTransferDto): string {
  const category = DATEV_CATEGORY_LABELS[transfer.category]
  return transfer.sentAt
    ? `An DATEV übergeben am ${formatShortDate(transfer.sentAt)} (${category})`
    : `Übergabe an DATEV wird bestätigt (${category})`
}
