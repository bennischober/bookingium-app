// Lists behind the person page: bands the person is technical lead of,
// companies naming them as invoice contact, events where they are LoPro
// contact or TL, invoices addressed to them and management contracts.
import 'reflect-metadata'
import { describe, it, expect, beforeAll } from 'vitest'
import { container } from 'tsyringe'
import { PersonService } from '../src/main/services/PersonService'
import { CompanyService } from '../src/main/services/CompanyService'
import { BandService } from '../src/main/services/BandService'
import { VenueService } from '../src/main/services/VenueService'
import { DealMemoService } from '../src/main/services/DealMemoService'
import { InvoiceService } from '../src/main/services/InvoiceService'
import { ManagementContractService } from '../src/main/services/ManagementContractService'
import { setupTestDb } from './helpers/setup'

setupTestDb()

const lineItems = [
  { description: 'Gage', quantity: 1, unitPriceNet: 100, taxRate: 0, taxCode: 'other' as const }
]

const address = {
  street: 'Musterweg',
  streetNumber: '1',
  addressSuffix: '',
  zipCode: '10115',
  city: 'Berlin',
  state: '',
  country: 'Deutschland',
  countryCode: 'DE'
}

describe('person page lists', () => {
  const persons = container.resolve(PersonService)
  const companies = container.resolve(CompanyService)
  const bands = container.resolve(BandService)
  const venues = container.resolve(VenueService)
  const events = container.resolve(DealMemoService)
  const invoices = container.resolve(InvoiceService)
  const contracts = container.resolve(ManagementContractService)

  let person: number
  let other: number
  let agency: number
  let leadBand: number
  let otherBand: number
  let venue: number

  beforeAll(async () => {
    person = (await persons.createPerson({ firstName: 'Paula', lastName: 'Person', address })).id
    other = (await persons.createPerson({ firstName: 'Otto', lastName: 'Other', address })).id

    agency = (
      await companies.createCompany({
        name: 'Agentur GmbH',
        isDefaultForInvoicing: true,
        invoiceContactPersonId: person,
        address
      })
    ).id
    await companies.createCompany({
      name: 'Andere AG',
      isDefaultForInvoicing: false,
      invoiceContactPersonId: other
    })

    leadBand = (
      await bands.createBand({
        name: 'Zebra',
        genre: '',
        notes: '',
        companyId: agency,
        responsiblePersonId: person
      })
    ).id
    otherBand = (
      await bands.createBand({
        name: 'Fremd',
        genre: '',
        notes: '',
        companyId: agency,
        responsiblePersonId: other
      })
    ).id
    venue = (
      await venues.createVenue({ name: 'Halle', kind: 'venue', notes: '', companyId: agency })
    ).id
  })

  it('lists bands the person is technical lead of', async () => {
    const list = await bands.listBandsByResponsiblePerson(person)
    expect(list.map((band) => band.id)).toEqual([leadBand])
  })

  it('lists companies naming the person as invoice contact', async () => {
    const list = await companies.listCompaniesByInvoiceContact(person)
    expect(list.map((company) => company.id)).toEqual([agency])
    expect(list[0].address?.city).toBe('Berlin')
  })

  it('lists events where the person is LoPro contact or TL of the band', async () => {
    const asLoPro = await events.createDealMemo({
      name: 'LoPro-Event',
      date: '2026-05-01',
      bandId: otherBand,
      venueId: venue,
      loProPersonId: person
    })
    const asLead = await events.createDealMemo({
      name: 'TL-Event',
      date: '2026-06-01',
      bandId: leadBand,
      venueId: venue
    })
    const unrelated = await events.createDealMemo({
      name: 'Fremdes Event',
      date: '2026-07-01',
      bandId: otherBand,
      venueId: venue,
      loProPersonId: other
    })

    const list = await events.listDealMemosByPerson(person)
    const ids = list.map((event) => event.id)
    expect(ids).toContain(asLoPro.id)
    expect(ids).toContain(asLead.id)
    expect(ids).not.toContain(unrelated.id)
  })

  it('lists invoices addressed to the person', async () => {
    const toPerson = await invoices.createInvoice({
      companyId: agency,
      recipientKind: 'person',
      recipientPersonId: person,
      issueDate: '2026-03-01',
      lineItems
    })
    const toOther = await invoices.createInvoice({
      companyId: agency,
      recipientKind: 'person',
      recipientPersonId: other,
      issueDate: '2026-03-02',
      lineItems
    })

    const list = await invoices.listInvoicesByRecipientPerson(person)
    expect(list.map((invoice) => invoice.id)).toEqual([toPerson.id])
    expect(list.some((invoice) => invoice.id === toOther.id)).toBe(false)
  })

  it('lists management contracts naming the person as member or representative', async () => {
    const asMember = await contracts.createForBand(leadBand)
    await contracts.update({
      id: asMember.id,
      memberPersonIds: [person, other],
      representativePersonId: other
    })
    const asRepresentative = await contracts.createForBand(otherBand)
    await contracts.update({
      id: asRepresentative.id,
      memberPersonIds: [person],
      representativePersonId: person
    })
    const unrelated = await contracts.createForBand(otherBand)
    await contracts.update({
      id: unrelated.id,
      memberPersonIds: [other],
      representativePersonId: other
    })

    const list = await contracts.listByPerson(person)
    expect(list.map((contract) => contract.id)).toEqual([asRepresentative.id, asMember.id])
  })
})
