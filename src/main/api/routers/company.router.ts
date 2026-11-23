import { z } from 'zod'
import { initTRPC } from '@trpc/server'
import { container } from 'tsyringe'
import { CompanyService } from '../../services/CompanyService'
import { CompanyMapper } from '../mappers/company.mapper'
import { CreateCompanyInput, UpdateCompanyInput } from '../schemas/company.schema'
import { PaginationInput } from '../schemas/base.schema'
import { InvoiceService } from '../../services/InvoiceService'
import { adminOnly, requireAdmin } from '../access'

const t = initTRPC.create()
const companyService = container.resolve(CompanyService)
const invoiceService = container.resolve(InvoiceService)
// #262: choosing the own company is closed in staff access
const adminProcedure = t.procedure.use(t.middleware(adminOnly))

/**
 * #262: an own company (the default for invoicing, or one with invoice settings) carries the
 * bank account and tax data of the invoices; in staff access it can be read, not changed.
 */
async function requireAdminForOwnCompany(id: number): Promise<void> {
  const company = await companyService.getCompanyById(id)
  if (company?.is_default_for_invoicing) return requireAdmin()
  if (await invoiceService.getCompanyInvoiceSettings(id)) requireAdmin()
}

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

  /** Companies naming a person as invoice contact (person page) */
  listByInvoiceContact: t.procedure.input(z.number()).query(async ({ input }) => {
    return CompanyMapper.toDtoList(await companyService.listCompaniesByInvoiceContact(input))
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
  setDefaultForInvoicing: adminProcedure
    .input(z.number().nullable())
    .mutation(async ({ input }) => {
      await companyService.setDefaultForInvoicing(input)
    }),

  create: t.procedure.input(CreateCompanyInput).mutation(async ({ input }) => {
    const company = await companyService.createCompany(input)
    return CompanyMapper.toDto(company)
  }),

  update: t.procedure.input(UpdateCompanyInput).mutation(async ({ input }) => {
    await requireAdminForOwnCompany(input.id)
    const company = await companyService.updateCompany(input)
    return CompanyMapper.toDto(company)
  }),

  delete: t.procedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await requireAdminForOwnCompany(input.id)
    await companyService.deleteCompany(input.id)
  })
})
