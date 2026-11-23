// ========================================
// Reading the first sheet of an Excel workbook (.xlsx)
// ========================================
// An .xlsx file is a zip of XML parts. This reads exactly what an import needs - the cells of the
// first worksheet as text, row by row - with Node's own zlib, so no spreadsheet library (and its
// supply chain) comes into the app. Formulas give their last computed value; dates come out as
// DD.MM.YYYY (what parseShowDate and the list import read); numbers as Excel shows them without
// grouping ("1500", "12,5" is kept as the stored 12.5 -> "12,5" in German).
import { ZipError, zipEntries as readEntries, zipPart, type ZipEntry } from './zip'

function zipEntries(zip: Buffer): Map<string, ZipEntry> {
  try {
    return readEntries(zip)
  } catch (error) {
    if (error instanceof ZipError) throw new Error('Die Datei ist keine Excel-Datei (.xlsx).')
    throw error
  }
}

function readPart(zip: Buffer, entries: Map<string, ZipEntry>, name: string): string | null {
  try {
    return zipPart(zip, entries, name)?.toString('utf-8') ?? null
  } catch (error) {
    if (error instanceof ZipError)
      throw new Error(
        error.message === 'unknown method'
          ? 'Die Excel-Datei ist in einem unbekannten Format gepackt.'
          : 'Die Excel-Datei ist beschädigt.'
      )
    throw error
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16))
    if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10))
    return ENTITIES[entity]
  })
}

/** The text of every <t> inside a fragment (rich text runs joined, phonetic hints left out) */
function textOf(fragment: string): string {
  const withoutPhonetic = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  return [...withoutPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)]
    .map((match) => decodeXml(match[1] ?? ''))
    .join('')
}

function sharedStrings(xml: string | null): string[] {
  if (!xml) return []
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((match) => textOf(match[1] ?? ''))
}

/** Built-in number formats that are dates (ECMA-376 18.8.30) */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57])

type CellStyle = { date: boolean; zeros: number }

/**
 * Per cell style index: whether the number format is a date, and how many digits a zero-padded
 * format ("00000", a postcode like 01067 stored as a number) shows
 */
function cellStyles(xml: string | null): CellStyle[] {
  if (!xml) return []
  const custom = new Map<number, string>()
  for (const match of xml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    custom.set(Number(match[1]), decodeXml(match[2]))
  }
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? ''
  return [...cellXfs.matchAll(/<xf\b([^>]*)\/?>/g)].map((match) => {
    const id = Number(/numFmtId="(\d+)"/.exec(match[1])?.[1] ?? '0')
    if (BUILTIN_DATE_FORMATS.has(id)) return { date: true, zeros: 0 }
    const code = custom.get(id)
    if (!code) return { date: false, zeros: 0 }
    if (/^0+$/.test(code)) return { date: false, zeros: code.length }
    // a date format names day, month or year outside quoted text and brackets ([Red], [h])
    const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '')
    return { date: /[dy]/i.test(bare) || /(^|[^h:])m{1,4}([^:s]|$)/i.test(bare), zeros: 0 }
  })
}

/** An Excel date serial (1900 system) as DD.MM.YYYY */
export function excelSerialToDate(serial: number): string {
  const days = Math.floor(serial)
  // Excel counts 1900-02-29 that never was; serials from 61 on are one day ahead
  const epoch = Date.UTC(1899, 11, days >= 61 ? 30 : 31)
  const date = new Date(epoch + days * 86_400_000)
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${date.getUTCFullYear()}`
}

/** "AB12" -> column index 27 */
function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? 'A'
  let index = 0
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index - 1
}

/** A number as text the way a German list shows it: no grouping, decimal comma, no float noise */
function numberText(raw: string): string {
  const value = Number(raw)
  if (!Number.isFinite(value)) return raw
  const rounded = Math.round(value * 1e9) / 1e9
  return String(rounded).replace('.', ',')
}

/** The workbook's sheets in tab order: name and part path, as its relationships name them */
function sheetParts(
  workbook: string | null,
  rels: string | null
): Array<{ name: string; path: string }> {
  const fallback = [{ name: '', path: 'xl/worksheets/sheet1.xml' }]
  if (!workbook) return fallback
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\/?>/g)].map((match) => {
    const tag = match[0]
    const id = /\br:id="([^"]+)"/.exec(tag)?.[1] ?? ''
    const relation =
      rels && id ? new RegExp(`<Relationship\\b[^>]*Id="${id}"[^>]*/?>`).exec(rels) : null
    const target = relation && /Target="([^"]+)"/.exec(relation[0])?.[1]
    const path = !target
      ? ''
      : target.startsWith('/')
        ? target.slice(1)
        : `xl/${target.replace(/^\.\//, '')}`
    return { name: decodeXml(/\bname="([^"]*)"/.exec(tag)?.[1] ?? ''), path }
  })
  if (sheets.length === 0) return fallback
  if (!sheets[0].path) sheets[0].path = fallback[0].path
  return sheets.filter((sheet) => sheet.path)
}

export type XlsxSheet = { sheetName: string; records: string[][] }

/**
 * The first worksheet of an .xlsx file as rows of cell texts (empty cells as ''), plus the
 * sheet's name. Rows keep their position, so row numbers match what Excel shows.
 */
export function readXlsx(file: Buffer): XlsxSheet {
  return readXlsxSheets(file, 1)[0]
}

/**
 * Every worksheet of an .xlsx file in tab order (at most `limit`), each as `readXlsx` reads
 * the first. A tour file often holds several lists: contacts, advancing, ticket quotas.
 */
export function readXlsxSheets(file: Buffer, limit = 20): XlsxSheet[] {
  const entries = zipEntries(file)
  const workbook = readPart(file, entries, 'xl/workbook.xml')
  const rels = readPart(file, entries, 'xl/_rels/workbook.xml.rels')
  const parts = sheetParts(workbook, rels).slice(0, limit)
  const first = readPart(file, entries, parts[0].path)
  if (!first) throw new Error('Die Excel-Datei enthält kein Tabellenblatt.')
  const strings = sharedStrings(readPart(file, entries, 'xl/sharedStrings.xml'))
  const styles = cellStyles(readPart(file, entries, 'xl/styles.xml'))

  return parts.flatMap((part, index) => {
    const sheetXml = index === 0 ? first : readPart(file, entries, part.path)
    if (!sheetXml) return []
    return [{ sheetName: part.name, records: sheetRecords(sheetXml, strings, styles) }]
  })
}

/** One worksheet's rows of cell texts */
function sheetRecords(sheetXml: string, strings: string[], styles: CellStyle[]): string[][] {
  const records: string[][] = []
  for (const row of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const attributes = row[1] ?? row[3] ?? ''
    const rowNumber = Number(/\br="(\d+)"/.exec(attributes)?.[1] ?? records.length + 1)
    while (records.length < rowNumber - 1) records.push([])
    const cells: string[] = []
    for (const cell of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cellAttributes = cell[1]
      const body = cell[2] ?? ''
      const reference = /\br="([A-Z]+\d+)"/.exec(cellAttributes)?.[1]
      const index = reference ? columnIndex(reference) : cells.length
      const type = /\bt="(\w+)"/.exec(cellAttributes)?.[1] ?? 'n'
      const style = Number(/\bs="(\d+)"/.exec(cellAttributes)?.[1] ?? '0')
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      let text = ''
      if (type === 's') text = raw === undefined ? '' : (strings[Number(raw)] ?? '')
      else if (type === 'inlineStr') text = textOf(body)
      else if (type === 'str' || type === 'e') text = raw === undefined ? '' : decodeXml(raw)
      else if (type === 'b') text = raw === '1' ? 'WAHR' : raw === '0' ? 'FALSCH' : ''
      else if (raw !== undefined && raw !== '') {
        const cellStyle = styles[style]
        if (cellStyle?.date) text = excelSerialToDate(Number(raw))
        else if (cellStyle?.zeros && /^\d+$/.test(raw)) text = raw.padStart(cellStyle.zeros, '0')
        else text = numberText(raw)
      }
      while (cells.length < index) cells.push('')
      cells[index] = text
    }
    records.push(cells)
  }
  return records
}
