import { readFile } from 'fs/promises'
import { basename, extname } from 'path'
import type { ImportFile, ImportRow, ImportTable } from '../api/schemas/import.schema'
import { csvSeparator, decodeCsv, parseCsv, repairMojibake } from '../csv/csv'
import {
  detectMappings,
  suggestCompanyKind,
  suggestCountry,
  suggestKind,
  suggestTarget
} from './detectMapping'
import { readXlsxSheets } from './xlsx'
import { generatedHeader } from './generatedHeaders'

const DATA_CELL = /@|^\d{1,2}\.\d{1,2}\.\d{2,4}$|^\d{4}-\d{2}-\d{2}$|^-?\d+([.,]\d+)?$/

/** A row that holds data, not column names: an e-mail address, a date or a number in it */
function looksLikeData(cells: string[]): boolean {
  return cells.some((cell) => DATA_CELL.test(cell))
}

/**
 * The header row is the first non-empty record, every later non-empty one a data row (numbered
 * as Excel numbers the line). Null without data rows. Double-encoded umlauts are repaired cell
 * by cell. Tour sheets often start differently (#225 follow-up): a title row with one filled
 * cell ("APRIL ART TOUR Herbst 2026") is skipped and kept as `title`, and when the row after it
 * already holds data (a date, an address), the sheet has no header row: the columns are named
 * "Spalte A", "Spalte B", … and that row is data too.
 */
export function importTable(
  name: string,
  records: string[][],
  defaultCountry: string
): ImportTable | null {
  const filled: Array<{ rowNumber: number; cells: string[] }> = []
  let width = 0
  records.forEach((record, index) => {
    const cells = record.map((cell) => repairMojibake(cell).trim())
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
    if (cells.length === 0) return
    width = Math.max(width, cells.length)
    filled.push({ rowNumber: index + 1, cells })
  })

  const nonEmpty = (cells: string[]): number => cells.filter((cell) => cell !== '').length
  let start = 0
  let title = ''
  // Title rows: one filled cell above rows with several
  while (
    start < filled.length - 1 &&
    nonEmpty(filled[start].cells) === 1 &&
    filled.slice(start + 1).some((row) => nonEmpty(row.cells) >= 3)
  ) {
    title ||= filled[start].cells.find((cell) => cell !== '') ?? ''
    start++
  }
  const first = filled[start]
  if (!first) return null
  const headerless = title !== '' && looksLikeData(first.cells)
  // Outlook quotes its first header twice: "Anrede" arrives with the quotes
  const headers: string[] = headerless
    ? Array.from({ length: width }, (_, index) => generatedHeader(index))
    : first.cells.map((cell) => cell.replace(/^"([^"]*)"$/, '$1'))
  const rows: ImportRow[] = filled.slice(headerless ? start : start + 1)

  if (rows.length === 0) return null
  const headerRow: string[] = headers
  const pad = (cells: string[]): string[] =>
    Array.from({ length: width }, (_, index) => cells[index] ?? '')
  const paddedHeaders = pad(headerRow)
  const paddedRows = rows.map((row) => ({ ...row, cells: pad(row.cells) }))

  return {
    name,
    title,
    headers: paddedHeaders,
    rows: paddedRows,
    suggestedTarget: suggestTarget(name, paddedHeaders),
    suggestedMappings: detectMappings(paddedHeaders, paddedRows),
    mappingRemembered: false,
    suggestedKind: suggestKind(name, paddedHeaders),
    suggestedCompanyKind: suggestCompanyKind(name, paddedHeaders),
    suggestedCountry: suggestCountry(name, defaultCountry)
  }
}

/**
 * Reads a CSV or Excel file (.xlsx: `table` is its first sheet, `sheets` all of them) for the import dialog. A CSV's separator is
 * detected; on a tie the one of `locale` wins. `defaultCountry` is suggested unless the file
 * name says the list is international.
 */
export async function readImportFile(
  filePath: string,
  defaultCountry = 'DE',
  locale = 'de-DE'
): Promise<ImportFile> {
  const fileName = basename(filePath)
  const name = basename(fileName, extname(fileName))
  const content = await readFile(filePath)
  if (extname(fileName).toLowerCase() === '.xlsx') {
    const sheets = readXlsxSheets(content).map((sheet, index) => ({
      name: sheet.sheetName || `Blatt ${index + 1}`,
      table: importTable(name, sheet.records, defaultCountry)
    }))
    return { fileName, table: sheets[0]?.table ?? null, sheets }
  }
  const text = decodeCsv(content)
  return {
    fileName,
    table: importTable(name, parseCsv(text, csvSeparator(locale)), defaultCountry),
    sheets: []
  }
}
