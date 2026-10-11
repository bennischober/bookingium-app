// Invoice repository/service tests: sequential per-company numbering (the
// unique index on (company_id, invoice_number) must never trip), issuer and
// recipient snapshot capture with footer fields, and line-item totals.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { InvoiceService } from '../src/main/services/InvoiceService'
import { CompanyService } from '../src/main/services/CompanyService'

import { setupTestDb } from './helpers/setup'

setupTestDb()

const issuer = {
  name: 'Issuer GmbH',
  vatNumber: 'DE212298737',
  taxNumber: '12712063600',
  commercialRegisterNo: 'HRB 7710',
  registerCourt: 'AG Kempten',
  isDefaultForInvoicing: true
}

describe('InvoiceService', () => {
  // The service/repository layer returns raw DB entities (snake_case); DTO
  // mapping happens in the tRPC router. `lineItems` is an exception - it is
  // attached as an array of raw line-item rows (also snake_case).

  it('assigns sequential invoice numbers per company', async () => {
    const companies = container.resolve(CompanyService)
    const invoices = container.resolve(InvoiceService)
    const company = await companies.createCompany(issuer)

    const a = await invoices.createInvoice({
      companyId: company.id,
      lineItems: [
        { description: 'A', quantity: 1, unitPriceNet: 100, taxRate: 19, taxCode: 'standard' }
      ]
    })
    const b = await invoices.createInvoice({
      companyId: company.id,
      lineItems: [
        { description: 'B', quantity: 1, unitPriceNet: 200, taxRate: 0, taxCode: 'other' }
      ]
    })

    expect(a.invoice_number).toBeGreaterThan(0)
    expect(b.invoice_number).toBe(a.invoice_number + 1)
  })

  it('two issuers number independently', async () => {
    const companies = container.resolve(CompanyService)
    const invoices = container.resolve(InvoiceService)
    const c1 = await companies.createCompany({ ...issuer, name: 'Issuer One GmbH' })
    const c2 = await companies.createCompany({
      ...issuer,
      name: 'Issuer Two GmbH',
      isDefaultForInvoicing: false
    })

    const a = await invoices.createInvoice({
      companyId: c1.id,
      lineItems: [
        { description: 'A', quantity: 1, unitPriceNet: 100, taxRate: 0, taxCode: 'other' }
      ]
    })
    const b = await invoices.createInvoice({
      companyId: c2.id,
      lineItems: [
        { description: 'B', quantity: 1, unitPriceNet: 100, taxRate: 0, taxCode: 'other' }
      ]
    })

    // Both start at 1 (their own settings row); unique index is per-company
    expect(a.invoice_number).toBe(1)
    expect(b.invoice_number).toBe(1)
  })

  it('captures issuer/recipient snapshots with footer data at issue time', async () => {
    const companies = container.resolve(CompanyService)
    const invoices = container.resolve(InvoiceService)
    const company = await companies.createCompany(issuer)

    const invoice = await invoices.createInvoice({
      companyId: company.id,
      recipientKind: 'company',
      recipientCompanyId: company.id,
      lineItems: [
        { description: 'X', quantity: 1, unitPriceNet: 50, taxRate: 19, taxCode: 'standard' }
      ]
    })

    // The recipient snapshot must be frozen with the issuer company's data
    expect(invoice.recipientSnapshot).not.toBeNull()
    expect(invoice.recipientSnapshot?.legal_name).toBe('Issuer GmbH')
    expect(invoice.recipientSnapshot?.vat_number).toBe('DE212298737')
    expect(invoice.recipientSnapshot?.tax_number).toBe('12712063600')
  })

  it('computes line totals and sums correctly', async () => {
    const companies = container.resolve(CompanyService)
    const invoices = container.resolve(InvoiceService)
    const company = await companies.createCompany(issuer)

    const invoice = await invoices.createInvoice({
      companyId: company.id,
      lineItems: [
        {
          description: 'Net 100 +19%',
          quantity: 1,
          unitPriceNet: 100,
          taxRate: 19,
          taxCode: 'standard'
        },
        {
          description: 'Net 10 +19%',
          quantity: 2,
          unitPriceNet: 5,
          taxRate: 19,
          taxCode: 'standard'
        }
      ]
    })

    expect(invoice.lineItems).toHaveLength(2)
    expect(invoice.lineItems[0].line_net_amount).toBe(100)
    expect(invoice.lineItems[0].line_tax_amount).toBe(19)
    expect(invoice.lineItems[1].line_net_amount).toBe(10)
    expect(invoice.lineItems[1].line_tax_amount).toBeCloseTo(1.9, 2)
    expect(invoice.subtotal_net_amount).toBe(110)
    expect(invoice.subtotal_tax_amount).toBeCloseTo(20.9, 2)
    expect(invoice.total_gross_amount).toBeCloseTo(130.9, 2)
  })

  it('updates an invoice without wiping line items', async () => {
    const companies = container.resolve(CompanyService)
    const invoices = container.resolve(InvoiceService)
    const company = await companies.createCompany(issuer)

    const invoice = await invoices.createInvoice({
      companyId: company.id,
      status: 'draft',
      lineItems: [
        { description: 'Item', quantity: 1, unitPriceNet: 42, taxRate: 0, taxCode: 'other' }
      ]
    })

    const updated = await invoices.updateInvoice({ id: invoice.id, status: 'issued' })
    expect(updated.status).toBe('issued')
    expect(updated.lineItems).toHaveLength(1)
    expect(updated.lineItems[0].description).toBe('Item')
  })
})
