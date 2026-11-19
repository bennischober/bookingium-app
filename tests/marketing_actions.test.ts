// Maßnahmen of a band: radio spots, posters … for a show or tour, with cost and invoice
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { setupTestDb, getTestDb } from './helpers/setup'
import {
  MarketingActionService,
  invoiceLine,
  periodLabel
} from '../src/main/services/MarketingActionService'
import { MarketingRepository } from '../src/main/repositories/MarketingRepository'
import { CompanyService } from '../src/main/services/CompanyService'
import { BandService } from '../src/main/services/BandService'
import { CreateCompanyInput } from '../src/main/api/schemas/company.schema'
import { CreateMarketingActionInput } from '../src/main/api/schemas/marketing.schema'
import { parseAtlasText } from '../src/main/marketing/atlasFormat'
import { schema } from '../src/main/db/schema'

setupTestDb()

const service = () => container.resolve(MarketingActionService)
const db = () => getTestDb().db

async function seed(name: string) {
  const owner = await container
    .resolve(CompanyService)
    .createCompany(CreateCompanyInput.parse({ name: `${name} GmbH` }))
  const band = await container
    .resolve(BandService)
    .createBand({ name, companyId: owner.id, genre: '', notes: '' })
  const station = await container
    .resolve(CompanyService)
    .createCompany(CreateCompanyInput.parse({ name: `${name} Radio`, kind: 'media' }))
  const venue = db()
    .insert(schema.venue)
    .values({ name: 'Halle Probe', kind: 'venue' })
    .returning()
    .get()
  const show = db()
    .insert(schema.deal_memo)
    .values({
      band_id: band.id,
      date: '2027-03-12',
      name: 'Leipzig',
      venue_id: venue.id,
      tour: 'Frühjahr 2027'
    })
    .returning()
    .get()
  return { band, station, show }
}

const action = (over: object) =>
  CreateMarketingActionInput.parse({ kind: 'radio_spot', title: 'Spot 20 s', ...over })

describe('measures', () => {
  it('takes the tour from the show and lists by band, show and partner', async () => {
    const { band, station, show } = await seed('Spotband')
    const id = service().create(
      action({
        bandId: band.id,
        dealMemoId: show.id,
        companyId: station.id,
        startDate: '2027-02-26',
        endDate: '2027-03-11',
        costCents: 120_000,
        status: 'booked'
      })
    )
    const [listed] = service().list({ bandId: band.id })
    expect(listed).toMatchObject({
      id,
      tour: 'Frühjahr 2027',
      showLabel: 'Leipzig, Halle Probe · 12.03.2027',
      companyName: 'Spotband Radio',
      costCents: 120_000,
      status: 'booked'
    })
    expect(service().list({ dealMemoId: show.id })).toHaveLength(1)
    expect(service().list({ companyId: station.id })).toHaveLength(1)
  })

  it('creates a draft invoice for the cost to the band, only once', async () => {
    const { band, station, show } = await seed('Rechnungsband')
    // the management's own company issues it
    await container
      .resolve(CompanyService)
      .createCompany(
        CreateCompanyInput.parse({ name: 'Eigene Management GmbH', isDefaultForInvoicing: true })
      )
    const id = service().create(
      action({ bandId: band.id, dealMemoId: show.id, companyId: station.id, costCents: 50_000 })
    )
    const invoiceId = await service().createInvoice({
      id,
      recipient: 'band',
      recipientCompanyId: null
    })
    const invoice = db()
      .select()
      .from(schema.invoice)
      .where(eq(schema.invoice.id, invoiceId))
      .get()!
    expect(invoice).toMatchObject({ status: 'draft', deal_memo_id: show.id, invoice_number: null })
    expect(invoice.subtotal_net_cents).toBe(50_000)
    const line = db()
      .select()
      .from(schema.invoice_line_item)
      .where(eq(schema.invoice_line_item.invoice_id, invoiceId))
      .get()!
    expect(line.description).toBe(
      'Radiospot: Spot 20 s bei Rechnungsband Radio für Leipzig, Halle Probe · 12.03.2027'
    )
    expect(service().list({ bandId: band.id })[0].invoiceId).toBe(invoiceId)
    await expect(
      service().createInvoice({ id, recipient: 'band', recipientCompanyId: null })
    ).rejects.toThrow(/schon eine Rechnung/)
  })

  it('refuses an invoice without cost', async () => {
    const { band } = await seed('Kostenlosband')
    const id = service().create(action({ bandId: band.id }))
    await expect(
      service().createInvoice({ id, recipient: 'band', recipientCompanyId: null })
    ).rejects.toThrow(/Kosten/)
  })

  it('formats period and line', () => {
    expect(periodLabel('2027-02-26', '2027-03-11')).toBe('26.02.2027 – 11.03.2027')
    expect(periodLabel(null, null)).toBe('')
    expect(
      invoiceLine({
        kind: 'poster',
        title: 'A1 Plakate',
        companyName: null,
        showLabel: null,
        tour: 'Herbst 2027',
        startDate: '2027-09-01',
        endDate: null
      })
    ).toBe('Plakat / Banner: A1 Plakate Tour Herbst 2027 (01.09.2027)')
  })

  it('an atlas entry shows how far its measures got', async () => {
    const { band } = await seed('Atlasspotband')
    container
      .resolve(MarketingRepository)
      .importAtlas(
        band.id,
        parseAtlasText(JSON.stringify([{ n: 'Probe Rock FM', tab: 'radios', prio: 'A' }])),
        'a.json',
        { contacts: 'none', contactLists: false }
      )
    const item = container.resolve(MarketingRepository).items(band.id)[0]
    service().create(action({ bandId: band.id, marketingItemId: item.id, status: 'planned' }))
    service().create(
      action({ bandId: band.id, marketingItemId: item.id, status: 'running', title: 'Spot 2' })
    )
    const { marketingRouter } = await import('../src/main/api/routers/marketing.router')
    const caller = marketingRouter.createCaller({})
    const overview = await caller.overview(band.id)
    expect(overview.items[0].actionStatus).toBe('running')
  })
})
