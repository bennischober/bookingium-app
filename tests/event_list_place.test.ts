// The event list says where a show is: the venue's city next to its name
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { container } from 'tsyringe'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { DealMemoService } from '../src/main/services/DealMemoService'
import { DealMemoMapper } from '../src/main/api/mappers/deal_memo.mapper'
import { setupTestDb } from './helpers/setup'

setupTestDb()

describe('event list place', () => {
  it('carries the venue city in the list and in the related lists', async () => {
    const company = db.insert(schema.company).values({ name: 'Ort Firma' }).returning().get()
    const band = db
      .insert(schema.band)
      .values({ name: 'Ort Band', company_id: company.id })
      .returning()
      .get()
    const address = db.insert(schema.address).values({ city: 'Leipzig' }).returning().get()
    const venue = db
      .insert(schema.venue)
      .values({ name: 'Ort Club', address_id: address.id })
      .returning()
      .get()
    const bare = db.insert(schema.venue).values({ name: 'Ort ohne Adresse' }).returning().get()
    for (const [name, venueId] of [
      ['Mit Ort', venue.id],
      ['Ohne Adresse', bare.id],
      ['Ohne Club', null]
    ] as const) {
      db.insert(schema.deal_memo)
        .values({ name, band_id: band.id, venue_id: venueId, date: '2027-02-01' })
        .run()
    }

    const service = container.resolve(DealMemoService)
    const page = await service.getAllDealMemosPaginated({ page: 1, pageSize: 50, search: 'Ohne' })
    const all = await service.getAllDealMemosPaginated({ page: 1, pageSize: 50, search: 'Mit Ort' })
    const place = (rows: Parameters<typeof DealMemoMapper.toListItemDtoList>[0]) =>
      DealMemoMapper.toListItemDtoList(rows).map((row) => [row.name, row.venueName, row.venueCity])

    expect(place(all.items)).toEqual([['Mit Ort', 'Ort Club', 'Leipzig']])
    expect(place(page.items).sort()).toEqual([
      ['Ohne Adresse', 'Ort ohne Adresse', null],
      ['Ohne Club', null, null]
    ])
    expect(place(await service.listDealMemosByBand(band.id))).toContainEqual([
      'Mit Ort',
      'Ort Club',
      'Leipzig'
    ])
  })
})
