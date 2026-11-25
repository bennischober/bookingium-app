// Marketing-Atlas import, second round: matching the address book (email, kind, several of a
// name), the file compared before the import (twice, changed, dropped, renamed), taking an
// import back, one status for several entries, and the CSV of the list. Fictitious data only.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { setupTestDb, getTestDb } from './helpers/setup'
import { findRenames, parseAtlasText, type Atlas } from '../src/main/marketing/atlasFormat'
import { atlasCsv } from '../src/main/marketing/atlasCsv'
import { MarketingRepository } from '../src/main/repositories/MarketingRepository'
import { CompanyService } from '../src/main/services/CompanyService'
import { BandService } from '../src/main/services/BandService'
import { CreateCompanyInput } from '../src/main/api/schemas/company.schema'
import type { MarketingItemDto } from '../src/main/api/schemas/marketing.schema'
import { schema } from '../src/main/db/schema'

setupTestDb()

const repo = () => container.resolve(MarketingRepository)
const db = () => getTestDb().db

const entry = (name: string, category: string, extra: object = {}) => ({
  name,
  category,
  priority: 'A',
  country: 'DE',
  reason: `${name} passt.`,
  ...extra
})
const atlasOf = (items: unknown[]): Atlas =>
  parseAtlasText(JSON.stringify({ meta: { stand: '1.1.2027' }, items }))
const options = { createContacts: true, contactLists: false }

let bands = 0
const newBand = async () => {
  const name = `Probeband ${++bands}`
  const owner = await container
    .resolve(CompanyService)
    .createCompany(CreateCompanyInput.parse({ name: `${name} GmbH` }))
  return container
    .resolve(BandService)
    .createBand({ name, companyId: owner.id, genre: '', notes: '' })
}
const company = (name: string, email?: string) =>
  container.resolve(CompanyService).createCompany(
    CreateCompanyInput.parse({
      name,
      kind: 'media',
      ...(email ? { contact: { email } } : {})
    })
  )
const venue = (name: string, kind: 'venue' | 'festival') =>
  db().insert(schema.venue).values({ name, kind }).returning({ id: schema.venue.id }).get().id

describe('matching the address book', () => {
  it('links by contact email before the name', async () => {
    const band = await newBand()
    const byMail = await company('Sender Nord GmbH', 'musik@sender-nord.example.test')
    const result = repo().importAtlas(
      band.id,
      atlasOf([
        entry('Radio Nordwelle', 'radios', {
          contact: { email: 'Musik@Sender-Nord.example.test' }
        })
      ]),
      'a.json',
      options
    )
    expect(result).toMatchObject({ companiesCreated: 0, linked: 1 })
    expect(repo().items(band.id)[0].company_id).toBe(byMail.id)
  })

  it('leaves an entry unlinked when several records carry the name, and offers them', async () => {
    const band = await newBand()
    const first = await company('Doppel FM')
    const second = await company('Doppel FM GmbH')
    const result = repo().importAtlas(
      band.id,
      atlasOf([entry('Doppel FM', 'radios')]),
      'a.json',
      options
    )
    expect(result).toMatchObject({ ambiguous: 1, companiesCreated: 0, linked: 0 })
    const rows = repo().items(band.id)
    expect(rows[0].company_id).toBeNull()
    const candidates = repo().candidatesOf(rows).get(rows[0].id)!
    expect(candidates.map((c) => c.id).sort()).toEqual([first.id, second.id].sort())

    expect(() => repo().linkContact(rows[0].id)).toThrow(/Mehrere Einträge/)
    repo().linkContact(rows[0].id, { companyId: second.id })
    expect(repo().items(band.id)[0].company_id).toBe(second.id)
  })

  it('a festival entry prefers the festival of that name over a club', async () => {
    const band = await newBand()
    venue('Seebühne', 'venue')
    const festival = venue('Seebühne', 'festival')
    repo().importAtlas(band.id, atlasOf([entry('Seebühne', 'festivals')]), 'a.json', options)
    expect(repo().items(band.id)[0].venue_id).toBe(festival)
  })

  it('creates one record when the file names it in two entries of a kind', async () => {
    const band = await newBand()
    const result = repo().importAtlas(
      band.id,
      atlasOf([entry('Einmal Radio', 'radios'), entry('Einmal Radio', 'podcasts')]),
      'a.json',
      options
    )
    expect(result.companiesCreated).toBe(1)
    const [a, b] = repo().items(band.id)
    expect(a.company_id).toBe(b.company_id)
  })
})

describe('the file before the import', () => {
  it('names entries standing twice, changed texts and what the file no longer lists', async () => {
    const band = await newBand()
    repo().importAtlas(
      band.id,
      atlasOf([entry('Bleibt FM', 'radios'), entry('Geht FM', 'radios')]),
      'a.json',
      options
    )
    const geht = repo()
      .items(band.id)
      .find((i) => i.name === 'Geht FM')!
    repo().update({ id: geht.id, status: 'contacted' })

    const compared = repo().compare(
      band.id,
      atlasOf([
        entry('Bleibt FM', 'radios', { reason: 'Neue Begründung.' }),
        entry('Neu FM', 'radios'),
        entry('Neu FM', 'radios')
      ])
    )
    expect(compared.duplicates).toEqual(['Neu FM'])
    expect(compared.entries.find((e) => e.name === 'Bleibt FM')).toMatchObject({
      changed: true,
      isNew: false
    })
    expect(compared.entries.find((e) => e.name === 'Neu FM')).toMatchObject({
      changed: false,
      isNew: true,
      renamedFrom: null
    })
    expect(compared.dropped).toEqual([
      { name: 'Geht FM', category: 'radios', status: 'contacted', picked: true }
    ])
  })

  it('finds a renamed entry and the import keeps its status and link', async () => {
    const band = await newBand()
    repo().importAtlas(band.id, atlasOf([entry('Welle Süd', 'radios')]), 'a.json', options)
    const old = repo().items(band.id)[0]
    repo().update({ id: old.id, status: 'talking', statusNote: 'Termin im März' })

    const next = atlasOf([entry('Welle Süd 98,4', 'radios')])
    const compared = repo().compare(band.id, next)
    expect(compared.entries[0]).toMatchObject({
      isNew: false,
      renamedFrom: { key: 'radios:welle süd', name: 'Welle Süd' }
    })
    expect(compared.dropped).toEqual([])

    const result = repo().importAtlas(band.id, next, 'b.json', {
      ...options,
      renames: { 'radios:welle süd 98 4': 'radios:welle süd' }
    })
    expect(result).toMatchObject({ created: 0, updated: 1, renamed: 1, dropped: 0 })
    const rows = repo().items(band.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: old.id,
      name: 'Welle Süd 98,4',
      item_key: 'radios:welle süd 98 4',
      status: 'talking',
      status_note: 'Termin im März',
      company_id: old.company_id
    })
  })

  it('pairs only one to one, and ignores a source link many entries share', () => {
    const shared = 'https://quelle.example.test/liste'
    const missing = [
      {
        ...atlasOf([entry('Alpha Radio', 'radios', { url: shared })]).items[0],
        key: 'radios:alpha radio'
      },
      {
        ...atlasOf([entry('Beta Radio', 'radios', { url: shared })]).items[0],
        key: 'radios:beta radio'
      }
    ]
    const added = atlasOf([
      entry('Gamma Radio', 'radios', { url: shared }),
      entry('Beta Radio Plus', 'radios'),
      entry('Alpha Radio', 'podcasts')
    ]).items
    expect([...findRenames(added, missing)]).toEqual([
      ['radios:beta radio plus', 'radios:beta radio']
    ])
  })
})

describe('taking an import back', () => {
  it('restores texts, status and the head data, and removes the entries it added', async () => {
    const band = await newBand()
    repo().importAtlas(band.id, atlasOf([entry('Erst FM', 'radios')]), 'a.json', options)
    const first = repo().items(band.id)[0]
    repo().update({ id: first.id, status: 'contacted' })
    expect(repo().undoInfo(band.id)).not.toBeNull()

    repo().importAtlas(
      band.id,
      parseAtlasText(
        JSON.stringify({
          meta: { stand: '2.2.2027' },
          items: [entry('Erst FM', 'radios', { priority: 'C' }), entry('Dazu FM', 'radios')]
        })
      ),
      'b.json',
      options
    )
    expect(repo().items(band.id)).toHaveLength(2)

    expect(repo().undoImport(band.id)).toEqual({ restored: 1, removed: 1 })
    const rows = repo().items(band.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: first.id, priority: 'A', status: 'contacted' })
    expect(repo().atlas(band.id)?.stand).toBe('1.1.2027')
    // once only
    expect(repo().undoInfo(band.id)).toBeNull()
    expect(() => repo().undoImport(band.id)).toThrow()
  })

  it('the first import taken back leaves no atlas', async () => {
    const band = await newBand()
    repo().importAtlas(band.id, atlasOf([entry('Nur FM', 'radios')]), 'a.json', options)
    repo().undoImport(band.id)
    expect(repo().items(band.id)).toEqual([])
    expect(repo().atlas(band.id)).toBeUndefined()
    expect(
      db()
        .select()
        .from(schema.marketing_import_undo)
        .where(eq(schema.marketing_import_undo.band_id, band.id))
        .all()
    ).toEqual([])
  })
})

describe('several entries at once', () => {
  it('sets one status for the band’s entries only, and puts them on the list', async () => {
    const band = await newBand()
    const other = await newBand()
    repo().importAtlas(
      band.id,
      atlasOf([entry('Eins FM', 'radios'), entry('Zwei FM', 'radios', { priority: 'C' })]),
      'a.json',
      options
    )
    repo().importAtlas(other.id, atlasOf([entry('Fremd FM', 'radios')]), 'a.json', options)
    const ids = [...repo().items(band.id), ...repo().items(other.id)].map((i) => i.id)
    expect(repo().updateMany(band.id, ids, 'contacted')).toBe(2)
    expect(
      repo()
        .items(band.id)
        .every((i) => i.status === 'contacted' && i.picked)
    ).toBe(true)
    expect(repo().items(other.id)[0].status).toBe('open')
  })
})

describe('the list as CSV', () => {
  it('writes labels, a German date and quotes where needed', () => {
    const item = {
      name: 'Probe; FM',
      category: 'radios',
      group: 'DACH',
      country: 'DE',
      type: 'Rockradio',
      priority: 'A',
      quality: 'b',
      status: 'contacted',
      statusDate: '2026-11-02',
      statusNote: 'Mail an die Redaktion',
      contactEmail: 'musik@probe.example.test',
      contactUrl: '',
      contactNote: '',
      companyName: 'Probe FM',
      venueName: null,
      reason: '',
      approach: '',
      timing: '',
      sourceUrl: ''
    } as unknown as MarketingItemDto
    const csv = atlasCsv([item], 'de-DE')
    const [head, row] = csv.slice(1).split('\r\n')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(head.split(';').slice(0, 3)).toEqual(['Name', 'Reiter', 'Gruppe'])
    expect(row).toContain('"Probe; FM";Radios;DACH;DE;Rockradio;A;belegt;Angefragt;02.11.2026')
    expect(row).toContain('musik@probe.example.test')
  })
})
