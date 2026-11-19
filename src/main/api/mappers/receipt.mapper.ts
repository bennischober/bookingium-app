import type { ReceiptRow } from '../../repositories/ReceiptRepository'
import type { ReceiptCategory, ReceiptDto, ReceiptPendingDto } from '../schemas/receipt.schema'

export class ReceiptMapper {
  static toDto(row: ReceiptRow): ReceiptDto {
    const r = row.receipt
    return {
      id: r.id,
      companyId: r.company_id,
      companyName: row.companyName ?? '',
      category: r.category as ReceiptCategory,
      receiptDate: r.receipt_date,
      amountCents: r.amount_cents,
      currency: r.currency,
      supplierCompanyId: r.supplier_company_id,
      supplierName: row.supplierCompanyName ?? r.supplier_name,
      reference: r.reference,
      notes: r.notes,
      fileName: r.file_name,
      fileSize: r.file_size,
      fromMail: r.source_mail_account_id !== null,
      tripId: r.trip_id,
      tripReport: r.trip_report,
      datev: row.datevSentAt
        ? 'sent'
        : row.datevAny
          ? 'pending'
          : r.in_datev
            ? 'external'
            : 'none',
      datevSentAt: row.datevSentAt,
      createdAt: r.created_at
    }
  }

  static toPendingDto(row: ReceiptRow): ReceiptPendingDto {
    const r = row.receipt
    return {
      id: r.id,
      category: r.category as ReceiptCategory,
      receiptDate: r.receipt_date,
      amountCents: r.amount_cents,
      currency: r.currency,
      supplierName: row.supplierCompanyName ?? r.supplier_name,
      fileName: r.file_name
    }
  }
}
