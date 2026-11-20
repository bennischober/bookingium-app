// A club entered twice - as a company (the promoter of its events) and as a venue - is linked
// from the venue page, so the venue shows the company's contacts and data
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { CompanyService } from '../src/main/services/CompanyService'
import { VenueService } from '../src/main/services/VenueService'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { setupTestDb } from './helpers/setup'

setupTestDb()

describe('venue company link', () => {
  const companies = container.resolve(CompanyService)
  const venues = container.resolve(VenueService)

  const event = async (venueId: number, loproCompanyId: number | null) => {
    const bandCompany = (await companies.createCompany({ name: 'Beispielband GbR' })).id
    const band = db
      .insert(schema.band)
      .values({ name: 'Beispielband', company_id: bandCompany })
      .returning({ id: schema.band.id })
      .get()
    db.insert(schema.deal_memo)
      .values({
        name: 'Beispielband',
        date: '2026-10-30',
        band_id: band.id,
        venue_id: venueId,
        lopro_company_id: loproCompanyId
      })
      .run()
  }

  it("suggests the club's own company (same name), never the promoter", async () => {
    const sameName = (await companies.createCompany({ name: 'Club Beispiel GmbH' })).id
    const promoter = (await companies.createCompany({ name: 'Beispiel Konzerte' })).id
    await companies.createCompany({ name: 'Ganz Andere AG' })
    const venue = await venues.createVenue({ name: 'Club Beispiel', kind: 'venue' })
    await event(venue.id, promoter)
    await event(venue.id, promoter)
    await event(venue.id, null)

    expect(venues.companySuggestions(venue.id)).toEqual([
      { id: sameName, name: 'Club Beispiel GmbH' }
    ])
    expect(venues.companySuggestions(venue.id).map((c) => c.id)).not.toContain(promoter)
  })

  it('links only the company and then suggests nothing', async () => {
    const company = (await companies.createCompany({ name: 'Halle Muster' })).id
    const venue = await venues.createVenue({
      name: 'Halle Muster',
      kind: 'venue',
      capacity: 900,
      notes: 'Ladezone hinten'
    })

    venues.linkCompany(venue.id, company)

    const linked = await venues.getVenueById(venue.id)
    expect(linked).toMatchObject({ company_id: company, capacity: 900, notes: 'Ladezone hinten' })
    expect(venues.companySuggestions(venue.id)).toEqual([])
    expect((await venues.listVenuesByCompany(company)).map((v) => v.id)).toContain(venue.id)
  })

  it('refuses a company or venue that does not exist', async () => {
    const venue = await venues.createVenue({ name: 'Nirgendwo', kind: 'venue' })
    expect(() => venues.linkCompany(venue.id, 999_999)).toThrow(/Firma nicht gefunden/)
    const company = (await companies.createCompany({ name: 'Irgendwer' })).id
    expect(() => venues.linkCompany(999_999, company)).toThrow(/nicht gefunden/)
  })
})
