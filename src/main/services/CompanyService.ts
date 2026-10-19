import { injectable, inject } from 'tsyringe'
import { removeOwnerFolder } from '../utils/documentStorage'
import { CompanyRepository } from '../repositories/CompanyRepository'
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

  async getCompanyById(id: number) {
    return await this.companyRepository.getById(id)
  }

  async createCompany(data: CreateCompanyInput) {
    return await this.companyRepository.create(data)
  }

  async updateCompany(data: UpdateCompanyInput) {
    return await this.companyRepository.update(data)
  }

  async deleteCompany(id: number) {
    const deleted = await this.companyRepository.delete(id)
    await removeOwnerFolder('company', id).catch((error) => console.error(error))
    return deleted
  }

  async getDefaultForInvoicingCompany() {
    return await this.companyRepository.getDefaultForInvoicing()
  }
}
