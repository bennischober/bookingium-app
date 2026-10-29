// List export: a list with the grid's search/filter (all pages), typed
// cells (dates, numbers), and the CSV in the regional format.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { ExportService } from '../src/main/services/ExportService'
import { CompanyService } from '../src/main/services/CompanyService'
import { VenueService } from '../src/main/services/VenueService'
import { PersonRepository } from '../src/main/repositories/PersonRepository'
import { parseCsv } from '../src/main/csv/csv'

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

describe('CSV', () => {
  const table = {
    name: 'Rechnungen',
    columns: [
      { header: 'Nr.', kind: 'number' as const },
      { header: 'Datum', kind: 'date' as const },
      { header: 'Empfänger' },
      { header: 'Brutto', kind: 'money' as const }
    ],
    rows: [
      [12, new Date(Date.UTC(1985, 2, 12)), 'Club; Süd', 1234.5],
      [13, null, null, 1000000]
    ]
  }

  it('writes the German regional format: semicolons, dd.mm.yyyy, decimal comma', () => {
    const csv = service().csv(table, 'de-DE')
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Nr.;Datum;Empfänger;Brutto',
      '12;12.03.1985;"Club; Süd";"1234,50"',
      '13;;;"1000000,00"',
      ''
    ])
  })

  it('writes commas and decimal points for an English regional format', () => {
    const rows = parseCsv(service().csv(table, 'en-US'), ';')
    expect(rows[1]).toEqual(['12', '03/12/1985', 'Club; Süd', '1234.50'])
  })

  it('exports every list', async () => {
    const tables = await service().allTables()
    expect(tables.map((entry) => entry.name)).toEqual([
      'Bands',
      'Personen',
      'Firmen',
      'Spielstätten',
      'Hotels',
      'Events',
      'Rechnungen',
      'Banken'
    ])
    for (const entry of tables) {
      const [headers] = parseCsv(service().csv(entry, 'de-DE'), ',')
      expect(headers).toEqual(entry.columns.map((column) => column.header))
    }
  })
})
