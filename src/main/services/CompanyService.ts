import { injectable, inject } from 'tsyringe'
import { removeOwnerFolder } from '../utils/documentStorage'
import { CompanyRepository } from '../repositories/CompanyRepository'
import { scheduleFollowUpCalendarUpdate } from './CalendarFeedService'
import { CreateCompanyInput, UpdateCompanyInput } from '../api/schemas/company.schema'
import { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class CompanyService {
  constructor(
    @inject(CompanyRepository)
    private companyRepository: CompanyRepository
  ) {}

  async getAllCompanies() {
    return await this.companyRepository.getAll()
  }

  async getAllCompaniesPaginated(pagination: PaginationInput) {
    return await this.companyRepository.getAllPaginated(pagination)
  }

  async listCompaniesByInvoiceContact(personId: number) {
    return await this.companyRepository.listByInvoiceContact(personId)
  }

  async getCompanyById(id: number) {
    return await this.companyRepository.getById(id)
  }

  async createCompany(data: CreateCompanyInput) {
    return await this.companyRepository.create(data)
  }

  async updateCompany(data: UpdateCompanyInput) {
    const updated = await this.companyRepository.update(data)
    scheduleFollowUpCalendarUpdate()
    return updated
  }

  async deleteCompany(id: number) {
    const { bands, invoices } = this.companyRepository.deleteBlockers(id)
    if (bands > 0 || invoices > 0) {
      const links = [
        bands > 0 && (bands === 1 ? '1 Band' : `${bands} Bands`),
        invoices > 0 && (invoices === 1 ? '1 Rechnung' : `${invoices} Rechnungen`)
      ].filter(Boolean)
      throw new Error(
        `Die Firma ist noch mit ${links.join(' und ')} verknüpft und kann nicht gelöscht werden.`
      )
    }
    const deleted = await this.companyRepository.delete(id)
    scheduleFollowUpCalendarUpdate()
    await removeOwnerFolder('company', id).catch((error) => console.error(error))
    return deleted
  }

  async getDefaultForInvoicingCompany() {
    return await this.companyRepository.getDefaultForInvoicing()
  }

  async setDefaultForInvoicing(companyId: number | null) {
    await this.companyRepository.setDefaultForInvoicing(companyId)
  }
}
