import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import { container } from 'tsyringe'
import { CompanyService } from '../../services/CompanyService'
import { CompanyMapper } from '../mappers/company.mapper'
import { CreateCompanyInput, UpdateCompanyInput } from '../schemas/company.schema'
import { PaginationInput } from '../schemas/base.schema'

const t = initTRPC.create()
const companyService = container.resolve(CompanyService)

export const companyRouter = t.router({
  getAll: t.procedure.query(async () => {
    const companies = await companyService.getAllCompanies()
    return CompanyMapper.toDtoList(companies)
  }),

  // Lightweight endpoint for dropdowns
  getListItems: t.procedure.query(async () => {
    const companies = await companyService.getAllCompanies()
    return CompanyMapper.toListItemList(companies)
  }),

  getAllPaginated: t.procedure.input(PaginationInput).query(async ({ input }) => {
    const result = await companyService.getAllCompaniesPaginated(input)

    return {
      ...result,
      items: CompanyMapper.toDtoList(result.items)
    }
  }),

  getById: t.procedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const company = await companyService.getCompanyById(input.id)
    return company ? CompanyMapper.toDto(company) : null
  }),

  getDefaultForInvoicing: t.procedure.query(async () => {
    const company = await companyService.getDefaultForInvoicingCompany()
    return company ? CompanyMapper.toDto(company) : null
  }),

  /** Default own company for invoices and contracts (null = none) */
  setDefaultForInvoicing: t.procedure.input(z.number().nullable()).mutation(async ({ input }) => {
    await companyService.setDefaultForInvoicing(input)
  }),

  create: t.procedure.input(CreateCompanyInput).mutation(async ({ input }) => {
    const company = await companyService.createCompany(input)
    return CompanyMapper.toDto(company)
  }),

  update: t.procedure.input(UpdateCompanyInput).mutation(async ({ input }) => {
    const company = await companyService.updateCompany(input)
    return CompanyMapper.toDto(company)
  }),

  delete: t.procedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await companyService.deleteCompany(input.id)
  })
})
