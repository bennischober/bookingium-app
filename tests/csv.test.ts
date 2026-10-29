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
