// CSV in the regional format: the separator per locale, quoting, reading
// files Excel saved (UTF-8 with BOM, ANSI, UTF-16 text) and the import table
// built from them.
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  CSV_BOM,
  csvSeparator,
  decodeCsv,
  detectSeparator,
  parseCsv,
  repairMojibake,
  toCsv
} from '../src/main/csv/csv'
import { importTable, readImportFile } from '../src/main/import/readImportFile'

const dir = mkdtempSync(join(tmpdir(), 'bookingum-csv-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('separator', () => {
  it('follows the decimal mark of the locale', () => {
    expect(csvSeparator('de-DE')).toBe(';')
    expect(csvSeparator('de-AT')).toBe(';')
    expect(csvSeparator('fr-FR')).toBe(';')
    expect(csvSeparator('en-US')).toBe(',')
    expect(csvSeparator('en-GB')).toBe(',')
  })

  it("falls back to de-DE's for an unknown locale", () => {
    expect(csvSeparator('not a locale')).toBe(';')
  })

  it('is detected from the header row, the fallback deciding a tie', () => {
    expect(detectSeparator('Name;Ort;PLZ\r\nA,B;C;D', ',')).toBe(';')
    expect(detectSeparator('Name,Ort,PLZ\nx', ';')).toBe(',')
    expect(detectSeparator('Name\tOrt\nx', ';')).toBe('\t')
    expect(detectSeparator('"Name; Vorname",Ort\nx', ';')).toBe(',')
    expect(detectSeparator('Name\nx', ',')).toBe(',')
  })
})

describe('writing and reading', () => {
  const rows = [
    ['Name', 'Anmerkung', 'Betrag'],
    ['Club "Süd"', 'Zeile 1\nZeile 2', '1234,50'],
    ['Halle; Nord', '', '']
  ]

  it('quotes fields with separators, quotes and line breaks', () => {
    expect(toCsv(rows, ';').split('\r\n')).toEqual([
      'Name;Anmerkung;Betrag',
      '"Club ""Süd""";"Zeile 1\nZeile 2";"1234,50"',
      '"Halle; Nord";;',
      ''
    ])
  })

  it('reads back what it writes, with either separator', () => {
    expect(parseCsv(CSV_BOM + toCsv(rows, ';'), ',')).toEqual(rows)
    expect(parseCsv(toCsv(rows, ','), ';')).toEqual(rows)
  })

  it('takes an Excel "sep=" line and files without a final line break', () => {
    expect(parseCsv('sep=,\nA;B,C\n1;2,3', ';')).toEqual([
      ['A;B', 'C'],
      ['1;2', '3']
    ])
  })

  it('decodes UTF-8 with or without BOM, Windows-1252 and UTF-16', () => {
    const utf8 = new TextEncoder().encode('Spielstätte;Größe')
    expect(decodeCsv(utf8)).toBe('Spielstätte;Größe')
    expect(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toBe('Spielstätte;Größe')
    // "Spielstätte" as Excel's "CSV (Trennzeichen-getrennt)" saves it
    const ansi = new Uint8Array([...Buffer.from('Spielst', 'latin1'), 0xe4, ...Buffer.from('tte')])
    expect(decodeCsv(ansi)).toBe('Spielstätte')
    const utf16 = new Uint8Array([0xff, 0xfe, ...Buffer.from('Ort\tPLZ', 'utf16le')])
    expect(decodeCsv(utf16)).toBe('Ort\tPLZ')
  })

  it("decodes Windows-1252's own characters, not Latin-1 control codes", () => {
    // „Gage“ – 500 € (0x84, 0x93, 0x96, 0x80)
    const ansi = new Uint8Array([0x84, ...Buffer.from('Gage'), 0x93, 0x20, 0x96, 0x20])
    expect(decodeCsv(new Uint8Array([...ansi, ...Buffer.from('500 '), 0x80]))).toBe(
      '„Gage“ – 500 €'
    )
  })

  it('repairs UTF-8 that was read as Windows-1252 and saved again', () => {
    expect(repairMojibake('StraÃŸe geschÃ¤ftlich')).toBe('Straße geschäftlich')
    expect(repairMojibake('Ã–sterreich, â€žGageâ€œ')).toBe('Österreich, „Gage“')
    // Correct text stays as it is
    for (const text of ['Spielstätte', 'Größe', 'Ã', 'Â ', 'Straße', 'Ärger 3½']) {
      expect(repairMojibake(text)).toBe(text)
    }
  })
})

describe("Outlook's contact export", () => {
  // Outlook double-encodes its header row and quotes "Anrede" twice, behind
  // a byte order mark of its own; the data rows are proper UTF-8
  const headers = [
    'ï»¿"Anrede"',
    'Vorname',
    'Nachname',
    'Firma',
    'StraÃŸe geschÃ¤ftlich',
    'StraÃŸe geschÃ¤ftlich 2',
    'Ort geschÃ¤ftlich',
    'Postleitzahl geschÃ¤ftlich',
    'Land/Region geschÃ¤ftlich',
    'StraÃŸe privat',
    'Ort privat',
    'Bundesland/Kanton privat',
    'Postleitzahl privat',
    'Land/Region privat',
    'Weitere StraÃŸe',
    'Weiterer Ort',
    'Telefon geschÃ¤ftlich',
    'Telefon (privat)',
    'Mobiltelefon',
    'E-Mail-Adresse',
    'Ort',
    'Webseite'
  ]
  const rows = [
    [
      'Frau',
      'Erika',
      'Mustermann',
      'Beispiel GmbH',
      'Musterweg',
      '',
      'Köln',
      '50667',
      'Deutschland',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '0221 1234',
      '0221 5678',
      '',
      'erika@example.test',
      'Büro 2',
      'www.example.test'
    ],
    [
      'Herr',
      'Max',
      'Muster',
      '',
      'Hauptstraße',
      '',
      'Graz',
      '8010',
      'Österreich',
      'Gasse',
      'Wien',
      '',
      '1010',
      'Österreich',
      '',
      '',
      '',
      '01 234',
      '',
      'max@example.test',
      '',
      ''
    ],
    [
      '',
      'Jana',
      'Beispiel',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '0170 1',
      '',
      '',
      ''
    ]
  ]

  it('reads the umlauts and maps the address with the most data', async () => {
    const file = join(dir, 'Kontakte.CSV')
    const text = [headers, ...rows].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`))
    writeFileSync(
      file,
      Buffer.from(CSV_BOM + text.map((row) => row.join(',')).join('\r\n'), 'utf8')
    )
    const read = await readImportFile(file, 'DE', 'de-DE')
    const table = read.table!
    expect(table.headers.slice(0, 5)).toEqual([
      'Anrede',
      'Vorname',
      'Nachname',
      'Firma',
      'Straße geschäftlich'
    ])
    expect(table.rows[0].cells[6]).toBe('Köln')
    expect(table.suggestedTarget).toBe('persons')

    const mapped = Object.fromEntries(
      table.headers
        .map((header, column) => [header, table.suggestedMappings.persons[column]])
        .filter(([, field]) => field !== 'ignore')
    )
    expect(mapped).toEqual({
      Vorname: 'firstName',
      Nachname: 'lastName',
      Firma: 'companyName',
      'Straße geschäftlich': 'street',
      'Ort geschäftlich': 'city',
      'Postleitzahl geschäftlich': 'zipCode',
      'Land/Region geschäftlich': 'region',
      'Telefon (privat)': 'phone',
      Mobiltelefon: 'mobile',
      'E-Mail-Adresse': 'email',
      Webseite: 'homepage'
    })
  })

  it('takes the private address when that one is filled', () => {
    const table = importTable(
      'Kontakte',
      [
        ['Vorname', 'Straße geschäftlich', 'Ort geschäftlich', 'Straße privat', 'Ort privat'],
        ['Erika', '', '', 'Musterweg', 'Köln'],
        ['Max', '', 'Graz', 'Gasse', 'Wien']
      ],
      'DE'
    )
    expect(table?.suggestedMappings.persons).toEqual([
      'firstName',
      'ignore',
      'ignore',
      'street',
      'city'
    ])
  })
})

describe('import table', () => {
  it('skips empty lines and pads rows to the widest one', () => {
    const table = importTable(
      'Festivals international',
      [
        ['', ''],
        ['Festival', 'Ort', ''],
        [''],
        ['Wiesen Open Air', 'Stadt', 'extra'],
        ['Nur Name']
      ],
      'DE'
    )
    expect(table?.headers).toEqual(['Festival', 'Ort', ''])
    expect(table?.rows).toEqual([
      { rowNumber: 4, cells: ['Wiesen Open Air', 'Stadt', 'extra'] },
      { rowNumber: 5, cells: ['Nur Name', '', ''] }
    ])
    expect(table?.suggestedTarget).toBe('venues')
    expect(table?.suggestedCountry).toBe('')
  })

  it('is null without data rows', () => {
    expect(importTable('Leer', [['Name', 'Ort']], 'DE')).toBeNull()
  })

  it('reads an ANSI file named after its list', async () => {
    const file = join(dir, 'Spielstätten.csv')
    writeFileSync(file, Buffer.from('Spielstätte;Kapazität\r\nClub Süd;300\r\n', 'latin1'))
    const read = await readImportFile(file, 'DE', 'de-DE')
    expect(read.fileName).toBe('Spielstätten.csv')
    expect(read.table?.name).toBe('Spielstätten')
    expect(read.table?.headers).toEqual(['Spielstätte', 'Kapazität'])
    expect(read.table?.rows).toEqual([{ rowNumber: 2, cells: ['Club Süd', '300'] }])
    expect(read.table?.suggestedCountry).toBe('DE')
  })
})
