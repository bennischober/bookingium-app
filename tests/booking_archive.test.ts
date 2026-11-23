// "Booking-Archiv einlesen": the recognition of old booking folders and the import of many shows.
// The texts follow the layout of real booking folders (a band's own contract form, its own
// invoices, travel papers next to them); every name, address and number is made up.

import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { setStorageBasePath } from '../src/main/utils/fileStorage'
import { setupTestDb } from './helpers/setup'
import {
  dateOfFileNames,
  findShowFolders,
  parseShowFolderName
} from '../src/main/archive/showFolders'
import { extractOwnInvoice } from '../src/main/showfolder/ownInvoice'
import { extractContractEvent, extractContractParty } from '../src/main/showfolder/contractParty'
import { classifyShowFile } from '../src/main/showfolder/extract'
import { docxText } from '../src/main/showfolder/fileText'
import { ArchiveImportService } from '../src/main/services/ArchiveImportService'

setupTestDb()

/** The band's own contract form: parties on one line each, the show as labels then values */
const contractForm = `MUSTER BAND
KONZERTVERTRAG vom 29.06.2023
zwischen: Muster Band - Muster, Beispiel GbR, Musterweg 11, 12345 Musterstadt
- nachfolgend „Artist“ genannt -
und dem örtlichen Veranstalter: Stadt Beispielhausen, Veranstaltungsorganisation, Beispielstraße 1, 54321 Beispielhausen
vertreten durch: Max Beispiel
Künstlersozialkassen-Nummer des örtlichen Veranstalters: 12345678X001
Steuernummer/USt-Nummer des örtlichen Veranstalters: 123/456/78901
- nachfolgend „ÖV“ genannt -
1. Engagement
Veranstaltungsdatum:
Event/Veranstaltung:
Veranstaltungsort:
Location:
29.07.2023
Festival der Beispieljugend
54321 Beispielhausen
Beispielstadion
1.1 Ankündigung:
Garantie 500 € vs. 100 % netto
`

/** The band's own invoice: sender line, recipient block, fee */
const invoice = `Rechnung Nr.: 025-2024
Sehr geehrte Damen und Herren,
hiermit stellen wir unser Honorar für unseren Live Auftritt am 21.06.2024 auf dem Beispiel Flair in Rechnung:
Nr. Anzahl Artikel Preis
1 1 Honorar 1.500,00 €
2 1 Produktionskosten 900,00 €
Netto: 2.400,00 €
Gesamtbetrag: 2.400,00 €
Muster Band GbR • Musterweg 11 • 12345 Musterstadt
Beispiel Flair GmbH
Beispielhof 1
I-39040 Beispieldorf
USt ID Nr. IT01234567890
MUSTER BAND GbR
Musterweg 11
03.06.2024
`

describe('recognition', () => {
  it('reads date, end date and title from a show folder name', () => {
    expect(parseShowFolderName('2024-06-21 I-Beispieldorf  Beispiel Flair')).toEqual({
      date: '2024-06-21',
      endDate: '',
      title: 'I-Beispieldorf Beispiel Flair'
    })
    expect(parseShowFolderName('2024-01-28-02-02 Miami Beispiel Cruise')).toMatchObject({
      date: '2024-01-28',
      endDate: '2024-02-02'
    })
    expect(parseShowFolderName('2023-12-30-01-02 Silvester').endDate).toBe('2024-01-02')
    expect(parseShowFolderName('Festival der Beispieljugend').date).toBe('')
    expect(dateOfFileNames(['Bühneninfos.pdf', 'Konzertvertrag 29.07.2023 Muster.pdf'])).toBe(
      '2023-07-29'
    )
  })

  it("reads the promoter of the band's contract form, with KSK and tax number", () => {
    expect(extractContractParty(contractForm)).toMatchObject({
      name: 'Stadt Beispielhausen',
      street: 'Beispielstraße 1',
      zipCode: '54321',
      city: 'Beispielhausen',
      contactName: 'Max Beispiel',
      kskNumber: '12345678X001',
      taxNumber: '123/456/78901'
    })
  })

  it('reads the show from labels in one column and values in the next', () => {
    expect(extractContractEvent(contractForm)).toEqual({
      date: '2023-07-29',
      eventName: 'Festival der Beispieljugend',
      zipCode: '54321',
      city: 'Beispielhausen',
      location: 'Beispielstadion'
    })
  })

  it('reads our own invoice: recipient with country and VAT id, fee and total', () => {
    expect(extractOwnInvoice(invoice, ['Muster Band'])).toEqual({
      number: '025-2024',
      date: '2024-06-03',
      recipient: {
        name: 'Beispiel Flair GmbH',
        street: 'Beispielhof 1',
        zipCode: '39040',
        city: 'Beispieldorf',
        countryCode: 'IT',
        vatId: 'IT01234567890',
        contactName: ''
      },
      feeCents: 150000,
      totalCents: 240000
    })
    // an invoice someone else wrote is not ours
    expect(extractOwnInvoice(invoice, ['Andere Band'])).toBeNull()
  })

  it('keeps travel papers out, also by the folder they lie in', () => {
    const kind = (name: string, dirs: string[] = []) =>
      classifyShowFile({ name, text: '', links: [], dirs }, [])
    expect(kind('Reisepasse Band und Crew.docx')).toBe('travel')
    expect(kind('ESTA-Group-Summary.html')).toBe('travel')
    expect(kind('Booking Confirmation Muster 70 Ticket.pdf')).toBe('travel')
    expect(kind('1561ABCD-D11D_MUSTER.pdf', ['Cruise Tickets', 'Beispiel US'])).toBe('travel')
    expect(kind('Rechnung_019-2023_Beispiel.pdf')).toBe('invoice')
    expect(kind('Rechnungsadresse Beispielpaket.docx')).not.toBe('invoice')
    expect(kind('MUSTER_BAND_offer_COUNTERSIGNED.pdf')).toBe('contract')
  })

  it('reads the text of a Word document', () => {
    // a minimal .docx: one stored (uncompressed) part
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>Rechnungsadresse:</w:t></w:r></w:p><w:p><w:r><w:t>Beispiel e.V. &amp; Co</w:t></w:r></w:p></w:body></w:document>'
    expect(docxText(storedZip('word/document.xml', xml)).text.trim()).toBe(
      'Rechnungsadresse:\nBeispiel e.V. & Co'
    )
  })
})

describe('archive import', () => {
  let root: string
  let bandId: number

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'bookingium-archive-'))
    setStorageBasePath(join(root, 'storage'))
    const own = db.insert(schema.company).values({ name: 'Muster Band GbR' }).returning().get()
    bandId = db
      .insert(schema.band)
      .values({ name: 'Muster Band', company_id: own.id })
      .returning()
      .get().id
    const archive = join(root, 'Muster Band')
    // a folder with the date in its name, travel papers and a copy of the invoice
    const flair = join(archive, '2024', '2024-06-21 I-Beispieldorf  Beispiel Flair')
    mkdirSync(join(flair, 'Rechnung'), { recursive: true })
    mkdirSync(join(flair, 'Flugtickets'), { recursive: true })
    writeFileSync(join(flair, 'Rechnung', 'Rechnung_025-2024_Beispiel Flair.txt'), invoice)
    writeFileSync(join(flair, 'Rechnung', 'Rechnung_025-2024_Beispiel Flair [1].txt'), invoice)
    writeFileSync(join(flair, 'Flugtickets', 'Buchung Muster.txt'), 'Flug LH 123, Passagier Max')
    // a folder without a date in its name: the contract tells
    const youth = join(archive, '2023', 'Festival der Beispieljugend')
    mkdirSync(youth, { recursive: true })
    writeFileSync(join(youth, '2023-07-29 Vertrag Muster Band.txt'), contractForm)
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('finds the show folders, newest first, with their dates', async () => {
    const shows = await findShowFolders(join(root, 'Muster Band'))
    expect(shows.map((show) => [show.date, show.name])).toEqual([
      ['2024-06-21', '2024-06-21 I-Beispieldorf  Beispiel Flair'],
      ['2023-07-29', 'Festival der Beispieljugend']
    ])
  })

  it('previews, then creates the events, festivals and companies, filling only what is empty', async () => {
    const service = container.resolve(ArchiveImportService)
    const shows = await service.scan({ root: join(root, 'Muster Band'), bandId })
    expect(shows.every((show) => show.eventId === null)).toBe(true)

    const youth = shows.find((show) => show.folderName === 'Festival der Beispieljugend')!
    const preview = await service.preview({ path: youth.path, bandId })
    expect(preview).toMatchObject({
      place: { name: 'Festival der Beispieljugend', known: false, kind: 'festival' },
      promoter: { name: 'Stadt Beispielhausen', known: false },
      guaranteeCents: 50000,
      contractDate: '2023-07-29'
    })
    const flair = shows.find((show) => show.date === '2024-06-21')!
    const flairPreview = await service.preview({ path: flair.path, bandId })
    expect(flairPreview.recipient).toEqual({ name: 'Beispiel Flair GmbH', known: false })
    expect(flairPreview.files).toMatchObject({ invoices: 1, travel: 1, duplicates: 1 })

    const first = await service.apply({
      path: flair.path,
      bandId,
      date: flair.date,
      endDate: '',
      eventName: 'Beispiel Flair',
      eventId: null,
      fileDocuments: true
    })
    expect(first.createdEvent).toBe(true)
    expect(first.problems).toEqual([])
    const event = db
      .select()
      .from(schema.deal_memo)
      .where(eq(schema.deal_memo.id, first.eventId))
      .get()!
    expect(event).toMatchObject({ status: 'confirmed', guarantee_cents: 150000 })
    expect(event.archived_at).not.toBeNull()
    const billing = db
      .select()
      .from(schema.company)
      .where(eq(schema.company.id, event.invoice_company_id!))
      .get()!
    expect(billing).toMatchObject({ name: 'Beispiel Flair GmbH', vat_id: 'IT01234567890' })
    // only our invoice is filed: no copy, no travel papers
    const documents = db
      .select()
      .from(schema.document)
      .where(eq(schema.document.owner_id, first.eventId))
      .all()
    expect(documents.map((d) => [d.file_name, d.document_type])).toEqual([
      ['Rechnung_025-2024_Beispiel Flair.txt', 'invoice']
    ])

    const second = await service.apply({
      path: youth.path,
      bandId,
      date: preview.contractDate,
      endDate: '',
      eventName: 'Festival der Beispieljugend',
      eventId: null,
      fileDocuments: false
    })
    const youthEvent = db
      .select()
      .from(schema.deal_memo)
      .where(eq(schema.deal_memo.id, second.eventId))
      .get()!
    expect(youthEvent.guarantee_cents).toBe(50000)
    const promoter = db
      .select()
      .from(schema.company)
      .where(eq(schema.company.id, youthEvent.lopro_company_id!))
      .get()!
    expect(promoter).toMatchObject({
      name: 'Stadt Beispielhausen',
      ksk_number: '12345678X001',
      tax_number: '123/456/78901'
    })
    const venue = db
      .select()
      .from(schema.venue)
      .where(eq(schema.venue.id, youthEvent.venue_id!))
      .get()!
    expect(venue).toMatchObject({ name: 'Festival der Beispieljugend', kind: 'festival' })
    // only data: nothing filed
    expect(
      db.select().from(schema.document).where(eq(schema.document.owner_id, second.eventId)).all()
    ).toEqual([])

    // a second run finds the events and changes nothing stored
    const again = await service.scan({ root: join(root, 'Muster Band'), bandId })
    expect(again.map((show) => show.eventId)).toEqual([first.eventId, second.eventId])
    const rerun = await service.apply({
      path: flair.path,
      bandId,
      date: flair.date,
      endDate: '',
      eventName: 'Beispiel Flair',
      eventId: first.eventId,
      fileDocuments: true
    })
    expect(rerun).toMatchObject({ createdEvent: false, documents: 0 })
  })
})

/** A zip with one uncompressed part, as Word writes it in essence */
function storedZip(name: string, content: string): Buffer {
  const data = Buffer.from(content, 'utf-8')
  const nameBytes = Buffer.from(name, 'utf-8')
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(0, 8)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBytes.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(0, 10)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBytes.length, 28)
  central.writeUInt32LE(0, 42)
  const centralStart = local.length + nameBytes.length + data.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + nameBytes.length, 12)
  end.writeUInt32LE(centralStart, 16)
  return Buffer.concat([local, nameBytes, data, central, nameBytes, end])
}
