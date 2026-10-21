// Invoice repository/service tests: sequential per-company numbering on
// issue (the unique index on (company_id, invoice_number) must never trip),
// the draft/issued/cancelled lifecycle rules, issuer and recipient snapshot
// capture with footer fields, and line-item totals.
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
      status: 'issued',
      lineItems: [
        { description: 'A', quantity: 1, unitPriceNet: 100, taxRate: 19, taxCode: 'standard' }
      ]
    })
    const b = await invoices.createInvoice({
      companyId: company.id,
      status: 'issued',
      lineItems: [
        { description: 'B', quantity: 1, unitPriceNet: 200, taxRate: 0, taxCode: 'other' }
      ]
    })

    expect(a.invoice_number).toBeGreaterThan(0)
    expect(b.invoice_number).toBe((a.invoice_number ?? 0) + 1)
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
      status: 'issued',
      lineItems: [
        { description: 'A', quantity: 1, unitPriceNet: 100, taxRate: 0, taxCode: 'other' }
      ]
    })
    const b = await invoices.createInvoice({
      companyId: c2.id,
      status: 'issued',
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

  describe('lifecycle', () => {
    const line = [
      { description: 'Gage', quantity: 1, unitPriceNet: 100, taxRate: 0, taxCode: 'other' as const }
    ]

    async function setup() {
      const companies = container.resolve(CompanyService)
      const invoices = container.resolve(InvoiceService)
      const company = await companies.createCompany({
        ...issuer,
        name: `Lifecycle ${Math.random()}`,
        isDefaultForInvoicing: false
      })
      return { invoices, company }
    }

    it('drafts get no number; issuing takes the next one', async () => {
      const { invoices, company } = await setup()

      const draft = await invoices.createInvoice({ companyId: company.id, lineItems: line })
      expect(draft.status).toBe('draft')
      expect(draft.invoice_number).toBeNull()

      const issued = await invoices.setInvoiceStatus(draft.id, 'issued')
      expect(issued.invoice_number).toBe(1)

      // Issuing via the form's update path numbers the same way
      const draft2 = await invoices.createInvoice({ companyId: company.id, lineItems: line })
      const issued2 = await invoices.updateInvoice({ id: draft2.id, status: 'issued' })
      expect(issued2.invoice_number).toBe(2)
    })

    it('refuses to issue an invoice with a zero total', async () => {
      const { invoices, company } = await setup()
      const empty = await invoices.createInvoice({ companyId: company.id })

      await expect(invoices.setInvoiceStatus(empty.id, 'issued')).rejects.toThrow(/0,00/)
      await expect(invoices.updateInvoice({ id: empty.id, status: 'issued' })).rejects.toThrow(
        /0,00/
      )
      // Nothing was consumed: the next issued invoice still gets number 1
      const draft = await invoices.createInvoice({ companyId: company.id, lineItems: line })
      expect((await invoices.setInvoiceStatus(draft.id, 'issued')).invoice_number).toBe(1)
    })

    it('deleting a draft leaves no gap in the sequence', async () => {
      const { invoices, company } = await setup()

      const throwaway = await invoices.createInvoice({ companyId: company.id, lineItems: line })
      await invoices.deleteInvoice(throwaway.id)

      const draft = await invoices.createInvoice({ companyId: company.id, lineItems: line })
      const issued = await invoices.setInvoiceStatus(draft.id, 'issued')
      expect(issued.invoice_number).toBe(1)
    })

    it('locks issued invoices: no edits, no delete', async () => {
      const { invoices, company } = await setup()
      const issued = await invoices.createInvoice({
        companyId: company.id,
        status: 'issued',
        lineItems: line
      })

      await expect(invoices.updateInvoice({ id: issued.id, notes: 'changed' })).rejects.toThrow(
        /nicht mehr bearbeitet/
      )
      await expect(invoices.deleteInvoice(issued.id)).rejects.toThrow(/Nur Entwürfe/)
      expect(await invoices.getInvoiceById(issued.id)).not.toBeNull()
    })

    it('allows paid/overdue changes and Storno, which is final', async () => {
      const { invoices, company } = await setup()
      const issued = await invoices.createInvoice({
        companyId: company.id,
        status: 'issued',
        lineItems: line
      })

      expect((await invoices.setInvoiceStatus(issued.id, 'overdue')).status).toBe('overdue')
      expect((await invoices.setInvoiceStatus(issued.id, 'paid')).status).toBe('paid')

      const cancelled = await invoices.setInvoiceStatus(issued.id, 'cancelled')
      expect(cancelled.status).toBe('cancelled')
      expect(cancelled.invoice_number).toBe(issued.invoice_number)

      await expect(invoices.setInvoiceStatus(issued.id, 'paid')).rejects.toThrow(/nicht erlaubt/)
      await expect(invoices.deleteInvoice(issued.id)).rejects.toThrow(/Nur Entwürfe/)
    })

    it('keeps every email, the latest also on the invoice for the list', async () => {
      const { invoices, company } = await setup()
      const issued = await invoices.createInvoice({
        companyId: company.id,
        status: 'issued',
        lineItems: line
      })

      invoices.markInvoiceEmailed(issued.id, 'buchhaltung@club.de')
      invoices.markInvoiceEmailed(issued.id, '')
      const loaded = await invoices.getInvoiceById(issued.id)
      expect(loaded?.emails.map((email) => email.to)).toEqual(['', 'buchhaltung@club.de'])
      expect(loaded?.emailed_to).toBe('')
      expect(loaded?.emailed_at).toBe(loaded?.emails[0].created_at)
    })

    it('logs each status the invoice moves to, for its Verlauf', async () => {
      const { invoices, company } = await setup()
      const statuses = async (id: number) =>
        (await invoices.getInvoiceById(id))?.statusChanges.map((change) => change.status)

      const draft = await invoices.createInvoice({ companyId: company.id, lineItems: line })
      expect(await statuses(draft.id)).toEqual([])
      // Saving the draft without a status change logs nothing
      await invoices.updateInvoice({ id: draft.id, notes: 'x', status: 'draft' })
      expect(await statuses(draft.id)).toEqual([])

      await invoices.updateInvoice({ id: draft.id, status: 'issued' })
      await invoices.setInvoiceStatus(draft.id, 'overdue')
      await invoices.setInvoiceStatus(draft.id, 'issued')
      await invoices.setInvoiceStatus(draft.id, 'issued')
      await invoices.setInvoiceStatus(draft.id, 'paid')
      const cancelled = await invoices.setInvoiceStatus(draft.id, 'cancelled')
      expect(await statuses(draft.id)).toEqual(['issued', 'overdue', 'issued', 'paid', 'cancelled'])
      expect(cancelled.statusChanges[0].created_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)

      // The Stornorechnung is issued right away, as is an invoice created issued
      expect(await statuses(cancelled.cancelledBy!.id)).toEqual(['issued'])
      const issued = await invoices.createInvoice({
        companyId: company.id,
        status: 'issued',
        lineItems: line
      })
      expect(issued.statusChanges.map((change) => change.status)).toEqual(['issued'])
    })

    it('rejects skipping the issue step or going back to draft', async () => {
      const { invoices, company } = await setup()
      const draft = await invoices.createInvoice({ companyId: company.id, lineItems: line })

      await expect(invoices.setInvoiceStatus(draft.id, 'paid')).rejects.toThrow(/nicht erlaubt/)
      await expect(invoices.setInvoiceStatus(draft.id, 'cancelled')).rejects.toThrow(
        /nicht erlaubt/
      )

      await invoices.setInvoiceStatus(draft.id, 'issued')
      await expect(invoices.setInvoiceStatus(draft.id, 'draft')).rejects.toThrow(/nicht erlaubt/)
      await expect(
        invoices.createInvoice({ companyId: company.id, status: 'cancelled', lineItems: line })
      ).rejects.toThrow(/storniert/)
    })
  })
})
