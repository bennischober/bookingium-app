// #152: genre tags as rows. The API keeps the comma-separated form; these tests pin the
// helpers behind it: one spelling per genre, the entered order, pruning, search and sort.
import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import { container } from 'tsyringe'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { VenueService } from '../src/main/services/VenueService'
import { CompanyService } from '../src/main/services/CompanyService'
import { BandService } from '../src/main/services/BandService'
import { BandRepository } from '../src/main/repositories/BandRepository'
import { listGenres } from '../src/main/repositories/genres'
import { CreateVenueInput, UpdateVenueInput } from '../src/main/api/schemas/venue.schema'
import { getTestDb, setupTestDb } from './helpers/setup'

setupTestDb()

beforeEach(() => {
  getTestDb().sqlite.exec(
    'delete from band; delete from venue; delete from company; delete from genre;'
  )
})

const venues = () => container.resolve(VenueService)
const bands = () => container.resolve(BandService)

async function label() {
  return container
    .resolve(CompanyService)
    .createCompany({ name: 'Muster Label', isDefaultForInvoicing: false })
}

describe('genre tags', () => {
  it('keep the entered order and drop repeats and empty tags', async () => {
    const venue = await venues().createVenue(
      CreateVenueInput.parse({ name: 'Halle', genres: ' Rock;; Punk , rock ,Metal' })
    )
    expect(venue.genres).toBe('Rock, Punk, Metal')
    expect((await venues().getVenueById(venue.id))?.genres).toBe('Rock, Punk, Metal')
  })

  it('reuse a known genre whatever the case it is typed in', async () => {
    const company = await label()
    await bands().createBand({ name: 'Erste', genre: 'Hardcore', notes: '', companyId: company.id })
    const second = await bands().createBand({
      name: 'Zweite',
      genre: 'HARDCORE, Ska',
      notes: '',
      companyId: company.id
    })
    expect(second.genres).toBe('Hardcore, Ska')
    expect(listGenres()).toEqual(['Hardcore', 'Ska'])
  })

  it('delete a genre nobody uses any more, after an update or a delete', async () => {
    const company = await label()
    const band = await bands().createBand({
      name: 'Kurz',
      genre: 'Polka, Jazz',
      notes: '',
      companyId: company.id
    })
    await bands().updateBand({ id: band.id, genre: 'Jazz' })
    expect(listGenres()).toEqual(['Jazz'])

    const venue = await venues().createVenue(
      CreateVenueInput.parse({ name: 'Keller', genres: 'Jazz' })
    )
    await bands().deleteBand(band.id)
    expect(listGenres()).toEqual(['Jazz'])
    await venues().deleteVenue(venue.id)
    expect(listGenres()).toEqual([])
    expect(db.select().from(schema.venue_genre).all()).toEqual([])
  })

  it('stay as they are when an update leaves them out', async () => {
    const venue = await venues().createVenue(
      CreateVenueInput.parse({ name: 'Bühne', genres: 'Folk' })
    )
    const updated = await venues().updateVenue(
      UpdateVenueInput.parse({ id: venue.id, name: 'Bühne', notes: 'Neu' })
    )
    expect(updated.genres).toBe('Folk')
  })

  it('are searched and sorted in the band list', async () => {
    const company = await label()
    for (const [name, genre] of [
      ['Alpha', 'Techno'],
      ['Beta', 'Ambient, Techno'],
      ['Gamma', '']
    ]) {
      await bands().createBand({ name, genre, notes: '', companyId: company.id })
    }
    const repository = container.resolve(BandRepository)
    const found = await repository.getAllPaginated({ page: 1, pageSize: 50, search: 'techno' })
    expect(found.items.map((band) => [band.name, band.genres])).toEqual([
      ['Alpha', 'Techno'],
      ['Beta', 'Ambient, Techno']
    ])
    const sorted = await repository.getAllPaginated({
      page: 1,
      pageSize: 50,
      sortBy: 'genre',
      sortDir: 'asc'
    })
    // Empty values last, like every list column
    expect(sorted.items.map((band) => band.name)).toEqual(['Beta', 'Alpha', 'Gamma'])
  })
})
