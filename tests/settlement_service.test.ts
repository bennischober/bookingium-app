// #228: a show's settlement stored with its event and the management fee invoice made from it
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { CompanyService } from '../src/main/services/CompanyService'
import { InvoiceService } from '../src/main/services/InvoiceService'
import { ManagementContractService } from '../src/main/services/ManagementContractService'
import { SettlementService } from '../src/main/services/SettlementService'
import { BandRepository } from '../src/main/repositories/BandRepository'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { eq } from 'drizzle-orm'
import {
  computeSettlement,
  EMPTY_SETTLEMENT,
  managementFee,
  type SettlementInput
} from '../src/main/settlement/settlement'
import { convertCents } from '../src/main/einvoice/amounts'
import { SETTLEMENT_REPORT_NOTE } from '../src/main/advancing/advancing'
import { setupTestDb } from './helpers/setup'

setupTestDb()

// The numbers of a real settlement: 4.221,50 € gage net (50 % of the door, above the guarantee)
const show: SettlementInput = {
  ...EMPTY_SETTLEMENT,
  lines: [
    { system: 'A', category: 'Online', priceCents: 3000, extraCents: 0, sold: 210, wkzCents: 100 },
    { system: 'B', category: 'Regulär', priceCents: 3300, extraCents: 0, sold: 58, wkzCents: 100 },
    { system: 'Gebühr', category: '', priceCents: 300, extraCents: 0, sold: 210, wkzCents: 0 },
    { system: 'AK', category: 'Regulär', priceCents: 3800, extraCents: 0, sold: 5, wkzCents: 0 }
  ],
  guaranteeCents: 200000,
  tiers: [{ percent: 50, fromCents: 0 }],
  costs: [{ label: 'Übernachtungspauschale', netCents: 70000 }]
}

async function setup() {
  const companies = container.resolve(CompanyService)
  const bandCompany = await companies.createCompany({ name: 'Beispielband GbR' })
  const management = await companies.createCompany({ name: 'Beispiel Management GmbH' })
  const band = await container.resolve(BandRepository).create({
    name: 'Beispielband',
    companyId: bandCompany.id,
    managementCompanyId: management.id
  })
  const contract = await container.resolve(ManagementContractService).createForBand(band.id)
  db.update(schema.management_contract)
    .set({ commission_percent: 15, agency_percent: 15 })
    .where(eq(schema.management_contract.id, contract.id))
    .run()
  const event = db
    .insert(schema.deal_memo)
    .values({ name: 'Beispielband – Halle', date: '2026-11-13', band_id: band.id })
    .returning({ id: schema.deal_memo.id })
    .get()
  return { event, band, bandCompany, management }
}

describe('settlement service', () => {
  const settlements = container.resolve(SettlementService)
  const invoices = container.resolve(InvoiceService)

  it('stores the settlement per event and shows the contract it is billed under', async () => {
    const { event } = await setup()
    expect(settlements.get(event.id)).toMatchObject({ input: null, feeInvoice: null })
    const saved = settlements.save({
      eventId: event.id,
      input: show,
      sourceFileName: 'Abrechnung.xlsx'
    })
    expect(saved.input).toEqual(show)
    expect(saved.sourceFileName).toBe('Abrechnung.xlsx')
    expect(saved.contract).toMatchObject({
      managementCompanyName: 'Beispiel Management GmbH',
      commissionPercent: 15,
      agencyPercent: 15
    })
    // Saving again keeps one row and the file name
    settlements.save({
      eventId: event.id,
      input: { ...show, guaranteeCents: 1 },
      sourceFileName: ''
    })
    expect(settlements.get(event.id)).toMatchObject({
      sourceFileName: 'Abrechnung.xlsx',
      input: { guaranteeCents: 1 }
    })
  })

  it('bills the management fee on the gage only, once: 640,51 € gross', async () => {
    const { event, bandCompany, management } = await setup()
    expect(() => settlements.createFeeInvoice(event.id)).toThrow(/keine Abrechnung/)
    settlements.save({ eventId: event.id, input: show, sourceFileName: '' })

    const invoiceId = settlements.createFeeInvoice(event.id)
    const invoice = await invoices.getInvoiceById(invoiceId)
    expect(invoice).toMatchObject({
      status: 'draft',
      company_id: management.id,
      deal_memo_id: event.id,
      total_gross_cents: 64051
    })
    expect(invoice?.recipientSnapshot?.source_company_id).toBe(bandCompany.id)
    expect(settlements.get(event.id).feeInvoice).toMatchObject({ id: invoiceId, status: 'draft' })
    expect(() => settlements.createFeeInvoice(event.id)).toThrow(/schon erstellt/)
  })

  it('bills a settlement in pounds in euros, at the entered rate, and says so on the line', async () => {
    const { event } = await setup()
    const pounds: SettlementInput = { ...show, currency: 'GBP' }
    settlements.save({ eventId: event.id, input: pounds, sourceFileName: '' })
    // Without the rate there is no euro amount to bill
    expect(() => settlements.createFeeInvoice(event.id)).toThrow(/GBP.*Umrechnungskurs/)

    settlements.save({
      eventId: event.id,
      input: { ...pounds, eurRate: 1.17, eurRateDate: '2026-11-20' },
      sourceFileName: ''
    })
    expect(settlements.get(event.id).input).toMatchObject({ currency: 'GBP', eurRate: 1.17 })

    const invoice = await invoices.getInvoiceById(settlements.createFeeInvoice(event.id))
    const gage = computeSettlement(pounds).gageCents
    const expected = managementFee(convertCents(gage, 1.17), 15, 15, 19)
    expect(invoice).toMatchObject({ currency: 'EUR', total_gross_cents: expected.grossCents })
    // The invoice is in euros; the line names the pounds, the rate and its date
    expect(invoice?.lineItems[0].description).toContain('zum Kurs 1,17 (20.11.2026)')
    expect(invoice?.lineItems[0].description).toMatch(/4\.221,50\s£/)
  })

  it('writes the tickets settled as the sales report of the show day, once', async () => {
    const { event } = await setup()
    const reports = () =>
      db
        .select()
        .from(schema.ticket_report)
        .where(eq(schema.ticket_report.deal_memo_id, event.id))
        .all()
    // a presale report of the promoter stays beside it
    db.insert(schema.ticket_report)
      .values({ deal_memo_id: event.id, report_date: '2026-11-01', sold: 190, note: '' })
      .run()

    settlements.save({ eventId: event.id, input: show, sourceFileName: '' })
    const settled = computeSettlement(show).sold
    expect(reports()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ report_date: '2026-11-01', sold: 190 }),
        expect.objectContaining({
          report_date: '2026-11-13',
          sold: settled,
          note: SETTLEMENT_REPORT_NOTE
        })
      ])
    )

    // saving a corrected settlement replaces the show day's report instead of adding one
    settlements.save({
      eventId: event.id,
      input: { ...show, lines: show.lines.map((line) => ({ ...line, sold: 1 })) },
      sourceFileName: ''
    })
    const showDay = reports().filter((r) => r.report_date === '2026-11-13')
    expect(showDay).toHaveLength(1)
    expect(showDay[0].sold).toBe(show.lines.length)
  })

  it('writes no sales report for a settlement without tickets', async () => {
    const { event } = await setup()
    settlements.save({ eventId: event.id, input: { ...show, lines: [] }, sourceFileName: '' })
    expect(
      db
        .select()
        .from(schema.ticket_report)
        .where(eq(schema.ticket_report.deal_memo_id, event.id))
        .all()
    ).toHaveLength(0)
  })
})
