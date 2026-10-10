import {
  invoice,
  company_invoice_settings,
  company,
  deal_memo,
  invoice_line_item,
  invoice_party_snapshot
} from '../../db/schema'
import type {
  InvoiceDto,
  InvoiceListItemDto,
  CompanyInvoiceSettingsDto,
  InvoiceLineItemDto,
  InvoicePartySnapshotDto,
  InvoicePrintDto
} from '../schemas/invoice.schema'

type InvoiceEntity = typeof invoice.$inferSelect
type CompanyInvoiceSettingsEntity = typeof company_invoice_settings.$inferSelect
type CompanyEntity = typeof company.$inferSelect
type DealMemoEntity = typeof deal_memo.$inferSelect
type InvoiceLineItemEntity = typeof invoice_line_item.$inferSelect
type InvoicePartySnapshotEntity = typeof invoice_party_snapshot.$inferSelect

type InvoiceWithRelations = InvoiceEntity & {
  company?: CompanyEntity | null
  dealMemo?: DealMemoEntity | null
  issuerSnapshot?: InvoicePartySnapshotEntity | null
  recipientSnapshot?: InvoicePartySnapshotEntity | null
  lineItems?: InvoiceLineItemEntity[]
}

export class InvoiceMapper {
  static toLineItemDto(entity: InvoiceLineItemEntity): InvoiceLineItemDto {
    return {
      id: entity.id,
      position: entity.position,
      description: entity.description,
      quantity: entity.quantity,
      unit: entity.unit,
      unitPriceNet: entity.unit_price_net,
      lineNetAmount: entity.line_net_amount,
      taxRate: entity.tax_rate,
      taxCode: entity.tax_code as InvoiceLineItemDto['taxCode'],
      lineTaxAmount: entity.line_tax_amount,
      lineGrossAmount: entity.line_gross_amount
    }
  }

  static toListItemDto(entity: InvoiceWithRelations): InvoiceListItemDto {
    return {
      id: entity.id,
      invoiceNumber: entity.invoice_number,
      companyId: entity.company_id,
      companyName: entity.company?.name ?? 'Unknown company',
      recipientKind: (entity.recipientSnapshot?.kind as InvoiceListItemDto['recipientKind']) ?? 'other',
      recipientName: entity.recipientSnapshot?.legal_name ?? 'Unknown recipient',
      recipientCompanyId: entity.recipientSnapshot?.source_company_id ?? null,
      recipientBandId: entity.recipientSnapshot?.source_band_id ?? null,
      recipientPersonId: entity.recipientSnapshot?.source_person_id ?? null,
      dealMemoId: entity.deal_memo_id,
      dealMemoName: entity.dealMemo?.name ?? null,
      periodStartDate: entity.period_start_date,
      periodEndDate: entity.period_end_date,
      periodLabel: entity.period_label,
      issueDate: entity.issue_date,
      dueDate: entity.due_date,
      status: entity.status as InvoiceListItemDto['status'],
      currency: entity.currency,
      subtotalNetAmount: entity.subtotal_net_amount,
      subtotalTaxAmount: entity.subtotal_tax_amount,
      totalGrossAmount: entity.total_gross_amount,
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
      paymentTerms: entity.payment_terms,
      reverseChargeNote: entity.reverse_charge_note,
      lineItems: (entity.lineItems ?? []).map((item) => this.toLineItemDto(item)),
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

  static toPartySnapshotDto(entity: InvoicePartySnapshotEntity): InvoicePartySnapshotDto {
    return {
      id: entity.id,
      kind: entity.kind,
      legalName: entity.legal_name,
      street: entity.street,
      streetNumber: entity.street_number,
      zipCode: entity.zip_code,
      city: entity.city,
      country: entity.country,
      vatNumber: entity.vat_number,
      ustNumber: entity.ust_number,
      taxNumber: entity.tax_number,
      commercialRegisterNo: entity.commercial_register_no,
      registerCourt: entity.register_court,
      website: entity.website,
      accountHolder: entity.account_holder,
      bankName: entity.bank_name,
      logoPath: entity.logo_path,
      email: entity.email,
      phone: entity.phone,
      iban: entity.iban,
      bic: entity.bic
    }
  }

  static toPrintDto(
    entity: InvoiceWithRelations & { venueName?: string | null },
    issuerSnapshot: InvoicePartySnapshotEntity | null,
    recipientSnapshot: InvoicePartySnapshotEntity | null
  ): InvoicePrintDto {
    return {
      invoice: this.toDto({ ...entity, issuerSnapshot, recipientSnapshot }),
      issuer: issuerSnapshot ? this.toPartySnapshotDto(issuerSnapshot) : null,
      recipient: recipientSnapshot ? this.toPartySnapshotDto(recipientSnapshot) : null,
      venueName: entity.venueName ?? null
    }
  }
}
