import type { datev_transfer } from '../../db/schema'
import type { DatevTransferDto, DatevTransferStatus } from '../schemas/datev.schema'

type DatevTransferEntity = typeof datev_transfer.$inferSelect

export class DatevMapper {
  static toTransferDto(entity: DatevTransferEntity): DatevTransferDto {
    return {
      id: entity.id,
      invoiceId: entity.invoice_id,
      status: entity.status as DatevTransferStatus,
      to: entity.to,
      fileName: entity.file_name,
      createdAt: entity.created_at,
      sentAt: entity.sent_at
    }
  }
}
