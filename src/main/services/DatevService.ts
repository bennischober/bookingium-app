import { inject, injectable } from 'tsyringe'
import { DatevTransferRepository } from '../repositories/DatevTransferRepository'
import { InvoiceSettingsRepository } from '../repositories/InvoiceSettingsRepository'
import type { SetDatevUploadEmailInput } from '../api/schemas/datev.schema'
import type { DatevSendLedger } from '../mail/datevSend'

/**
 * DATEV hand-over (DATEV Upload Mail): the upload address per issuing company, and the
 * documents handed over. Also the pending-send bookkeeping of mail/datevSend.ts.
 */
@injectable()
export class DatevService implements DatevSendLedger {
  constructor(
    @inject(DatevTransferRepository) private datevTransferRepository: DatevTransferRepository,
    @inject(InvoiceSettingsRepository) private invoiceSettingsRepository: InvoiceSettingsRepository
  ) {}

  /** The DATEV upload address of an issuing company, '' for none */
  async uploadEmailOf(companyId: number): Promise<string> {
    const settings = await this.invoiceSettingsRepository.getCompanyInvoiceSettings(companyId)
    return settings?.datev_upload_email ?? ''
  }

  async setUploadEmail(input: SetDatevUploadEmailInput) {
    return await this.invoiceSettingsRepository.setDatevUploadEmail(input)
  }

  listForInvoice(invoiceId: number) {
    return this.datevTransferRepository.listForInvoice(invoiceId)
  }

  addPending(input: Parameters<DatevSendLedger['addPending']>[0]): void {
    this.datevTransferRepository.addPending(input)
  }

  dropPending(sendKey: string): void {
    this.datevTransferRepository.dropPending(sendKey)
  }

  hasPending(mailAccountId: string): boolean {
    return this.datevTransferRepository.hasPending(mailAccountId)
  }

  confirm(sendKey: string, mailAccountId: string, messageId: string): number | null {
    return this.datevTransferRepository.confirm(sendKey, mailAccountId, messageId)
  }
}
