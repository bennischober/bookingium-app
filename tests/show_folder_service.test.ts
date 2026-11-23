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
import { DocumentService } from '../src/main/services/DocumentService'
import { DocumentLinkService } from '../src/main/services/DocumentLinkService'
import { setStorageBasePath } from '../src/main/utils/fileStorage'
import { setupTestDb } from './helpers/setup'

setupTestDb()

let root: string
let folder: string

const daysheet = `Date: 14.11.2026
Venue: Halle Nord ( new adress!! )
Town: 12345 Musterstadt
Street: Musterweg 11
Get In Beispielband:   13:00
Soundcheck Beispielband:   15:30 - 17:00
Soundcheck Vorband Eins   17:00 - 18:00
Doors:   19:00
Show   Vorband Eins   20:00 - 20:45
Show Beispielband   21:15 - 22:45
Backstage Curfew   00:30
CONTACTS:
Venue:   Erika Muster   +49 151 000 0001   erika.muster@halle-nord.example.test
Tourmanager BB:   Max Beispiel   +49 170 000 0002   max@band.example.test
`

const infosheet = `Load In:   13:30   |   TM: Max
Hotel: Hotel am Deich
Straße: Beispielstraße 77
Stadt: 54321 Nebenort
Gebuchte Zimmer:   7 EZ. 2 DZ (ohne Frühstück)
`

const venueSpec = `NAME   Halle Nord
ADDRESS   Musterweg 11
ZIP CODE / CITY   12345   Musterstadt
CAPACITY   standing capacity   9 00
MERCHANDISE FEE   75,00 € incl. VAT
`

const festivalSheet = `Festival: Muster Open Air
Festivalgelände: Am Beispielsee 3
Ort: 12345 Musterstadt
Kapazität: 15.000
Wristbands und Akkreditierung am Artist Village, Camping für Crew, Shuttle vom Hotel.
CONTACTS:
Artist Care:   Anna Beispiel   +49 151 000 0003   anna@festival.example.test
`

const contract = `GASTSPIELVERTRAG
zwischen
Muster Konzerte GmbH
Musterweg 11
12345 Musterstadt
vertreten durch den Geschäftsführer Max Promo
Tel.: +49 40 000 0001
E-Mail: max@muster-konzerte.example.test
USt-IdNr.: DE123456789
– nachfolgend „Veranstalter“ genannt –
und
Beispiel Booking
– nachfolgend „Agentur“ genannt –
§ 1 Die Agentur stellt die Künstler Beispielband.
Garantie: 1.500,00 € netto
`

const mail = [
  'From: Paul Promo <paul.promo@promoter.example.test>',
  'To: Agentur <info@agentur.example.test>',
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
      street: 'Musterallee',
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

// The first analyze loads pdf.js and mailparser; on the Windows runner that alone took ~18 s
describe('show folder service', { timeout: 60_000 }, () => {
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
      current: 'Musterallee 1, 12345 Musterstadt',
      proposed: 'Musterweg 11, 12345 Musterstadt, Deutschland',
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
    expect(address).toMatchObject({ street: 'Musterweg', street_number: '11' })
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

  it('offers the club the files name to an event without one, and files to it', async () => {
    const { eventId } = await setup()
    db.update(schema.deal_memo)
      .set({ venue_id: null })
      .where(eq(schema.deal_memo.id, eventId))
      .run()
    const plan = await service.analyze({ eventId, paths: [folder] })
    const assign = plan.suggestions.find((s) => s.id === 'venue.assign')
    expect(assign).toMatchObject({ group: 'Club', include: true })
    expect(assign?.label).toMatch(/schon angelegt/)
    expect(plan.venueName).toBe('Halle Nord')
    expect(plan.venueKind).toBe('venue')
    expect(plan.files.find((f) => f.kind === 'venue_spec')?.owner).toBe('venue')
    const erika = plan.suggestions.find((s) => s.id.includes('erika'))
    expect(erika?.proposed).toMatch(/Ansprechpartner von Halle Nord/)

    const result = await service.apply({
      eventId,
      files: plan.files
        .filter((f) => f.kind === 'venue_spec')
        .map((f) => ({ path: f.path, owner: 'venue' as const, documentType: f.documentType })),
      actions: [assign!.action, erika!.action]
    })
    expect(result.problems).toEqual([])
    const event = db.select().from(schema.deal_memo).where(eq(schema.deal_memo.id, eventId)).get()
    // the first stored club of that name
    const first = db.select().from(schema.venue).where(eq(schema.venue.name, 'Halle Nord')).get()
    expect(event?.venue_id).toBe(first?.id)
    const members = db
      .select()
      .from(schema.venue_member)
      .where(eq(schema.venue_member.venue_id, first!.id))
      .all()
    expect(members.length).toBeGreaterThan(0)
  })

  it('says why when the event has no club and the files name none', async () => {
    const { eventId } = await setup()
    db.update(schema.deal_memo)
      .set({ venue_id: null })
      .where(eq(schema.deal_memo.id, eventId))
      .run()
    const plan = await service.analyze({
      eventId,
      paths: [join(folder, 'Infosheet Show.txt')]
    })
    expect(plan.suggestions.some((s) => s.group === 'Club' || s.group === 'Festival')).toBe(false)
    expect(plan.hints.some((hint) => /keinen Club und kein Festival/.test(hint))).toBe(true)
  })

  it('creates a festival the files describe, with its data', async () => {
    const { eventId } = await setup()
    db.update(schema.deal_memo)
      .set({ venue_id: null })
      .where(eq(schema.deal_memo.id, eventId))
      .run()
    const path = join(root, 'Artist Info Muster Open Air.txt')
    writeFileSync(path, festivalSheet)
    const plan = await service.analyze({ eventId, paths: [path] })
    expect(plan.files[0]).toMatchObject({ kind: 'venue_spec', owner: 'venue' })
    const assign = plan.suggestions.find((s) => s.id === 'venue.assign')
    expect(assign).toMatchObject({ group: 'Festival' })
    expect(assign?.label).toBe('Festival Muster Open Air anlegen und zuordnen')
    expect(plan.venueKind).toBe('festival')
    // the artist care person is the festival's
    expect(plan.suggestions.some((s) => s.id.includes('anna'))).toBe(true)

    await service.apply({ eventId, files: [], actions: [assign!.action] })
    const event = db.select().from(schema.deal_memo).where(eq(schema.deal_memo.id, eventId)).get()
    const festival = db
      .select()
      .from(schema.venue)
      .where(eq(schema.venue.id, event!.venue_id!))
      .get()
    expect(festival).toMatchObject({ name: 'Muster Open Air', kind: 'festival' })
  })

  it('offers to make the stored club a festival when the files describe one', async () => {
    const { eventId, venueId } = await setup()
    const path = join(root, 'Festival Guide.txt')
    writeFileSync(path, festivalSheet.replace('Festival: Muster Open Air', 'Festival: Halle Nord'))
    const plan = await service.analyze({ eventId, paths: [path] })
    const kind = plan.suggestions.find((s) => s.id === 'venue.kind')
    expect(kind).toMatchObject({ group: 'Festival', current: 'Club', proposed: 'Festival' })
    expect(kind?.include).toBe(false)
    expect(plan.hints.some((hint) => /beschreiben ein Festival/.test(hint))).toBe(true)

    await service.apply({ eventId, files: [], actions: [kind!.action] })
    const venue = db.select().from(schema.venue).where(eq(schema.venue.id, venueId)).get()
    expect(venue?.kind).toBe('festival')
  })

  it('reads a filed contract: creates the promoter, its contact, and links the contract', async () => {
    const { eventId, venueId } = await setup()
    const path = join(root, 'Vertrag Beispielband.txt')
    writeFileSync(path, contract)
    const filed = await container
      .resolve(DocumentService)
      .upload({ ownerType: 'event', ownerId: eventId, sourcePath: path, documentType: 'contract' })

    const plan = await service.analyze({ eventId, paths: [], documentId: filed.id })
    expect(plan.documentId).toBe(filed.id)
    expect(plan.files).toEqual([])
    const company = plan.suggestions.find((s) => s.id === 'company.promoter')
    expect(company).toMatchObject({ group: 'Vertragspartner', include: true })
    expect(company?.label).toBe('Veranstalter Muster Konzerte GmbH anlegen und eintragen')
    const person = plan.suggestions.find((s) => s.group === 'Kontakte' && /Max Promo/.test(s.label))
    expect(person?.proposed).toMatch(/Ansprechpartner von Muster Konzerte GmbH/)
    expect(person?.proposed).toMatch(/LoPro-Kontakt/)
    const guarantee = plan.suggestions.find((s) => s.id === 'event.guarantee')
    expect(guarantee?.proposed).toBe('1.500,00 €')

    const result = await service.apply({
      eventId,
      files: [],
      actions: [company!.action, person!.action],
      documentId: filed.id
    })
    expect(result.problems).toEqual([])

    const event = db.select().from(schema.deal_memo).where(eq(schema.deal_memo.id, eventId)).get()
    const promoter = db
      .select()
      .from(schema.company)
      .where(eq(schema.company.id, event!.lopro_company_id!))
      .get()
    expect(promoter).toMatchObject({ name: 'Muster Konzerte GmbH', vat_id: 'DE123456789' })
    expect(event?.lopro_person_id).not.toBeNull()
    const members = db
      .select()
      .from(schema.company_member)
      .where(eq(schema.company_member.company_id, promoter!.id))
      .all()
    expect(members.map((m) => m.person_id)).toEqual([event!.lopro_person_id])

    // the contract shows at the promoter, its contact, the band and the club
    const links = container.resolve(DocumentLinkService).list(filed.id)
    expect(links.map((l) => l.kind).sort()).toEqual(['band', 'company', 'person', 'venue'])
    expect(links.find((l) => l.kind === 'venue')?.id).toBe(venueId)

    // read again: the promoter is the event's now, nothing to enter twice
    const again = await service.analyze({ eventId, paths: [], documentId: filed.id })
    expect(again.suggestions.some((s) => s.id === 'company.promoter')).toBe(false)
  })
})
