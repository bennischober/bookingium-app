// Lists behind the company and venue pages: which bands, venues, events and
// invoices belong to a company (in either role), and the events at a venue.
import 'reflect-metadata'
import { describe, it, expect, beforeAll } from 'vitest'
import { container } from 'tsyringe'
import { CompanyService } from '../src/main/services/CompanyService'
import { BandService } from '../src/main/services/BandService'
import { VenueService } from '../src/main/services/VenueService'
import { DealMemoService } from '../src/main/services/DealMemoService'
import { InvoiceService } from '../src/main/services/InvoiceService'
import { setupTestDb } from './helpers/setup'

setupTestDb()

const lineItems = [
  { description: 'Gage', quantity: 1, unitPriceNet: 100, taxRate: 0, taxCode: 'other' as const }
]

describe('company and venue page lists', () => {
  const companies = container.resolve(CompanyService)
  const bands = container.resolve(BandService)
  const venues = container.resolve(VenueService)
  const events = container.resolve(DealMemoService)
  const invoices = container.resolve(InvoiceService)

  // agency: owns one band, manages another, runs a venue, promotes and bills events
  let agency: number
  let other: number
  let ownBand: number
  let managedBand: number
  let otherBand: number
  let agencyVenue: number
  let otherVenue: number

  beforeAll(async () => {
    agency = (await companies.createCompany({ name: 'Agentur GmbH', isDefaultForInvoicing: true }))
      .id
    other = (await companies.createCompany({ name: 'Andere AG', isDefaultForInvoicing: false })).id

    ownBand = (await bands.createBand({ name: 'Zebra', genre: '', notes: '', companyId: agency }))
      .id
    managedBand = (
      await bands.createBand({
        name: 'Alpha',
        genre: '',
        notes: '',
        companyId: other,
        managementCompanyId: agency
      })
    ).id
    otherBand = (await bands.createBand({ name: 'Fremd', genre: '', notes: '', companyId: other }))
      .id

    agencyVenue = (
      await venues.createVenue({ name: 'Halle', kind: 'venue', notes: '', companyId: agency })
    ).id
    otherVenue = (
      await venues.createVenue({ name: 'Club', kind: 'venue', notes: '', companyId: other })
    ).id
  })

  it('lists bands the company owns or manages, by name', async () => {
    const list = await bands.listBandsByCompany(agency)
    expect(list.map((band) => band.id)).toEqual([managedBand, ownBand])
    expect(list.some((band) => band.id === otherBand)).toBe(false)
  })

  it('lists venues run by the company', async () => {
    const list = await venues.listVenuesByCompany(agency)
    expect(list.map((venue) => venue.id)).toEqual([agencyVenue])
    expect(list[0].company?.name).toBe('Agentur GmbH')
  })

  it('lists events where the company is LoPro or invoice company, newest first', async () => {
    const asLoPro = await events.createDealMemo({
      name: 'LoPro-Event',
      date: '2026-05-01',
      bandId: otherBand,
      venueId: otherVenue,
      loProCompanyId: agency
    })
    const asInvoiceCompany = await events.createDealMemo({
      name: 'Rechnungs-Event',
      date: '2026-06-01',
      bandId: otherBand,
      venueId: agencyVenue,
      invoiceCompanyId: agency
    })
    const unrelated = await events.createDealMemo({
      name: 'Fremdes Event',
      date: '2026-07-01',
      bandId: ownBand,
      venueId: otherVenue,
      loProCompanyId: other,
      invoiceCompanyId: other
    })

    const list = await events.listDealMemosByCompany(agency)
    expect(list.map((event) => event.id)).toEqual([asInvoiceCompany.id, asLoPro.id])
    expect(list.some((event) => event.id === unrelated.id)).toBe(false)
    expect(list[0].venue?.name).toBe('Halle')
  })

  it('lists events at a venue, newest first', async () => {
    const list = await events.listDealMemosByVenue(otherVenue)
    expect(list.map((event) => event.name)).toEqual(['Fremdes Event', 'LoPro-Event'])
  })

  it('lists invoices the company issued or received', async () => {
    const issued = await invoices.createInvoice({
      companyId: agency,
      recipientKind: 'company',
      recipientCompanyId: other,
      issueDate: '2026-03-01',
      lineItems
    })
    const received = await invoices.createInvoice({
      companyId: other,
      recipientKind: 'company',
      recipientCompanyId: agency,
      issueDate: '2026-04-01',
      lineItems
    })
    const unrelated = await invoices.createInvoice({
      companyId: other,
      recipientKind: 'company',
      recipientCompanyId: other,
      issueDate: '2026-05-01',
      lineItems
    })

    const list = await invoices.listInvoicesByCompany(agency)
    expect(list.map((invoice) => invoice.id)).toEqual([received.id, issued.id])
    expect(list.some((invoice) => invoice.id === unrelated.id)).toBe(false)
    expect(list[0].company?.name).toBe('Andere AG')
    expect(list[0].recipientSnapshot?.source_company_id).toBe(agency)
  })
})
