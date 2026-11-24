// Marketing-Atlas: reading atlas files, importing them into a band, keeping the team's status
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { setupTestDb, getTestDb } from './helpers/setup'
import {
  ATLAS_FORMAT,
  balancedJson,
  itemKey,
  normalizeItem,
  parseAtlasText,
  type Atlas
} from '../src/main/marketing/atlasFormat'
import { MarketingRepository } from '../src/main/repositories/MarketingRepository'
import { CompanyService } from '../src/main/services/CompanyService'
import { BandService } from '../src/main/services/BandService'
import { CreateCompanyInput } from '../src/main/api/schemas/company.schema'
import { schema } from '../src/main/db/schema'

setupTestDb()

const item = (n: string, tab: string, prio = 'A', extra: object = {}) => ({
  n,
  land: 'DE',
  typ: 'Rockradio',
  prio,
  why: 'Spielt ähnliche Bands.',
  weg: 'Über die Musikredaktion.',
  zeit: 'zur Tour',
  q: 'b',
  url: 'https://beispiel.example.test/playlist',
  tab,
  grp: 'DACH',
  ...extra
})

describe('atlas files', () => {
  it('reads an atlas page that carries its data as JSON in DATA=', () => {
    const data = {
      meta: { stand: '18.11.2026', lauf: 7, lead: 'Hard Rock.' },
      tabs: [
        { id: 'uebersicht', label: 'Übersicht' },
        { id: 'radios', label: 'Radios', lead: 'Rockradio.' }
      ],
      items: [item('Beispiel Rock FM', 'radios'), item('Weg ohne Tab', 'unbekannt')],
      facts: [['Band', 'Hard Rock aus Musterstadt.']],
      runs: [{ lauf: 1, datum: '16.11.2026', text: 'Erster Lauf.' }],
      excluded: [{ n: 'Abgelehnt FM', tab: 'Radios', grund: 'Kein Fit; "Metal" only.' }]
    }
    const html = `<html><script>const X=1;\nconst DATA=${JSON.stringify(data)};\nrender()</script></html>`
    const atlas = parseAtlasText(html)
    expect(atlas).toMatchObject({ stand: '18.11.2026', run: 7, lead: 'Hard Rock.' })
    expect(atlas.items).toHaveLength(1)
    expect(atlas.items[0]).toMatchObject({
      name: 'Beispiel Rock FM',
      category: 'radios',
      priority: 'A',
      quality: 'b'
    })
    expect(atlas.tabs).toEqual([{ id: 'radios', label: 'Radios', lead: 'Rockradio.' }])
    expect(atlas.excluded[0]).toMatchObject({
      name: 'Abgelehnt FM',
      reason: 'Kein Fit; "Metal" only.'
    })
  })

  it('reads a bare item array and Bookingium’s own format with contacts', () => {
    expect(parseAtlasText(JSON.stringify([item('Liste FM', 'radios')])).items).toHaveLength(1)
    const own = {
      format: ATLAS_FORMAT,
      version: 1,
      band: 'Beispielband',
      stand: '13.11.2026',
      items: [
        {
          name: 'Beispiel Festival',
          category: 'festivals',
          priority: 'B',
          contact: {
            email: 'booking@festival.example.test',
            url: 'https://festival.example.test',
            note: 'Nur Links.'
          },
          activeNote: 'Presenter der Tour'
        }
      ]
    }
    const atlas = parseAtlasText(JSON.stringify(own))
    expect(atlas.band).toBe('Beispielband')
    expect(atlas.items[0].contact.email).toBe('booking@festival.example.test')
    expect(atlas.items[0].activeNote).toBe('Presenter der Tour')
  })

  it('keeps only web links and maps the tab aliases', () => {
    expect(normalizeItem(item('X', 'mehr', 'A', { url: 'javascript:alert(1)' }))).toMatchObject({
      category: 'kanaele',
      url: ''
    })
    expect(normalizeItem(item('Y', 'Presse und Blogs'))?.category).toBe('presse')
    expect(itemKey({ category: 'radios', name: 'Beispiel Rock-FM!' })).toBe(
      'radios:beispiel rock fm'
    )
  })

  it('finds the end of the JSON despite brackets in strings', () => {
    const text = 'x={"a":"]}","b":[1,{"c":"\\"}"}]};rest'
    expect(balancedJson(text, 2)).toBe('{"a":"]}","b":[1,{"c":"\\"}"}]}')
  })

  it('refuses a file without an atlas', () => {
    expect(() => parseAtlasText('<html><body>nichts</body></html>')).toThrow(/kein lesbarer/)
    expect(() => parseAtlasText('{"items":[]}')).toThrow(/keine Einträge/)
  })
})

describe('importing an atlas', () => {
  const repo = () => container.resolve(MarketingRepository)
  const db = () => getTestDb().db
  const newBand = async (name: string) => {
    const owner = await container
      .resolve(CompanyService)
      .createCompany(CreateCompanyInput.parse({ name: `${name} GmbH` }))
    return container
      .resolve(BandService)
      .createBand({ name, companyId: owner.id, genre: '', notes: '' })
  }
  const atlasOf = (items: unknown[]): Atlas =>
    parseAtlasText(JSON.stringify({ meta: { stand: '1.1.2027' }, items }))

  it('creates contacts for the picked entries, links an existing one, and leaves the pool alone', async () => {
    const band = await newBand('Atlasband')
    const existing = await container
      .resolve(CompanyService)
      .createCompany(CreateCompanyInput.parse({ name: 'Vorhanden Radio GmbH', kind: 'media' }))
    const result = repo().importAtlas(
      band.id,
      atlasOf([
        item('Neues Radio', 'radios', 'A'),
        item('Vorhanden Radio', 'radios', 'B'),
        item('Kleines Radio', 'radios', 'C'),
        item('Atlas Festival', 'festivals', 'A', {
          contact: { email: 'Booking@Festival.example.test' }
        }),
        item('Beispielfall', 'inspiration', 'A')
      ]),
      'atlas.json',
      {
        picked: ['radios:neues radio', 'radios:vorhanden radio', 'festivals:atlas festival'],
        createContacts: true,
        contactLists: true
      }
    )
    expect(result).toMatchObject({
      created: 5,
      picked: 3,
      companiesCreated: 1,
      venuesCreated: 1,
      linked: 3,
      lists: 2
    })
    const items = repo().items(band.id)
    const by = (name: string) => items.find((i) => i.name === name)!
    expect(by('Vorhanden Radio').company_id).toBe(existing.id)
    expect(by('Kleines Radio').company_id).toBeNull()
    expect(by('Beispielfall').company_id).toBeNull()
    const festival = db()
      .select()
      .from(schema.venue)
      .where(eq(schema.venue.id, by('Atlas Festival').venue_id!))
      .get()!
    expect(festival.kind).toBe('festival')
    const contact = db()
      .select()
      .from(schema.contact)
      .where(eq(schema.contact.id, festival.contact_id!))
      .get()!
    expect(contact.email).toBe('booking@festival.example.test')
    const created = db()
      .select()
      .from(schema.company)
      .where(eq(schema.company.name, 'Neues Radio'))
      .get()!
    expect(created.kind).toBe('media')
    expect(created.notes).toContain('Marketing-Atlas Atlasband')
    expect(repo().linksOf({ companyId: existing.id })).toMatchObject([
      { bandName: 'Atlasband', status: 'open' }
    ])
  })

  it('a newer atlas updates texts, keeps the status and marks dropped entries', async () => {
    const band = await newBand('Updateband')
    repo().importAtlas(
      band.id,
      atlasOf([item('Bleibt FM', 'radios'), item('Geht FM', 'radios')]),
      'a.json',
      { createContacts: false, contactLists: false }
    )
    const first = repo()
      .items(band.id)
      .find((i) => i.name === 'Bleibt FM')!
    repo().update({ id: first.id, status: 'contacted', statusNote: 'Mail am 2.1.' })

    const result = repo().importAtlas(
      band.id,
      atlasOf([item('Bleibt FM', 'radios', 'B', { why: 'Neue Begründung.' })]),
      'b.json',
      { createContacts: false, contactLists: false }
    )
    expect(result).toMatchObject({ created: 0, updated: 1, dropped: 1 })
    const items = repo().items(band.id)
    expect(items.find((i) => i.name === 'Bleibt FM')).toMatchObject({
      status: 'contacted',
      status_note: 'Mail am 2.1.',
      priority: 'B',
      reason: 'Neue Begründung.',
      in_atlas: true
    })
    expect(items.find((i) => i.name === 'Geht FM')?.in_atlas).toBe(false)
  })

  it('suggests A, what is on the list and what was worked on; marks new entries', async () => {
    const band = await newBand('Vorschlagband')
    const first = atlasOf([
      item('A FM', 'radios', 'A'),
      item('B FM', 'radios', 'B'),
      item('C FM', 'radios', 'C'),
      item('Partner FM', 'radios', 'C', { aktiv: 'Album der Woche' })
    ])
    expect(
      repo()
        .preview(band.id, first)
        .map((e) => [e.name, e.picked, e.isNew])
    ).toEqual([
      ['A FM', true, false],
      ['B FM', false, false],
      ['C FM', false, false],
      ['Partner FM', true, false]
    ])
    // without explicit keys the import takes the suggestion
    expect(
      repo().importAtlas(band.id, first, 'a.json', { createContacts: false, contactLists: false })
    ).toMatchObject({ created: 4, picked: 2 })
    const c = repo()
      .items(band.id)
      .find((i) => i.name === 'C FM')!
    repo().update({ id: c.id, status: 'contacted' })
    expect(
      repo()
        .items(band.id)
        .find((i) => i.name === 'C FM')?.picked
    ).toBe(true)

    const next = atlasOf([
      item('A FM', 'radios', 'A'),
      item('B FM', 'radios', 'B'),
      item('C FM', 'radios', 'C'),
      item('Neu FM', 'radios', 'B')
    ])
    expect(
      repo()
        .preview(band.id, next)
        .map((e) => [e.name, e.picked, e.isNew])
    ).toEqual([
      ['A FM', true, false],
      ['B FM', false, false],
      ['C FM', true, false],
      ['Neu FM', false, true]
    ])
  })

  it('moves entries between list and pool, contacts only for picked ones', async () => {
    const band = await newBand('Poolband')
    repo().importAtlas(
      band.id,
      atlasOf([item('Pool Radio', 'radios', 'B'), item('Listen Radio', 'radios', 'A')]),
      'a.json',
      { picked: ['radios:listen radio'], createContacts: false, contactLists: false }
    )
    const by = (name: string) =>
      repo()
        .items(band.id)
        .find((i) => i.name === name)!
    expect(by('Pool Radio')).toMatchObject({ picked: false, company_id: null })

    expect(repo().setPicked(band.id, [by('Pool Radio').id], true, true)).toEqual({
      changed: 1,
      contactsCreated: 1
    })
    expect(by('Pool Radio').picked).toBe(true)
    expect(by('Pool Radio').company_id).not.toBeNull()
    // the company page names only entries on a list
    const companyId = by('Pool Radio').company_id!
    expect(repo().linksOf({ companyId })).toHaveLength(1)

    expect(repo().setPicked(band.id, [by('Pool Radio').id], false, false)).toEqual({
      changed: 1,
      contactsCreated: 0
    })
    expect(by('Pool Radio')).toMatchObject({ picked: false, company_id: companyId })
    expect(repo().linksOf({ companyId })).toHaveLength(0)
    // another band's ids are left alone
    const other = await newBand('Fremdband')
    expect(repo().setPicked(other.id, [by('Listen Radio').id], false, false).changed).toBe(0)
  })

  it('an existing relationship the atlas names starts as "Läuft schon"', async () => {
    const band = await newBand('Aktivband')
    repo().importAtlas(
      band.id,
      atlasOf([item('Partner FM', 'radios', 'A', { aktiv: 'Album der Woche' })]),
      'a.json',
      { createContacts: false, contactLists: false }
    )
    expect(repo().items(band.id)[0]).toMatchObject({
      status: 'active',
      active_note: 'Album der Woche'
    })
  })
})
