// Quarterly management share tests: the draft invoice built from a band's
// management contract (parties, period, commission, VAT, due date), the
// one-invoice-per-quarter rule and the stored income lines.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { CompanyService } from '../src/main/services/CompanyService'
import { InvoiceService } from '../src/main/services/InvoiceService'
import { ManagementContractService } from '../src/main/services/ManagementContractService'
import { BandRepository } from '../src/main/repositories/BandRepository'
import { quarterDates } from '../src/main/api/schemas/management_contract.schema'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { eq } from 'drizzle-orm'

import { setupTestDb } from './helpers/setup'

setupTestDb()

const address = (street: string, zipCode: string, city: string) => ({
  street,
  streetNumber: '1',
  addressSuffix: '',
  zipCode,
  city,
  state: '',
  country: 'Germany',
  countryCode: 'DE'
})

// The reference invoice: 20 % of 114.217,60 € = 22.843,52 € net
const Q4_INCOME = [
  { description: 'Konzerte', netAmount: 80000 },
  { description: 'Merchandise', netAmount: 34217.6 }
]

async function setup(name: string) {
  const companies = container.resolve(CompanyService)
  const bands = container.resolve(BandRepository)
  const bandCompany = await companies.createCompany({
    name: `${name} GbR`,
    address: address('Langestrasse', '65366', 'Geisenheim'),
    isDefaultForInvoicing: false
  })
  const management = await companies.createCompany({
    name: `${name} Management AG`,
    address: address('Weidachstr.', '87541', 'Bad Hindelang'),
    isDefaultForInvoicing: false
  })
  const band = await bands.create({
    name,
    companyId: bandCompany.id,
    managementCompanyId: management.id
  })
  const service = container.resolve(ManagementContractService)
  const contract = await service.createForBand(band.id)
  return { service, band, bandCompany, management, contract }
}

describe('quarterDates', () => {
  it('spans the quarter from its first to its last day', () => {
    expect(quarterDates(2025, 4)).toEqual({ start: '2025-10-01', end: '2025-12-31' })
    expect(quarterDates(2024, 1)).toEqual({ start: '2024-01-01', end: '2024-03-31' })
    expect(quarterDates(2026, 2)).toEqual({ start: '2026-04-01', end: '2026-06-30' })
    expect(quarterDates(2026, 3)).toEqual({ start: '2026-07-01', end: '2026-09-30' })
  })
})

describe('ManagementContractService.createShare', () => {
  it('drafts the quarter invoice from management to the band company', async () => {
    const { service, band, bandCompany, management, contract } = await setup('Rosen')

    const share = await service.createShare({
      contractId: contract.id,
      year: 2025,
      quarter: 4,
      income: Q4_INCOME,
      taxRate: 19,
      issueDate: '2026-01-15'
    })

    expect(share.bandId).toBe(band.id)
    expect(share.managementContractId).toBe(contract.id)
    expect(share.commissionPercent).toBe(20)
    expect(share.incomeTotal).toBe(114217.6)
    expect(share.netAmount).toBe(22843.52)
    expect(share.income).toEqual(Q4_INCOME)
    expect(share.invoiceStatus).toBe('draft')
    expect(share.invoiceNumber).toBeNull()

    const invoice = await container.resolve(InvoiceService).getInvoicePrintData(share.invoiceId)
    expect(invoice?.company_id).toBe(management.id)
    expect(invoice?.issuerSnapshot?.legal_name).toBe('Rosen Management AG')
    expect(invoice?.recipientSnapshot?.kind).toBe('company')
    expect(invoice?.recipientSnapshot?.source_company_id).toBe(bandCompany.id)
    expect(invoice?.recipientSnapshot?.legal_name).toBe('Rosen GbR')
    expect(invoice?.period_label).toBe('4. Quartal 2025')
    expect(invoice?.period_start_date).toBe('2025-10-01')
    expect(invoice?.period_end_date).toBe('2025-12-31')
    expect(invoice?.issue_date).toBe('2026-01-15')
    // Contract default: payable within 14 days
    expect(invoice?.due_date).toBe('2026-01-29')
    expect(invoice?.lineItems).toHaveLength(1)
    expect(invoice?.lineItems[0]).toMatchObject({
      description: 'Managementbeteiligung 4. Quartal 2025',
      quantity: 1,
      unit_price_net: 22843.52,
      tax_rate: 19,
      line_net_amount: 22843.52,
      line_tax_amount: 4340.27
    })
    expect(invoice?.subtotal_net_amount).toBe(22843.52)
    expect(invoice?.subtotal_tax_amount).toBe(4340.27)
    expect(invoice?.total_gross_amount).toBe(27183.79)
  })

  it("uses the chosen contract's commission and payment days", async () => {
    const { service, band, contract: first } = await setup('Renewed')
    const second = await service.createForBand(band.id)
    await service.update({ id: second.id, commissionPercent: 15, paymentDays: 30 })

    const share = await service.createShare({
      contractId: second.id,
      year: 2026,
      quarter: 1,
      income: [{ description: 'Konzerte', netAmount: 1000 }],
      taxRate: 19,
      issueDate: '2026-04-20'
    })
    expect(share.commissionPercent).toBe(15)
    expect(share.netAmount).toBe(150)
    const invoice = await container.resolve(InvoiceService).getInvoiceById(share.invoiceId)
    expect(invoice?.due_date).toBe('2026-05-20')

    // An older quarter can still be billed under the earlier contract
    const old = await service.createShare({
      contractId: first.id,
      year: 2025,
      quarter: 4,
      income: [{ description: 'Konzerte', netAmount: 1000 }],
      taxRate: 19
    })
    expect(old.commissionPercent).toBe(20)
    expect(old.netAmount).toBe(200)
  })

  it('bills a quarter once; Storno or deleting the draft frees it again', async () => {
    const { service, band, contract } = await setup('Once')
    const invoices = container.resolve(InvoiceService)
    const input = {
      contractId: contract.id,
      year: 2025,
      quarter: 3,
      income: [{ description: 'Konzerte', netAmount: 5000 }],
      taxRate: 19
    }

    const draft = await service.createShare(input)
    await expect(service.createShare(input)).rejects.toThrow(
      '3. Quartal 2025 ist bereits abgerechnet (Entwurf)'
    )

    // Deleting the draft removes its share with it
    await invoices.deleteInvoice(draft.invoiceId)
    expect(await service.listSharesByBand(band.id)).toEqual([])

    const issued = await service.createShare(input)
    const { invoice_number } = await invoices.setInvoiceStatus(issued.invoiceId, 'issued')
    await expect(service.createShare(input)).rejects.toThrow(`(Rechnung Nr. ${invoice_number})`)

    await invoices.setInvoiceStatus(issued.invoiceId, 'cancelled')
    const rebilled = await service.createShare(input)
    expect(rebilled.invoiceStatus).toBe('draft')
    // Other quarters are unaffected
    await expect(service.createShare({ ...input, quarter: 4 })).resolves.toBeTruthy()
  })

  it('refuses a zero share and a contract without management', async () => {
    const { service, contract } = await setup('Zero')
    await expect(
      service.createShare({
        contractId: contract.id,
        year: 2025,
        quarter: 1,
        income: [{ description: 'Konzerte', netAmount: 0 }],
        taxRate: 19
      })
    ).rejects.toThrow(/0,00/)

    await service.update({ id: contract.id, managementCompanyId: null })
    await expect(
      service.createShare({
        contractId: contract.id,
        year: 2025,
        quarter: 1,
        income: Q4_INCOME,
        taxRate: 19
      })
    ).rejects.toThrow(/kein Management/)
    const left = await db
      .select()
      .from(schema.management_share)
      .where(eq(schema.management_share.management_contract_id, contract.id))
    expect(left).toEqual([])
  })

  it("lists a band's billed quarters newest first with their income", async () => {
    const { service, band, contract } = await setup('Listed')
    const base = { contractId: contract.id, taxRate: 19 }
    await service.createShare({ ...base, year: 2025, quarter: 2, income: Q4_INCOME })
    await service.createShare({
      ...base,
      year: 2026,
      quarter: 1,
      income: [{ description: 'Lizenzen', netAmount: 250 }]
    })
    await service.createShare({ ...base, year: 2025, quarter: 4, income: Q4_INCOME })

    const shares = await service.listSharesByBand(band.id)
    expect(shares.map((s) => `${s.year}/${s.quarter}`)).toEqual(['2026/1', '2025/4', '2025/2'])
    expect(shares[0].income).toEqual([{ description: 'Lizenzen', netAmount: 250 }])
    expect(shares[0].netAmount).toBe(50)
  })
})
