// Invoice numbers in step with DATEV: plain or year + running number (with or without a
// yearly restart), and no invoice issued with a date before the company's last one.
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { container } from 'tsyringe'
import { CompanyService } from '../src/main/services/CompanyService'
import { InvoiceService } from '../src/main/services/InvoiceService'
import { takeNumber, type NumberingSettings } from '../src/main/invoice/numbering'
import { setupTestDb } from './helpers/setup'

setupTestDb()

const plain: NumberingSettings = {
  format: 'plain',
  digits: 3,
  yearlyReset: false,
  next: 1040,
  lastYear: null
}
const year: NumberingSettings = { ...plain, format: 'year', next: 813, lastYear: 2026 }

describe('takeNumber', () => {
  it('counts on with the plain format, whatever the year', () => {
    expect(takeNumber(plain, 2026)).toEqual({ number: 1040, next: 1041, year: 2026 })
    expect(takeNumber({ ...plain, lastYear: 2026 }, 2027).number).toBe(1040)
  })

  it('puts the year in front of the padded running number', () => {
    expect(takeNumber(year, 2026)).toEqual({ number: 2026813, next: 814, year: 2026 })
    expect(takeNumber({ ...year, next: 7 }, 2026).number).toBe(2026007)
    expect(takeNumber({ ...year, next: 7, digits: 4 }, 2026).number).toBe(20260007)
  })

  it('continues the running number into a new year unless it restarts yearly', () => {
    expect(takeNumber(year, 2027)).toEqual({ number: 2027813, next: 814, year: 2027 })
    expect(takeNumber({ ...year, yearlyReset: true }, 2027)).toEqual({
      number: 2027001,
      next: 2,
      year: 2027
    })
    // Not again for the second invoice of that year
    expect(takeNumber({ ...year, yearlyReset: true, next: 2, lastYear: 2027 }, 2027).number).toBe(
      2027002
    )
  })
})

describe('issuing in step with DATEV', () => {
  async function company(name: string) {
    return container.resolve(CompanyService).createCompany({ name, isDefaultForInvoicing: false })
  }
  const line = [
    { description: 'A', quantity: 1, unitPriceNet: 100, taxRate: 19, taxCode: 'standard' as const }
  ]

  it('numbers by the company settings: year format, continued from DATEV', async () => {
    const issuer = await company('Year Numbering GmbH')
    const invoices = container.resolve(InvoiceService)
    await invoices.upsertCompanyInvoiceSettings({ companyId: issuer.id, nextInvoiceNumber: 813 })
    await invoices.setNumberingFormat({
      companyId: issuer.id,
      format: 'year',
      digits: 3,
      yearlyReset: true
    })
    const first = await invoices.createInvoice({
      companyId: issuer.id,
      status: 'issued',
      issueDate: '2026-11-20',
      lineItems: line
    })
    const second = await invoices.createInvoice({
      companyId: issuer.id,
      status: 'issued',
      issueDate: '2027-01-04',
      lineItems: line
    })
    expect([first.invoice_number, second.invoice_number]).toEqual([2026813, 2027001])
  })

  it('refuses an issue date before the last issued invoice, and a draft keeps no number', async () => {
    const issuer = await company('Chronological GmbH')
    const invoices = container.resolve(InvoiceService)
    await invoices.createInvoice({
      companyId: issuer.id,
      status: 'issued',
      issueDate: '2026-11-20',
      lineItems: line
    })
    await expect(
      invoices.createInvoice({
        companyId: issuer.id,
        status: 'issued',
        issueDate: '2026-11-19',
        lineItems: line
      })
    ).rejects.toThrow(/liegt vor der letzten gestellten Rechnung/)

    // A draft may carry the old date; issuing it is refused until the date is moved on
    const draft = await invoices.createInvoice({
      companyId: issuer.id,
      issueDate: '2026-11-18',
      lineItems: line
    })
    expect(draft.invoice_number).toBeNull()
    await expect(invoices.setInvoiceStatus(draft.id, 'issued')).rejects.toThrow(
      /Bitte ein Datum ab dem 20\.11\.2026 wählen/
    )
    // Same day as the last one is fine
    const sameDay = await invoices.createInvoice({
      companyId: issuer.id,
      status: 'issued',
      issueDate: '2026-11-20',
      lineItems: line
    })
    expect(sameDay.invoice_number).toBe(2)
  })

  it('keeps each company in its own order', async () => {
    const a = await company('Order A GmbH')
    const b = await company('Order B GmbH')
    const invoices = container.resolve(InvoiceService)
    await invoices.createInvoice({
      companyId: a.id,
      status: 'issued',
      issueDate: '2026-12-01',
      lineItems: line
    })
    const other = await invoices.createInvoice({
      companyId: b.id,
      status: 'issued',
      issueDate: '2026-11-01',
      lineItems: line
    })
    expect(other.invoice_number).toBe(1)
  })
})
