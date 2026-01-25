import { injectable, inject } from 'tsyringe'
import { CompanyRepository } from '../repositories/CompanyRepository'
import { CreateCompanyInput, UpdateCompanyInput } from '../api/schemas/company.schema'

@injectable()
export class CompanyService {
  constructor(
    @inject(CompanyRepository)
    private companyRepository: CompanyRepository
  ) {}

  async getAllCompanies() {
    return await this.companyRepository.getAll()
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
    return await this.companyRepository.delete(id)
  }
}
