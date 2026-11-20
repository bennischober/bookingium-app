// A document belongs to its owner and can be linked to further records (document_link): the
// contract filed at the event is the promoter's, its contact's and the festival's too. Those
// records list it, together with the documents of their events.
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { DocumentLinkService } from '../src/main/services/DocumentLinkService'
import { setupTestDb } from './helpers/setup'

setupTestDb()

const links = () => container.resolve(DocumentLinkService)

let counter = 0
function world() {
  counter += 1
  const company = db
    .insert(schema.company)
    .values({ name: `Verknüpfung Veranstalter ${counter}` })
    .returning()
    .get()
  const bandCompany = db
    .insert(schema.company)
    .values({ name: `Verknüpfung Band GbR ${counter}` })
    .returning()
    .get()
  const band = db
    .insert(schema.band)
    .values({ name: `Verknüpfung Band ${counter}`, company_id: bandCompany.id })
    .returning()
    .get()
  const venue = db
    .insert(schema.venue)
    .values({ name: `Muster Open Air ${counter}`, kind: 'festival' })
    .returning()
    .get()
  const person = db
    .insert(schema.person)
    .values({ first_name: 'Erika', last_name: `Muster${counter}` })
    .returning()
    .get()
  const event = db
    .insert(schema.deal_memo)
    .values({
      name: `Verknüpfung Show ${counter}`,
      band_id: band.id,
      date: '2027-06-01',
      venue_id: venue.id,
      lopro_company_id: company.id
    })
    .returning()
    .get()
  const document = (ownerType: 'event' | 'company', ownerId: number, name: string) =>
    db
      .insert(schema.document)
      .values({
        owner_type: ownerType,
        owner_id: ownerId,
        file_name: name,
        file_type: 'pdf',
        file_path: `documents/test/${counter}-${name}`,
        document_type: 'contract',
        file_size: 10
      })
      .returning()
      .get()
  return { company, band, venue, person, event, document }
}

describe('document links', () => {
  it('links a document to further records, once each, and unlinks it', async () => {
    const w = world()
    const contract = w.document('event', w.event.id, 'Vertrag.pdf')
    await links().set({ documentId: contract.id, kind: 'person', id: w.person.id, linked: true })
    const after = await links().set({
      documentId: contract.id,
      kind: 'person',
      id: w.person.id,
      linked: true
    })
    expect(after).toEqual([
      { kind: 'person', id: w.person.id, name: `Erika Muster${counter}`, date: null }
    ])
    // its own owner is not linked a second time
    expect(
      await links().set({ documentId: contract.id, kind: 'event', id: w.event.id, linked: true })
    ).toHaveLength(1)
    expect(
      await links().set({ documentId: contract.id, kind: 'person', id: w.person.id, linked: false })
    ).toEqual([])
  })

  it('refuses a record that does not exist', async () => {
    const w = world()
    const contract = w.document('event', w.event.id, 'Vertrag.pdf')
    await expect(
      links().set({ documentId: contract.id, kind: 'company', id: 999999, linked: true })
    ).rejects.toThrow('Eintrag nicht gefunden')
  })

  it('lists linked documents and those of the record’s events, not its own', async () => {
    const w = world()
    const contract = w.document('event', w.event.id, 'Vertrag.pdf')
    const own = w.document('company', w.company.id, 'AGB.pdf')
    const elsewhere = w.document('event', w.event.id, 'Rider.pdf')
    links().linkAll(contract.id, [
      { kind: 'person', id: w.person.id },
      { kind: 'company', id: w.company.id }
    ])

    // the promoter: the linked contract, the rider of its event; its own AGB are left out
    const forCompany = links().related('company', w.company.id)
    expect(forCompany.map((d) => [d.fileName, d.via])).toEqual(
      expect.arrayContaining([
        ['Vertrag.pdf', 'linked'],
        ['Rider.pdf', 'event']
      ])
    )
    expect(forCompany.some((d) => d.id === own.id)).toBe(false)
    expect(forCompany.find((d) => d.id === contract.id)?.source).toMatchObject({
      kind: 'event',
      id: w.event.id,
      date: '2027-06-01'
    })

    // the festival sees both files of its event, the person only the linked contract
    expect(
      links()
        .related('venue', w.venue.id)
        .map((d) => d.id)
        .sort()
    ).toEqual([contract.id, elsewhere.id].sort())
    expect(
      links()
        .related('person', w.person.id)
        .map((d) => d.id)
    ).toEqual([contract.id])
  })

  it('goes when the document or the record goes', () => {
    const w = world()
    const contract = w.document('event', w.event.id, 'Vertrag.pdf')
    links().linkAll(contract.id, [{ kind: 'person', id: w.person.id }])
    db.delete(schema.person).where(eq(schema.person.id, w.person.id)).run()
    expect(links().list(contract.id)).toEqual([])

    links().linkAll(contract.id, [{ kind: 'company', id: w.company.id }])
    db.delete(schema.document).where(eq(schema.document.id, contract.id)).run()
    expect(
      db
        .select()
        .from(schema.document_link)
        .where(eq(schema.document_link.document_id, contract.id))
        .all()
    ).toEqual([])
  })

  it('finds records to link by name', () => {
    const w = world()
    const found = links().searchTargets(`Muster Open Air ${counter}`)
    expect(found).toContainEqual({
      kind: 'venue',
      id: w.venue.id,
      name: `Muster Open Air ${counter}`,
      date: null
    })
    expect(links().searchTargets(`erika muster${counter}`)).toContainEqual(
      expect.objectContaining({ kind: 'person', id: w.person.id })
    )
  })
})
