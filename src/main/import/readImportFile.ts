import { readFile } from 'fs/promises'
import { basename, extname } from 'path'
import type { ImportFile, ImportRow, ImportTable } from '../api/schemas/import.schema'
import { csvSeparator, decodeCsv, parseCsv } from '../csv/csv'
import { detectMappings, suggestCountry, suggestKind, suggestTarget } from './detectMapping'

/**
 * The first non-empty record is the header row, every later non-empty one a
 * data row (numbered as Excel numbers the line). Null without data rows.
 */
export function importTable(
  name: string,
  records: string[][],
  defaultCountry: string
): ImportTable | null {
  const rows: ImportRow[] = []
  let headers: string[] | null = null
  let width = 0

  records.forEach((record, index) => {
    const cells = record.map((cell) => cell.trim())
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
    if (cells.length === 0) return
    width = Math.max(width, cells.length)
    if (headers === null) headers = cells
    else rows.push({ rowNumber: index + 1, cells })
  })

  if (headers === null || rows.length === 0) return null
  const headerRow: string[] = headers
  const pad = (cells: string[]): string[] =>
    Array.from({ length: width }, (_, index) => cells[index] ?? '')
  const paddedHeaders = pad(headerRow)
  const paddedRows = rows.map((row) => ({ ...row, cells: pad(row.cells) }))

  return {
    name,
    headers: paddedHeaders,
    rows: paddedRows,
    suggestedTarget: suggestTarget(name, paddedHeaders),
    suggestedMappings: detectMappings(paddedHeaders, paddedRows),
    mappingRemembered: false,
    suggestedKind: suggestKind(name, paddedHeaders),
    suggestedCountry: suggestCountry(name, defaultCountry)
  }
}

/**
 * Reads a CSV file for the import dialog. The separator is detected; on a
 * tie the one of `locale` wins. `defaultCountry` is suggested unless the file
 * name says the list is international.
 */
export async function readImportFile(
  filePath: string,
  defaultCountry = 'DE',
  locale = 'de-DE'
): Promise<ImportFile> {
  const text = decodeCsv(await readFile(filePath))
  const fileName = basename(filePath)
  const name = basename(fileName, extname(fileName))
  return {
    fileName,
    table: importTable(name, parseCsv(text, csvSeparator(locale)), defaultCountry)
  }
}
