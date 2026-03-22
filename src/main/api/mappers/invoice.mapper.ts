import { invoice, company_invoice_settings, company, deal_memo } from '../../db/schema'
import type {
  InvoiceDto,
  InvoiceListItemDto,
  CompanyInvoiceSettingsDto
} from '../schemas/invoice.schema'

type InvoiceEntity = typeof invoice.$inferSelect
type CompanyInvoiceSettingsEntity = typeof company_invoice_settings.$inferSelect
type CompanyEntity = typeof company.$inferSelect
type DealMemoEntity = typeof deal_memo.$inferSelect

type InvoiceWithRelations = InvoiceEntity & {
  company?: CompanyEntity | null
  dealMemo?: DealMemoEntity | null
}

export class InvoiceMapper {
  static toListItemDto(entity: InvoiceWithRelations): InvoiceListItemDto {
    return {
      id: entity.id,
      invoiceNumber: entity.invoice_number,
      companyId: entity.company_id,
      companyName: entity.company?.name ?? 'Unknown company',
      dealMemoId: entity.deal_memo_id,
      dealMemoName: entity.dealMemo?.name ?? null,
      issueDate: entity.issue_date,
      dueDate: entity.due_date,
      status: entity.status as InvoiceListItemDto['status'],
      currency: entity.currency,
      totalAmount: entity.total_amount
    }
  }

  static toListItemDtoList(entities: InvoiceWithRelations[]): InvoiceListItemDto[] {
    return entities.map((entity) => this.toListItemDto(entity))
  }

  static toDto(entity: InvoiceWithRelations): InvoiceDto {
    return {
      ...this.toListItemDto(entity),
      notes: entity.notes,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at
    }
  }

  static toSettingsDto(entity: CompanyInvoiceSettingsEntity): CompanyInvoiceSettingsDto {
    return {
      id: entity.id,
      companyId: entity.company_id,
      nextInvoiceNumber: entity.next_invoice_number,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at
    }
  }
}
