import type { datev_transfer } from '../../db/schema'
import { fromCents } from '../../einvoice/amounts'
import type {
  DatevCategory,
  DatevPendingInvoiceDto,
  DatevTransferDto,
  DatevTransferStatus
} from '../schemas/datev.schema'

type DatevTransferEntity = typeof datev_transfer.$inferSelect

export class DatevMapper {
  static toPendingInvoiceDto(row: {
    id: number
    invoiceNumber: number | null
    kind: string
    issueDate: string
    totalGrossCents: number
    currency: string
    recipientName: string | null
  }): DatevPendingInvoiceDto {
    return {
      id: row.id,
      invoiceNumber: row.invoiceNumber ?? 0,
      kind: row.kind === 'cancellation' ? 'cancellation' : 'invoice',
      issueDate: row.issueDate,
      totalAmount: fromCents(row.totalGrossCents),
      currency: row.currency,
      recipientName: row.recipientName ?? ''
    }
  }

  static toTransferDto(entity: DatevTransferEntity): DatevTransferDto {
    return {
      id: entity.id,
      invoiceId: entity.invoice_id,
      status: entity.status as DatevTransferStatus,
      category: entity.category as DatevCategory,
      to: entity.to,
      fileName: entity.file_name,
      createdAt: entity.created_at,
      sentAt: entity.sent_at
    }
  }
}
