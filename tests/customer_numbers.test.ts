// Kundennummern made in Bookingium: a customer gets the next free number with its first issued
// invoice (never one a company, band or person already has), keeps it, and the invoice freezes it.
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { container } from 'tsyringe'
import { CompanyService } from '../src/main/services/CompanyService'
import { InvoiceService } from '../src/main/services/InvoiceService'
import { SettingsService } from '../src/main/services/SettingsService'
import { BandService } from '../src/main/services/BandService'
import { CreateCompanyInput } from '../src/main/api/schemas/company.schema'
import { setupTestDb } from './helpers/setup'

setupTestDb()

const line = [
  { description: 'A', quantity: 1, unitPriceNet: 100, taxRate: 19, taxCode: 'standard' as const }
]

async function company(name: string, customerNumber?: number) {
  return container
    .resolve(CompanyService)
    .createCompany(CreateCompanyInput.parse({ name, customerNumber }))
}

async function invoiceTo(issuerId: number, recipientId: number, status: 'draft' | 'issued') {
  return container.resolve(InvoiceService).createInvoice({
    companyId: issuerId,
    recipientKind: 'company',
    recipientCompanyId: recipientId,
    status,
    issueDate: '2026-11-20',
    lineItems: line
  })
}

describe('Kundennummern', () => {
  it('are given with the first issued invoice, not with a draft, and kept', async () => {
    const issuer = await company('Issuer Kundennr GmbH')
    const customer = await company('Kunde Eins GmbH')
    container.resolve(SettingsService).update({ nextCustomerNumber: 10500 })

    const draft = await invoiceTo(issuer.id, customer.id, 'draft')
    expect(
      (await container.resolve(CompanyService).getCompanyById(customer.id))?.customer_number
    ).toBeNull()

    await container.resolve(InvoiceService).setInvoiceStatus(draft.id, 'issued')
    const numbered = await container.resolve(CompanyService).getCompanyById(customer.id)
    expect(numbered?.customer_number).toBe(10500)
    expect(container.resolve(SettingsService).get().nextCustomerNumber).toBe(10501)

    // A second invoice to the same customer keeps the number
    await invoiceTo(issuer.id, customer.id, 'issued')
    expect(
      (await container.resolve(CompanyService).getCompanyById(customer.id))?.customer_number
    ).toBe(10500)
    expect(container.resolve(SettingsService).get().nextCustomerNumber).toBe(10501)

    // The invoice shows it
    const print = await container.resolve(InvoiceService).getInvoicePrintData(draft.id)
    expect(print?.recipientSnapshot?.customer_number).toBe(10500)
  })

  it('of a band come from its company, which also stands on the invoice', async () => {
    const issuer = await company('Issuer Band GmbH')
    const gbr = await company('Beispielband – Muster & Beispiel GbR', 1)
    const band = await container
      .resolve(BandService)
      .createBand({ name: 'BEISPIELBAND', genre: '', notes: '', companyId: gbr.id })
    container.resolve(SettingsService).update({ nextCustomerNumber: 15000 })

    const issued = await container.resolve(InvoiceService).createInvoice({
      companyId: issuer.id,
      recipientKind: 'band',
      recipientBandId: band.id,
      status: 'issued',
      issueDate: '2026-11-20',
      lineItems: line
    })
    const print = await container.resolve(InvoiceService).getInvoicePrintData(issued.id)
    expect(print?.recipientSnapshot).toMatchObject({
      kind: 'band',
      source_band_id: band.id,
      source_company_id: gbr.id,
      legal_name: 'Beispielband – Muster & Beispiel GbR',
      customer_number: 1
    })
    // No number of its own for the band, none used up
    expect(container.resolve(SettingsService).get().nextCustomerNumber).toBe(15000)
  })

  it('go to the band’s company when it has none yet', async () => {
    const issuer = await company('Issuer Band Neu GmbH')
    const gbr = await company('Neue Band GbR')
    const band = await container
      .resolve(BandService)
      .createBand({ name: 'NEUE BAND', genre: '', notes: '', companyId: gbr.id })
    container.resolve(SettingsService).update({ nextCustomerNumber: 16000 })

    const issued = await container.resolve(InvoiceService).createInvoice({
      companyId: issuer.id,
      recipientKind: 'band',
      recipientBandId: band.id,
      status: 'issued',
      issueDate: '2026-11-20',
      lineItems: line
    })
    expect((await container.resolve(CompanyService).getCompanyById(gbr.id))?.customer_number).toBe(
      16000
    )
    const print = await container.resolve(InvoiceService).getInvoicePrintData(issued.id)
    expect(print?.recipientSnapshot?.customer_number).toBe(16000)
  })

  it('skip numbers that are already taken, e.g. imported from DATEV', async () => {
    const issuer = await company('Issuer Skip GmbH')
    await company('Aus DATEV GmbH', 20000)
    container.resolve(SettingsService).update({ nextCustomerNumber: 20000 })
    const fresh = await company('Neukunde GmbH')
    await invoiceTo(issuer.id, fresh.id, 'issued')
    expect(
      (await container.resolve(CompanyService).getCompanyById(fresh.id))?.customer_number
    ).toBe(20001)
  })

  it('refuse a number another record already has', async () => {
    await company('Erste GmbH', 30000)
    await expect(company('Zweite GmbH', 30000)).rejects.toThrow(
      /Kundennummer 30000 gehört schon der Firma/
    )
    const second = await company('Dritte GmbH')
    await expect(
      container.resolve(CompanyService).updateCompany({ id: second.id, customerNumber: 30000 })
    ).rejects.toThrow(/gehört schon der Firma/)
  })

  it('take an empty field as none and refuse anything but a whole number', () => {
    expect(CreateCompanyInput.parse({ name: 'X', customerNumber: '' }).customerNumber).toBeNull()
    expect(CreateCompanyInput.parse({ name: 'X', customerNumber: '10023' }).customerNumber).toBe(
      10023
    )
    expect(() => CreateCompanyInput.parse({ name: 'X', customerNumber: '10.5' })).toThrow()
    expect(() => CreateCompanyInput.parse({ name: 'X', customerNumber: 'abc' })).toThrow()
  })
})
