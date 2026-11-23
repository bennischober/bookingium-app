// Info sheets of festivals and clubs: the promoter they name, the festival, the site's address,
// the act's times, and the ways PDFs and Word tables mangle them (words torn apart, several
// "Label: value" pairs on one line, a label cell beside its value). Laid out like real sheets;
// all names, numbers and addresses are invented.
import { describe, expect, it } from 'vitest'
import { extractSheetPromoter } from '../src/main/showfolder/contractParty'
import {
  classifyShowFile,
  emptyFacts,
  extractShowFacts,
  mendWords,
  mergeShowFacts,
  placeNameOf,
  segmentsOf
} from '../src/main/showfolder/extract'
import { docxText } from '../src/main/showfolder/fileText'

const BAND = 'Beispielband'

/** A festival's sheet for one act: promoter, site, the association's address, the act's times */
const festivalSheet = `Infosheet für Bands und KünstlerInnen des Muster Open Air
Allgemeine Informationen
Veranstalter:   Beispiel und Krempel e.V. Musterdorf
Hauptverantwortliche:   Erika Muster
Veranstaltungsort:   Sportgelände Musterdorf
Musterweg 11
12345 Musterdorf
Adresse des Vereins   Beispiel und Krempel e.V.
Beispielstraße 77
12345 Musterdorf
Website:   http://www.muster - openair.example.test
E - Mail - Adresse:   info@muster - openair.example.test
Auftrittsdaten
Bandname:   Beispielband
Bühne:   Main   Stage
Bandbetreuer:   Max Beispiel   –   +49 151 000 0001
Zeitplan:   Ankunft   17:25
Umbau und   Sound check   17:55
Auftrittsbeginn   18:50
Auftrittsende   19:35
`

/** A festival's itinerary: the promoter in a block of its own, labels torn apart */
const itinerary = `Itinerary
Artist:   Beispielband
Festival: Musterfest
Veranstalter   Details:
Firmenn ame : Muster Festival GmbH
Veranstalter   Name: Erika Muster & Max Beispiel
Adress e : Musterweg 11
12345 Musterstadt
Tel: +49 40 0000000
Mail:   info@muster-festival.example.test
Venue Details:
Adresse Bühne : Beispielplatz 4, 54321 Nebenort
`

/** An agency's form: several pairs on a line, words torn apart */
const agencyForm = `Band:   BEISPIELBAND
Datum:   25.08.2026   Stadt: Musterstadt
Event :   Muster Op en Air
Venue:   Venue /L ocation :   Am Beispielhügel   Straße:   Am Beispielhügel
PLZ:   12345   Stadt:   Nebenort
Promoter /Veranstalter :   Promoter:   Muster Eventmanagemen t GmbH
Ansprechp.   Erika Muster
Mobil:   0151 0000003
Email:   em@muster - gmbh.example.test
Techniker:   Technischer Leiter:   Max Beispiel
`

/** A promoter running the show in person, the block below "Veranstalter:" */
const personSheet = `Muster Open Air
in Musterdorf
Veranstalter:
Erika Muster
Musterweg 11
12345 Musterdorf
Handy: 0172 - 0000000
info@muster - openair.example.test
Anreise   zum Festivalgelände :
Beispielweg 21, 12345 Musterdorf
`

describe('promoter of an info sheet', () => {
  it('reads the promoter, its own address (not the site) and the person in charge', () => {
    expect(extractSheetPromoter(festivalSheet)).toMatchObject({
      name: 'Beispiel und Krempel e.V.',
      street: 'Beispielstraße 77',
      zipCode: '12345',
      city: 'Musterdorf',
      email: 'info@muster-openair.example.test',
      website: 'http://www.muster-openair.example.test',
      contactName: 'Erika Muster'
    })
  })

  it('reads a promoter block with a company name, up to the venue block', () => {
    expect(extractSheetPromoter(itinerary)).toMatchObject({
      name: 'Muster Festival GmbH',
      street: 'Musterweg 11',
      zipCode: '12345',
      city: 'Musterstadt',
      phone: '+49 40 0000000',
      email: 'info@muster-festival.example.test',
      contactName: 'Erika Muster'
    })
  })

  it('reads a form with several pairs on a line', () => {
    expect(extractSheetPromoter(agencyForm)).toMatchObject({
      name: 'Muster Eventmanagement GmbH',
      phone: '0151 0000003',
      email: 'em@muster-gmbh.example.test',
      contactName: 'Erika Muster'
    })
  })

  it('takes a person running the show as the promoter', () => {
    expect(extractSheetPromoter(personSheet)).toMatchObject({
      name: 'Erika Muster',
      street: 'Musterweg 11',
      zipCode: '12345',
      city: 'Musterdorf',
      phone: '0172 - 0000000',
      email: 'info@muster-openair.example.test'
    })
  })

  it('names no promoter for a contact line or a sheet without one', () => {
    expect(extractSheetPromoter('Veranstalter: Erika Muster – +49 151 000 0001')).toBeNull()
    expect(extractSheetPromoter('Get In: 13:00\nDoors: 19:00')).toBeNull()
  })
})

describe('festival, site and times of an info sheet', () => {
  it('reads the festival from the heading, the site as a note, its address below it', () => {
    const facts = extractShowFacts(
      { name: 'Beispielband Infosheet.pdf', text: festivalSheet, links: [] },
      'daysheet',
      BAND
    )
    expect(facts.venue).toMatchObject({
      name: 'Muster Open Air',
      kind: 'festival',
      street: 'Musterweg 11',
      zipCode: '12345',
      city: 'Musterdorf'
    })
    expect(facts.venue.notes).toContain('Gelände: Sportgelände Musterdorf')
    // the sound check counts though the change over is named; begin and end give the length
    expect(facts.itinerary).toMatchObject({
      soundCheckMainAct: '17:55',
      showTimeMainAct: '18:50',
      showLength: '45'
    })
    expect(facts.contacts).toContainEqual(
      expect.objectContaining({ name: 'Max Beispiel', side: 'venue', onSite: true })
    )
  })

  it('reads the event, the venue and the town of a form with pairs on a line', () => {
    expect(segmentsOf('Datum:   25.08.2026   Stadt: Musterstadt')).toEqual([
      'Datum: 25.08.2026',
      'Stadt: Musterstadt'
    ])
    // a label torn apart stays one label
    expect(segmentsOf('Veranstalter   Details:')).toEqual(['Veranstalter Details:'])
    const facts = extractShowFacts(
      { name: 'Infosheet.pdf', text: agencyForm, links: [] },
      'daysheet',
      BAND
    )
    expect(facts.venue).toMatchObject({
      name: 'Muster Open Air',
      street: 'Am Beispielhügel',
      zipCode: '12345',
      city: 'Nebenort'
    })
  })

  it('reads a festival named alone at the top', () => {
    const facts = extractShowFacts(
      { name: 'Infos.pdf', text: personSheet, links: [] },
      'other',
      BAND
    )
    expect(facts.venue.name).toBe('Muster Open Air')
  })

  it("reads the act's line of a running order, also with the letters spaced apart", () => {
    const spaced = [
      'E i n l a s s 1 6 : 0 0',
      'S E C 1 7 : 2 5 - 1 8 : 1 0 V o r b a n d E i n s',
      'M A I N 1 8 : 1 5 - 1 9 : 0 5 B e i s p i e l b a n d'
    ].join('\n')
    expect(
      extractShowFacts({ name: 'Running Order.pdf', text: spaced, links: [] }, 'daysheet', BAND)
        .itinerary
    ).toMatchObject({ showTimeMainAct: '18:15', showLength: '50' })
    const plain = 'Soundcheck Beispielband 15:30 - 16:00\n19:00 - 20:00 Beispielband'
    expect(
      extractShowFacts({ name: 'Running Order.pdf', text: plain, links: [] }, 'daysheet', BAND)
        .itinerary
    ).toMatchObject({ soundCheckMainAct: '15:30', showTimeMainAct: '19:00', showLength: '60' })
  })

  it('reads a contact whose phone and e-mail stand on lines of their own', () => {
    const text = `Veranstaltungsleitung:   Erika Muster
+49   151 0000001
erika@muster - musik.example.test
Local Contact:   Max Beispiel
Phone:   0151 0000002
Firma:   Muster Events GmbH
+49 40 0000000`
    const facts = extractShowFacts({ name: 'Venue Specs.pdf', text, links: [] }, 'venue_spec', BAND)
    expect(facts.contacts).toEqual([
      expect.objectContaining({
        name: 'Erika Muster',
        email: 'erika@muster-musik.example.test',
        phone: '+49 151 0000001',
        side: 'venue'
      }),
      expect.objectContaining({ name: 'Max Beispiel', phone: '0151 0000002' })
    ])
  })

  it("keeps the street's town apart", () => {
    const facts = extractShowFacts(
      { name: 'Anfahrt.pdf', text: 'Adresse: Beispielplatz 4 // 54321 Nebenort', links: [] },
      'other',
      BAND
    )
    expect(facts.venue).toMatchObject({
      street: 'Beispielplatz 4',
      zipCode: '54321',
      city: 'Nebenort'
    })
  })
})

describe('names', () => {
  it('mends words a PDF tore apart', () => {
    expect(mendWords('Muster Eventmanagemen t GmbH')).toBe('Muster Eventmanagement GmbH')
    expect(mendWords('Muster Op en Air')).toBe('Muster Open Air')
    expect(mendWords('Erika Mu ster')).toBe('Erika Muster')
    expect(mendWords('Beispiel und Krempel e.V.')).toBe('Beispiel und Krempel e.V.')
    expect(mendWords('Am Beispielsee')).toBe('Am Beispielsee')
  })

  it("spells the festival as the archive's folder does", () => {
    expect(placeNameOf('Bik er Days', 'Musterstadt - Seepark Biker Days')).toBe('Biker Days')
    expect(placeNameOf('', 'Musterdorf - Muster Open Air')).toBe('Muster Open Air')
    expect(placeNameOf('', 'Musterstadt Maiwoche')).toBe('')
    expect(placeNameOf('Musterfest', 'Musterstadt - Anderes Open Air')).toBe('Musterfest')
  })
})

describe('merging', () => {
  it("lets the contract's promoter win and fills its gaps from the sheet", () => {
    const sheet = emptyFacts()
    sheet.promoter = {
      ...extractSheetPromoter(agencyForm)!,
      name: 'Muster Eventma nagement GmbH'
    }
    const contract = emptyFacts()
    contract.promoter = {
      ...extractSheetPromoter(agencyForm)!,
      name: 'Muster Eventmanagement GmbH',
      email: '',
      phone: '',
      vatId: 'DE123456789'
    }
    const merged = mergeShowFacts([
      { kind: 'daysheet', facts: sheet },
      { kind: 'contract', facts: contract }
    ])
    expect(merged.promoter).toMatchObject({
      name: 'Muster Eventmanagement GmbH',
      vatId: 'DE123456789',
      email: 'em@muster-gmbh.example.test',
      phone: '0151 0000003'
    })
    expect(merged.promoterKind).toBe('contract')
  })
})

describe('files', () => {
  it('takes a letter that only mentions the artists for no contract', () => {
    const letter = 'Moin,\nhier ein paar Infos. Wir geben den Künstlern beste Voraussetzungen.'
    expect(
      classifyShowFile({ name: 'INFOS zur Veranstaltung.docx', text: letter, links: [] }, [])
    ).not.toBe('contract')
    const contract = 'Dieser Vertrag regelt das Engagement des Künstlers.'
    expect(classifyShowFile({ name: 'Dokument.pdf', text: contract, links: [] }, [])).toBe(
      'contract'
    )
  })

  it('reads a Word table row as "Label: value"', () => {
    const cell = (...lines: string[]) =>
      `<w:tc>${lines.map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('')}</w:tc>`
    const row = (...cells: string[]) => `<w:tr>${cells.join('')}</w:tr>`
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>PROMOTER INFOS</w:t></w:r></w:p><w:tbl>' +
      row(
        cell('Name'),
        cell('Beispiel e.V.', 'Erika Muster', 'Musterweg 11', '12345 Musterstadt')
      ) +
      row(cell('Address'), cell()) +
      row(cell('Phone'), cell('0151 0000004')) +
      row(cell('22:00 – 23:30 Uhr'), cell('Beispielband')) +
      '</w:tbl></w:body></w:document>'
    const { text } = docxText(storedZip('word/document.xml', xml))
    expect(text.split('\n')).toEqual([
      'PROMOTER INFOS',
      'Name: Beispiel e.V.',
      'Erika Muster',
      'Musterweg 11',
      '12345 Musterstadt',
      'Address',
      'Phone: 0151 0000004',
      '22:00 – 23:30 Uhr   Beispielband'
    ])
    expect(extractSheetPromoter(text)).toMatchObject({
      name: 'Beispiel e.V.',
      street: 'Musterweg 11',
      zipCode: '12345',
      city: 'Musterstadt',
      phone: '0151 0000004',
      contactName: 'Erika Muster'
    })
  })
})

/** A zip with one stored (uncompressed) part, as a minimal .docx */
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
