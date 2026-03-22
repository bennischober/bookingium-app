import { inject, injectable } from 'tsyringe'
import { InvoiceRepository } from '../repositories/InvoiceRepository'
import type {
  CreateInvoiceForDealMemoInput,
  UpsertCompanyInvoiceSettingsInput,
  UpdateInvoiceInput
} from '../api/schemas/invoice.schema'
import type { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class InvoiceService {
  constructor(@inject(InvoiceRepository) private invoiceRepository: InvoiceRepository) {}

  async getAllInvoicesPaginated(pagination: PaginationInput) {
    return await this.invoiceRepository.getAllPaginated(pagination)
  }

  async getInvoiceById(id: number) {
    return await this.invoiceRepository.getById(id)
  }

  async getInvoicesByDealMemoId(dealMemoId: number) {
    return await this.invoiceRepository.getByDealMemoId(dealMemoId)
  }

  async createInvoiceForDealMemo(input: CreateInvoiceForDealMemoInput) {
    return await this.invoiceRepository.createForDealMemo(input)
  }

  async updateInvoice(input: UpdateInvoiceInput) {
    return await this.invoiceRepository.update(input)
  }

  async deleteInvoice(id: number) {
    await this.invoiceRepository.delete(id)
  }

  async getCompanyInvoiceSettings(companyId: number) {
    return await this.invoiceRepository.getCompanyInvoiceSettings(companyId)
  }

  async upsertCompanyInvoiceSettings(input: UpsertCompanyInvoiceSettingsInput) {
    return await this.invoiceRepository.upsertCompanyInvoiceSettings(input)
  }
}
