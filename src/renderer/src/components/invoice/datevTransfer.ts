import { formatShortDate } from '@/lib/utils'
import type { DatevTransferDto } from '../../../../main/api/schemas/datev.schema'

/** "An DATEV übergeben am 12.11.2026", or that it is still being confirmed */
export function datevTransferLabel(transfer: DatevTransferDto): string {
  return transfer.sentAt
    ? `An DATEV übergeben am ${formatShortDate(transfer.sentAt)}`
    : 'Übergabe an DATEV wird bestätigt'
}
