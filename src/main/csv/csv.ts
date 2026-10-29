// CSV the way Excel reads and writes it for the user's regional format: the
// separator is ';' where the decimal mark is ',' (de-DE, most of Europe) and
// ',' elsewhere. Files are written as UTF-8 with a BOM, which Excel needs to
// detect the encoding; reading also takes the ANSI files older Excel versions
// save and Excel's "Unicode text" (UTF-16, tab-separated).

export type CsvSeparator = ';' | ',' | '\t'

/** Byte order mark that tells Excel the file is UTF-8 */
export const CSV_BOM = '﻿'

/** The decimal mark of a locale; de-DE's when the locale is unknown */
export function decimalMark(locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(1.5)
    return parts.find((part) => part.type === 'decimal')?.value ?? '.'
  } catch {
    return ','
  }
}

/** The list separator Excel uses for a locale */
export function csvSeparator(locale: string): CsvSeparator {
  return decimalMark(locale) === ',' ? ';' : ','
}

function csvField(value: string): string {
  return /[",;\t\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Rows as CSV text, CRLF line ends (no BOM: prepend CSV_BOM for Excel) */
export function toCsv(rows: string[][], separator: CsvSeparator): string {
  return rows.map((row) => row.map(csvField).join(separator)).join('\r\n') + '\r\n'
}

/** File bytes as text: UTF-8 (with or without BOM), UTF-16 or Windows-1252 */
export function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** Separator of the first line (outside quotes); `fallback` on a tie */
export function detectSeparator(text: string, fallback: CsvSeparator): CsvSeparator {
  const counts: Record<CsvSeparator, number> = { ';': 0, ',': 0, '\t': 0 }
  let quoted = false
  for (const char of text) {
    if (char === '"') quoted = !quoted
    else if (!quoted && (char === '\n' || char === '\r')) break
    else if (!quoted && char in counts) counts[char as CsvSeparator]++
  }
  let best = fallback
  for (const separator of Object.keys(counts) as CsvSeparator[]) {
    if (counts[separator] > counts[best]) best = separator
  }
  return best
}

/**
 * Records of a CSV text (quoted fields may hold separators, quotes and line
 * breaks). An Excel "sep=;" first line sets the separator; otherwise it is
 * detected, `fallback` deciding a tie.
 */
export function parseCsv(text: string, fallback: CsvSeparator): string[][] {
  let body = text.startsWith(CSV_BOM) ? text.slice(1) : text
  let separator: CsvSeparator
  const hint = body.match(/^sep=([;,\t])\r?\n/i)
  if (hint) {
    separator = hint[1] as CsvSeparator
    body = body.slice(hint[0].length)
  } else {
    separator = detectSeparator(body, fallback)
  }

  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  let fieldStart = true
  for (let i = 0; i < body.length; i++) {
    const char = body[i]
    if (quoted) {
      if (char !== '"') field += char
      else if (body[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
    } else if (char === '"' && fieldStart) {
      quoted = true
      fieldStart = false
    } else if (char === separator) {
      record.push(field)
      field = ''
      fieldStart = true
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && body[i + 1] === '\n') i++
      record.push(field)
      records.push(record)
      record = []
      field = ''
      fieldStart = true
    } else {
      field += char
      fieldStart = false
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }
  return records
}
