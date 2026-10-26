import { inject, injectable } from 'tsyringe'
import { InvoiceRepository } from '../repositories/InvoiceRepository'
import {
  canChangeInvoiceStatus,
  canRemind,
  isInvoiceLocked,
  type CreateInvoiceInput,
  type CreateInvoiceForDealMemoInput,
  type InvoiceEmailKind,
  type InvoiceKind,
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

  async listInvoicesByCompany(companyId: number) {
    return await this.invoiceRepository.listByCompany(companyId)
  }

  async listInvoicesByRecipientPerson(personId: number) {
    return await this.invoiceRepository.listByRecipientPerson(personId)
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
    if (input.status) {
      this.assertStatusChange(existing.status as InvoiceStatus, input.status, 'invoice')
    }
    return await this.invoiceRepository.update(input)
  }

  /**
   * Status-only change (issue, mark paid/overdue, Storno). Cancelling an
   * issued invoice also creates its Stornorechnung.
   */
  async setInvoiceStatus(id: number, status: InvoiceStatus) {
    const existing = await this.requireInvoice(id)
    this.assertStatusChange(existing.status as InvoiceStatus, status, existing.kind as InvoiceKind)
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

  /** Overdue invoices with their payment reminders (`today`: local calendar day) */
  async listOverdueInvoices(today: string) {
    return await this.invoiceRepository.listOverdue(today)
  }

  /** Before a payment reminder is created: only for open invoices */
  assertRemindable(invoice: { kind: InvoiceKind; status: InvoiceStatus }) {
    if (!canRemind(invoice)) {
      throw new Error('Zahlungserinnerungen und Mahnungen gibt es nur für offene Rechnungen')
    }
  }

  /** Remembers that "Per E-Mail senden" created the invoice's email or a reminder */
  markInvoiceEmailed(
    id: number,
    to: string,
    kind: InvoiceEmailKind = 'invoice',
    /** C1: set only when bookingum sent the mail itself */
    sent?: { messageId?: string; mailAccountId?: string }
  ) {
    this.invoiceRepository.markEmailed(id, to, kind, sent)
  }

  /**
   * I7: bookingum is about to send an invoice mail under this send key. It counts as
   * emailed only once confirmInvoiceEmail finds the send - right away or after a restart.
   */
  queueInvoiceEmail(input: {
    invoiceId: number
    kind: InvoiceEmailKind
    to: string
    mailAccountId: string
    sendKey: string
  }) {
    this.invoiceRepository.addPendingEmail(input)
  }

  /** I7: the send was refused before the server took it */
  dropQueuedInvoiceEmail(sendKey: string) {
    this.invoiceRepository.dropPendingEmail(sendKey)
  }

  hasQueuedInvoiceEmails(mailAccountId: string): boolean {
    return this.invoiceRepository.hasPendingEmails(mailAccountId)
  }

  /** I7: the mail with this send key is out; marks its invoice once. The invoice id, or null */
  confirmInvoiceEmail(sendKey: string, mailAccountId: string, messageId: string): number | null {
    return this.invoiceRepository.confirmPendingEmail(sendKey, mailAccountId, messageId)
  }

  private async requireInvoice(id: number) {
    const existing = await this.invoiceRepository.getById(id)
    if (!existing) throw new Error('Rechnung nicht gefunden')
    return existing
  }

  private assertStatusChange(from: InvoiceStatus, to: InvoiceStatus, kind: InvoiceKind) {
    if (kind === 'cancellation' && from !== to) {
      throw new Error(
        'Eine Stornorechnung bleibt, wie sie ist – ihr Status lässt sich nicht ändern'
      )
    }
    if (!canChangeInvoiceStatus(from, to, kind)) {
      throw new Error(
        `Statuswechsel von „${STATUS_LABELS[from]}“ zu „${STATUS_LABELS[to]}“ ist nicht erlaubt`
      )
    }
  }
}
