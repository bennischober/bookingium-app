import { basename } from 'path'
import ExcelJS from 'exceljs'
import type { ImportRow, ImportSheet, ImportWorkbook } from '../api/schemas/import.schema'
import { detectMapping, suggestCountry, suggestKind } from './detectMapping'

/** Text of a cell as the user sees it; dates as dd.mm.yyyy */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    const day = String(value.getUTCDate()).padStart(2, '0')
    const month = String(value.getUTCMonth() + 1).padStart(2, '0')
    return `${day}.${month}.${value.getUTCFullYear()}`
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return value
  if ('richText' in value) return value.richText.map((part) => part.text).join('')
  if ('hyperlink' in value) {
    const text = value.text as unknown as ExcelJS.CellValue
    return cellText(text) || value.hyperlink.replace(/^mailto:/i, '')
  }
  if ('formula' in value || 'sharedFormula' in value) {
    return cellText((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue)
  }
  // Error values (#N/A …)
  return ''
}

function readSheet(worksheet: ExcelJS.Worksheet, defaultCountry: string): ImportSheet | null {
  const rows: ImportRow[] = []
  let headers: string[] | null = null
  let width = 0

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = []
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cells[column - 1] = cellText(cell.value).trim()
    })
    const filled = Array.from(cells, (cell) => cell ?? '')
    if (filled.every((cell) => cell === '')) return
    width = Math.max(width, filled.length)
    if (headers === null) headers = filled
    else rows.push({ rowNumber, cells: filled })
  })

  if (headers === null || rows.length === 0) return null
  const headerRow: string[] = headers
  const pad = (cells: string[]): string[] =>
    Array.from({ length: width }, (_, index) => cells[index] ?? '')
  const paddedHeaders = pad(headerRow)
  const paddedRows = rows.map((row) => ({ ...row, cells: pad(row.cells) }))

  return {
    name: worksheet.name,
    headers: paddedHeaders,
    rows: paddedRows,
    suggestedMapping: detectMapping(paddedHeaders, paddedRows),
    suggestedKind: suggestKind(worksheet.name, paddedHeaders),
    suggestedCountry: suggestCountry(worksheet.name, defaultCountry)
  }
}

/**
 * Sheets with a header row and at least one data row; `defaultCountry` is
 * suggested for domestic sheets
 */
export async function readWorkbook(
  filePath: string,
  defaultCountry = 'DE'
): Promise<ImportWorkbook> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const sheets: ImportSheet[] = []
  workbook.eachSheet((worksheet) => {
    if (worksheet.state !== 'visible') return
    const sheet = readSheet(worksheet, defaultCountry)
    if (sheet) sheets.push(sheet)
  })
  return { fileName: basename(filePath), sheets }
}
