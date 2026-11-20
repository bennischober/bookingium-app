// Show-Ordner end to end: a folder with a day sheet, an info sheet, venue specs, a promoter mail
// and a scan is read for an event; the ticked suggestions land in the itinerary, the club, the
// hotel and the contacts, the files among the documents. Reading it again offers nothing twice.
// All names and addresses are invented.
import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { ShowFolderService } from '../src/main/services/ShowFolderService'
import { CompanyService } from '../src/main/services/CompanyService'
import { VenueService } from '../src/main/services/VenueService'
import { setStorageBasePath } from '../src/main/utils/fileStorage'
import { setupTestDb } from './helpers/setup'

setupTestDb()

let root: string
let folder: string

const daysheet = `Date: 14.11.2026
Venue: Halle Nord ( new adress!! )
Town: 12345 Musterstadt
Street: Hafenweg 11
Get In Beispielband:   13:00
Soundcheck Beispielband:   15:30 - 17:00
Soundcheck Vorband Eins   17:00 - 18:00
Doors:   19:00
Show   Vorband Eins   20:00 - 20:45
Show Beispielband   21:15 - 22:45
Backstage Curfew   00:30
CONTACTS:
Venue:   Erika Muster   +49 151 000 0001   erika.muster@halle-nord.example
Tourmanager BB:   Max Beispiel   +49 170 000 0002   max@band.example
`

const infosheet = `Load In:   13:30   |   TM: Max
Hotel: Hotel am Deich
Straße: Deichstraße 77
Stadt: 54321 Nebenort
Gebuchte Zimmer:   7 EZ. 2 DZ (ohne Frühstück)
`

const venueSpec = `NAME   Halle Nord
ADDRESS   Hafenweg 11
ZIP CODE / CITY   12345   Musterstadt
CAPACITY   standing capacity   9 00
MERCHANDISE FEE   75,00 € incl. VAT
`

const mail = [
  'From: Paul Promo <paul.promo@promoter.example>',
  'To: Agentur <info@agentur.example>',
  'Subject: AW: Beispielband 2026',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Zeiten passen so.',
  '',
  'Paul Promo | Local Promoter',
  'ph: +49.40.0000.852',
  '',
  'Grundpreis',
  '30,00 €',
  'Endpreis',
  '38,70 €',
  ''
].join('\r\n')

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'bookingium-showfolder-'))
  folder = join(root, 'Show 14.11. Musterstadt')
  mkdirSync(join(folder, 'Technik'), { recursive: true })
  writeFileSync(join(folder, 'Daysheet Show.txt'), daysheet)
  writeFileSync(join(folder, 'Infosheet Show.txt'), infosheet)
  writeFileSync(join(folder, 'Technik', 'Venue Specifications 2026.txt'), venueSpec)
  writeFileSync(join(folder, 'AW Beispielband.eml'), mail)
  writeFileSync(join(folder, 'scan0001.pdf'), 'not a real pdf')
  writeFileSync(join(folder, '.DS_Store'), 'hidden')
  setStorageBasePath(join(root, 'storage'))
})

afterAll(() => {
  setStorageBasePath(null)
  rmSync(root, { recursive: true, force: true })
})

async function setup() {
  const companies = container.resolve(CompanyService)
  const bandCompany = await companies.createCompany({ name: 'Beispielband GbR' })
  const band = db
    .insert(schema.band)
    .values({ name: 'Beispielband', company_id: bandCompany.id })
    .returning({ id: schema.band.id })
    .get()
  const venue = await container.resolve(VenueService).createVenue({
    name: 'Halle Nord',
    kind: 'venue',
    address: {
      street: 'Kaiweg',
      streetNumber: '1',
      addressSuffix: '',
      zipCode: '12345',
      city: 'Musterstadt',
      state: '',
      country: '',
      countryCode: ''
    }
  })
  const event = db
    .insert(schema.deal_memo)
    .values({
      name: 'Beispielband – Halle Nord',
      date: '2026-11-14',
      band_id: band.id,
      venue_id: venue.id
    })
    .returning({ id: schema.deal_memo.id })
    .get()
  return { eventId: event.id, venueId: venue.id }
}

describe('show folder service', () => {
  const service = container.resolve(ShowFolderService)

  it('reads a folder, applies the ticked suggestions and offers nothing twice', async () => {
    const { eventId, venueId } = await setup()
    const plan = await service.analyze({ eventId, paths: [folder] })

    // files: the subfolder is read, hidden files are skipped, the venue sheet goes to the club
    expect(plan.files.map((f) => [f.name, f.kind, f.owner])).toEqual(
      expect.arrayContaining([
        ['Daysheet Show.txt', 'daysheet', 'event'],
        ['Venue Specifications 2026.txt', 'venue_spec', 'venue'],
        ['AW Beispielband.eml', 'mail', 'event'],
        ['scan0001.pdf', 'other', 'event']
      ])
    )
    expect(plan.files.some((f) => f.name === '.DS_Store')).toBe(false)
    expect(plan.hints.some((hint) => /keinen lesbaren Text/.test(hint))).toBe(true)

    const byId = new Map(plan.suggestions.map((s) => [s.id, s]))
    expect(byId.get('itinerary.getIn')).toMatchObject({ proposed: '13:00', include: true })
    expect(byId.get('itinerary.showTimeSupport')?.proposed).toBe('20:00')
    expect(byId.get('itinerary.curfewVenue')?.proposed).toBe('00:30')
    expect(byId.get('venue.capacity')).toMatchObject({ proposed: '900', include: true })
    // the stored address differs: offered, but not ticked
    expect(byId.get('venue.address')).toMatchObject({
      current: 'Kaiweg 1, 12345 Musterstadt',
      proposed: 'Hafenweg 11, 12345 Musterstadt',
      include: false
    })
    expect(byId.get('event.presale')?.proposed).toMatch(/^38,70 €/)
    expect(byId.get('hotel')).toMatchObject({ include: true, label: 'Hotel anlegen und zuordnen' })
    // the club's person on the day and the promoter; the band's tour manager is left out
    const people = plan.suggestions.filter((s) => s.group === 'Kontakte')
    expect(people.map((s) => s.label).sort()).toEqual(['Erika Muster', 'Paul Promo'])

    const result = await service.apply({
      eventId,
      files: plan.files
        .filter((f) => f.include && f.owner !== 'none')
        .map((f) => ({
          path: f.path,
          owner: f.owner as 'event' | 'venue',
          documentType: f.documentType
        })),
      actions: plan.suggestions.map((s) => s.action)
    })
    expect(result.problems).toEqual([])

    const itinerary = db
      .select()
      .from(schema.itinerary)
      .where(eq(schema.itinerary.deal_memo_id, eventId))
      .get()
    expect(itinerary).toMatchObject({
      get_in: '13:00',
      load_in: '13:30',
      show_time_main_act: '21:15',
      show_length: '90'
    })
    const event = db.select().from(schema.deal_memo).where(eq(schema.deal_memo.id, eventId)).get()!
    expect(event.ticket_price_vvk_cents).toBe(3870)
    const venue = db.select().from(schema.venue).where(eq(schema.venue.id, venueId)).get()!
    expect(venue.capacity).toBe(900)
    expect(venue.notes).toContain('Merch-Fee: 75,00 €')
    const address = db
      .select()
      .from(schema.address)
      .where(eq(schema.address.id, venue.address_id!))
      .get()
    expect(address).toMatchObject({ street: 'Hafenweg', street_number: '11' })
    const hotel = db.select().from(schema.hotel).where(eq(schema.hotel.id, event.hotel_id!)).get()
    expect(hotel?.name).toBe('Hotel am Deich')

    const advancing = db
      .select()
      .from(schema.event_advancing)
      .where(eq(schema.event_advancing.deal_memo_id, eventId))
      .get()
    const local = db
      .select()
      .from(schema.person)
      .where(eq(schema.person.id, advancing!.local_contact_id!))
      .get()
    expect(local).toMatchObject({ first_name: 'Erika', last_name: 'Muster' })
    const members = db
      .select()
      .from(schema.venue_member)
      .where(eq(schema.venue_member.venue_id, venueId))
      .all()
    expect(members.map((m) => m.person_id)).toContain(local!.id)
    const lopro = db
      .select()
      .from(schema.person)
      .where(eq(schema.person.id, event.lopro_person_id!))
      .get()
    expect(lopro).toMatchObject({ first_name: 'Paul', last_name: 'Promo' })

    expect(result.documents).toBe(5)
    const venueDocs = db
      .select()
      .from(schema.document)
      .where(eq(schema.document.owner_type, 'venue'))
      .all()
      .filter((d) => d.owner_id === venueId)
    expect(venueDocs.map((d) => d.file_name)).toEqual(['Venue Specifications 2026.txt'])

    // read again: everything is stored, so only the files show up, unticked
    const again = await service.analyze({ eventId, paths: [folder] })
    expect(again.suggestions).toEqual([])
    expect(again.files.every((f) => !f.include)).toBe(true)
  })

  it('offers nothing for the club when the event has none, and says why', async () => {
    const { eventId } = await setup()
    db.update(schema.deal_memo)
      .set({ venue_id: null })
      .where(eq(schema.deal_memo.id, eventId))
      .run()
    const plan = await service.analyze({ eventId, paths: [folder] })
    expect(plan.suggestions.some((s) => s.group === 'Club')).toBe(false)
    expect(plan.hints.some((hint) => /keinen Club/.test(hint))).toBe(true)
    expect(plan.files.find((f) => f.kind === 'venue_spec')?.owner).toBe('event')
  })
})
