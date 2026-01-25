import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { CompanyService } from '../../services/CompanyService'
import { CompanyMapper } from '../mappers/company.mapper'
import { CreateCompanyInput, UpdateCompanyInput } from '../schemas/company.schema'
import z from 'zod'

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

  getById: t.procedure.input(z.number()).query(async ({ input }) => {
    const company = await companyService.getCompanyById(input)
    if (!company) throw new TRPCError({ code: 'NOT_FOUND' })
    return CompanyMapper.toDto(company)
  }),

  create: t.procedure.input(CreateCompanyInput).mutation(async ({ input }) => {
    const company = await companyService.createCompany(input)
    return CompanyMapper.toDto(company)
  }),

  update: t.procedure.input(UpdateCompanyInput).mutation(async ({ input }) => {
    const company = await companyService.updateCompany(input)
    return CompanyMapper.toDto(company)
  }),

  delete: t.procedure.input(z.number()).mutation(async ({ input }) => {
    const company = await companyService.deleteCompany(input)
    if (!company) throw new TRPCError({ code: 'NOT_FOUND' })
    return CompanyMapper.toDto(company)
  })
})
