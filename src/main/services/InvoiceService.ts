import { inject, injectable } from 'tsyringe'
import { InvoiceRepository } from '../repositories/InvoiceRepository'
import {
  canChangeInvoiceStatus,
  isInvoiceLocked,
  type CreateInvoiceInput,
  type CreateInvoiceForDealMemoInput,
  type InvoiceStatus,
  type UpsertCompanyInvoiceSettingsInput,
  type UpdateInvoiceInput
} from '../api/schemas/invoice.schema'
import type { PaginationInput } from '../api/schemas/base.schema'

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Entwurf',
  issued: 'gestellt',
  paid: 'bezahlt',
  overdue: 'überfällig',
  cancelled: 'storniert'
}

@injectable()
export class InvoiceService {
  constructor(@inject(InvoiceRepository) private invoiceRepository: InvoiceRepository) {}

  async getAllInvoicesPaginated(pagination: PaginationInput) {
    return await this.invoiceRepository.getAllPaginated(pagination)
  }

  async getInvoiceById(id: number) {
    return await this.invoiceRepository.getById(id)
  }

  async getInvoicePrintData(id: number) {
    return await this.invoiceRepository.getByIdWithSnapshots(id)
  }

  async getInvoicesByDealMemoId(dealMemoId: number) {
    return await this.invoiceRepository.getByDealMemoId(dealMemoId)
  }

  async createInvoice(input: CreateInvoiceInput) {
    if (input.status === 'cancelled') {
      throw new Error('Eine neue Rechnung kann nicht direkt storniert angelegt werden')
    }
    return await this.invoiceRepository.create(input)
  }

  async createInvoiceForDealMemo(input: CreateInvoiceForDealMemoInput) {
    return await this.createInvoice(input)
  }

  /** Edits a draft; issuing it via `status` assigns its number */
  async updateInvoice(input: UpdateInvoiceInput) {
    const existing = await this.requireInvoice(input.id)
    if (isInvoiceLocked(existing.status as InvoiceStatus)) {
      throw new Error(
        'Gestellte Rechnungen können nicht mehr bearbeitet werden – nur der Status lässt sich ändern'
      )
    }
    if (input.status) this.assertStatusChange(existing.status as InvoiceStatus, input.status)
    return await this.invoiceRepository.update(input)
  }

  /** Status-only change (issue, mark paid/overdue, Storno) */
  async setInvoiceStatus(id: number, status: InvoiceStatus) {
    const existing = await this.requireInvoice(id)
    this.assertStatusChange(existing.status as InvoiceStatus, status)
    return await this.invoiceRepository.setStatus(id, status)
  }

  /** Only drafts can be deleted; issued invoices are cancelled instead */
  async deleteInvoice(id: number) {
    const existing = await this.requireInvoice(id)
    if (isInvoiceLocked(existing.status as InvoiceStatus)) {
      throw new Error('Nur Entwürfe können gelöscht werden – gestellte Rechnungen bitte stornieren')
    }
    await this.invoiceRepository.delete(id)
  }

  async getCompanyInvoiceSettings(companyId: number) {
    return await this.invoiceRepository.getCompanyInvoiceSettings(companyId)
  }

  async upsertCompanyInvoiceSettings(input: UpsertCompanyInvoiceSettingsInput) {
    return await this.invoiceRepository.upsertCompanyInvoiceSettings(input)
  }

  private async requireInvoice(id: number) {
    const existing = await this.invoiceRepository.getById(id)
    if (!existing) throw new Error('Rechnung nicht gefunden')
    return existing
  }

  private assertStatusChange(from: InvoiceStatus, to: InvoiceStatus) {
    if (!canChangeInvoiceStatus(from, to)) {
      throw new Error(
        `Statuswechsel von „${STATUS_LABELS[from]}“ zu „${STATUS_LABELS[to]}“ ist nicht erlaubt`
      )
    }
  }
}
