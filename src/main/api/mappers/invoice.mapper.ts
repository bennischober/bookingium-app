import {
  invoice,
  company_invoice_settings,
  company,
  deal_memo,
  invoice_line_item,
  invoice_email,
  invoice_status_change,
  invoice_party_snapshot
} from '../../db/schema'
import type {
  InvoiceDto,
  InvoiceEmailDto,
  InvoiceListItemDto,
  OverdueInvoiceDto,
  CompanyInvoiceSettingsDto,
  InvoiceLineItemDto,
  InvoicePartySnapshotDto,
  InvoicePrintDto,
  InvoiceStatus
} from '../schemas/invoice.schema'

type InvoiceEntity = typeof invoice.$inferSelect
type CompanyInvoiceSettingsEntity = typeof company_invoice_settings.$inferSelect
type CompanyEntity = typeof company.$inferSelect
type DealMemoEntity = typeof deal_memo.$inferSelect
type InvoiceLineItemEntity = typeof invoice_line_item.$inferSelect
type InvoiceEmailEntity = typeof invoice_email.$inferSelect
type InvoiceStatusChangeEntity = typeof invoice_status_change.$inferSelect
type InvoicePartySnapshotEntity = typeof invoice_party_snapshot.$inferSelect
type InvoicePartySnapshotValues = typeof invoice_party_snapshot.$inferInsert

const EMPTY_SNAPSHOT: InvoicePartySnapshotEntity = {
  id: 0,
  kind: 'other',
  source_company_id: null,
  source_band_id: null,
  source_person_id: null,
  legal_name: '',
  street: '',
  street_number: '',
  zip_code: '',
  city: '',
  country: '',
  country_code: '',
  vat_number: '',
  ust_number: '',
  tax_number: '',
  commercial_register_no: '',
  register_court: '',
  website: '',
  account_holder: '',
  bank_name: '',
  logo_path: '',
  email: '',
  phone: '',
  iban: '',
  bic: '',
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  created_at: ''
}

type InvoiceWithRelations = InvoiceEntity & {
  cancelsInvoice?: { id: number; invoice_number: number | null; issue_date: string } | null
  cancelledBy?: { id: number; invoice_number: number | null } | null
  company?: CompanyEntity | null
  dealMemo?: DealMemoEntity | null
  issuerSnapshot?: InvoicePartySnapshotEntity | null
  recipientSnapshot?: InvoicePartySnapshotEntity | null
  lineItems?: InvoiceLineItemEntity[]
  emails?: InvoiceEmailEntity[]
  statusChanges?: InvoiceStatusChangeEntity[]
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
      kind: entity.kind as InvoiceListItemDto['kind'],
      cancelsInvoiceNumber: entity.cancelsInvoice?.invoice_number ?? null,
      companyId: entity.company_id,
      companyName: entity.company?.name ?? 'Unknown company',
      recipientKind:
        (entity.recipientSnapshot?.kind as InvoiceListItemDto['recipientKind']) ?? 'other',
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
      totalAmount: entity.total_amount,
      emailedAt: entity.emailed_at,
      emailedTo: entity.emailed_to
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
      buyerReference: entity.buyer_reference,
      xrechnung: entity.xrechnung,
      cancelsInvoiceId: entity.cancelsInvoice?.id ?? null,
      cancelsInvoiceIssueDate: entity.cancelsInvoice?.issue_date ?? null,
      cancelledByInvoiceId: entity.cancelledBy?.id ?? null,
      cancelledByInvoiceNumber: entity.cancelledBy?.invoice_number ?? null,
      lineItems: (entity.lineItems ?? []).map((item) => this.toLineItemDto(item)),
      emails: (entity.emails ?? []).map((email) => this.toEmailDto(email)),
      statusChanges: (entity.statusChanges ?? []).map((change) => ({
        status: change.status as InvoiceStatus,
        createdAt: change.created_at
      })),
      createdAt: entity.created_at,
      updatedAt: entity.updated_at
    }
  }

  static toEmailDto(entity: InvoiceEmailEntity): InvoiceEmailDto {
    return {
      kind: entity.kind as InvoiceEmailDto['kind'],
      createdAt: entity.created_at,
      to: entity.to
    }
  }

  static toOverdueDto(entity: InvoiceWithRelations): OverdueInvoiceDto {
    return {
      ...this.toListItemDto(entity),
      emails: (entity.emails ?? []).map((email) => this.toEmailDto(email))
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
      countryCode: entity.country_code,
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
      bic: entity.bic,
      contactName: entity.contact_name,
      contactPhone: entity.contact_phone,
      contactEmail: entity.contact_email
    }
  }

  /** Party values that are not stored yet (draft check, form preview) */
  static toPartyPreviewDto(values: InvoicePartySnapshotValues): InvoicePartySnapshotDto {
    return this.toPartySnapshotDto({ ...EMPTY_SNAPSHOT, ...values })
  }

  static toPrintDto(
    entity: InvoiceWithRelations & {
      venueName?: string | null
      managementShareBandName?: string | null
      eventBandName?: string | null
    },
    issuerSnapshot: InvoicePartySnapshotEntity | null,
    recipientSnapshot: InvoicePartySnapshotEntity | null
  ): InvoicePrintDto {
    return {
      invoice: this.toDto({ ...entity, issuerSnapshot, recipientSnapshot }),
      issuer: issuerSnapshot ? this.toPartySnapshotDto(issuerSnapshot) : null,
      recipient: recipientSnapshot ? this.toPartySnapshotDto(recipientSnapshot) : null,
      venueName: entity.venueName ?? null,
      eventDate: entity.dealMemo?.date ?? null,
      managementShare: entity.managementShareBandName
        ? { bandName: entity.managementShareBandName }
        : null,
      bandName: entity.managementShareBandName ?? entity.eventBandName ?? null
    }
  }
}
