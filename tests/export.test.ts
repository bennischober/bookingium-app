// Excel export: a list with the grid's search/filter (all pages), typed
// cells (dates, numbers), and the all-lists workbook.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import ExcelJS from 'exceljs'
import { ExportService } from '../src/main/services/ExportService'
import { CompanyService } from '../src/main/services/CompanyService'
import { VenueService } from '../src/main/services/VenueService'
import { PersonRepository } from '../src/main/repositories/PersonRepository'

import { setupTestDb } from './helpers/setup'

setupTestDb()

const service = () => container.resolve(ExportService)

describe('list export', () => {
  it('exports every row matching the search and filter, not just one page', async () => {
    const venues = container.resolve(VenueService)
    const promoter = await container
      .resolve(CompanyService)
      .createCompany({ name: 'Rock Promotion GmbH', isDefaultForInvoicing: false })
    for (let i = 1; i <= 15; i++) {
      await venues.createVenue({
        name: `Club ${i}`,
        kind: i % 3 === 0 ? 'festival' : 'venue',
        capacity: i * 100,
        genres: i % 3 === 0 ? ' Rock;metal ' : '',
        notes: '',
        companyId: promoter.id,
        address: {
          street: '',
          streetNumber: '',
          addressSuffix: '',
          zipCode: '',
          city: 'Köln',
          state: '',
          country: 'Germany',
          countryCode: 'DE'
        }
      })
    }

    const all = await service().table({ list: 'venues' })
    expect(all.rows).toHaveLength(15)
    expect(all.columns.map((column) => column.header).slice(0, 5)).toEqual([
      'Spielstätte',
      'Art',
      'Kapazität',
      'Genres',
      'Veranstalter'
    ])

    const festivals = await service().table({ list: 'venues', kind: 'festival' })
    expect(festivals.rows.map((row) => row[0])).toEqual([
      'Club 12',
      'Club 15',
      'Club 3',
      'Club 6',
      'Club 9'
    ])
    expect(festivals.rows[0].slice(1, 5)).toEqual([
      'Festival',
      1200,
      'Rock, metal',
      'Rock Promotion GmbH'
    ])

    const searched = await service().table({ list: 'venues', search: 'Club 1' })
    expect(searched.rows).toHaveLength(7) // Club 1, 10–15
  })

  it('writes dates as dates and leaves empty values empty', async () => {
    await container
      .resolve(PersonRepository)
      .create({ firstName: 'Anna', lastName: 'Agentur', birthday: '1985-03-12', notes: null })
    const persons = await service().table({ list: 'persons', search: 'Anna' })
    expect(persons.rows[0].slice(0, 4)).toEqual([
      'Anna',
      'Agentur',
      new Date(Date.UTC(1985, 2, 12)),
      null
    ])
  })
})

describe('all lists', () => {
  it('builds one sheet per list with a bold, frozen header', async () => {
    const workbook = service().workbook(await service().allTables())
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Bands',
      'Personen',
      'Firmen',
      'Spielstätten',
      'Hotels',
      'Events',
      'Rechnungen',
      'Banken'
    ])
    const venues = workbook.getWorksheet('Spielstätten')!
    expect(venues.getRow(1).font?.bold).toBe(true)
    expect(venues.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(venues.rowCount).toBe(16)

    // Round trip through a real file
    const buffer = await workbook.xlsx.writeBuffer()
    const read = new ExcelJS.Workbook()
    await read.xlsx.load(buffer)
    expect(read.getWorksheet('Personen')!.getRow(2).getCell(3).value).toEqual(
      new Date(Date.UTC(1985, 2, 12))
    )
  })
})
