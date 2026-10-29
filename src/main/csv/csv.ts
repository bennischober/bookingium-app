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

// Windows-1252 bytes 0x80-0x9F; the rest is Latin-1. Node's TextDecoder
// decodes 'windows-1252' as Latin-1, so "€" and "„" would become control
// characters.
const WINDOWS_1252_HIGH =
  '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178'

function decodeWindows1252(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) {
    text += byte >= 0x80 && byte < 0xa0 ? WINDOWS_1252_HIGH[byte - 0x80] : String.fromCharCode(byte)
  }
  return text
}

/** The Windows-1252 bytes of a text, null when a character has none */
function encodeWindows1252(text: string): Uint8Array | null {
  const bytes: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const high = WINDOWS_1252_HIGH.indexOf(char)
    if (high >= 0) bytes.push(0x80 + high)
    else if (code < 0x100) bytes.push(code)
    else return null
  }
  return Uint8Array.from(bytes)
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
    return decodeWindows1252(bytes)
  }
}

/**
 * Undoes UTF-8 that was read as Windows-1252 and saved again ("StraÃŸe" ->
 * "Straße"), as Outlook's contact export does to its header row. Text that
 * isn't valid UTF-8 that way is returned unchanged.
 */
export function repairMojibake(value: string): string {
  // Only a UTF-8 lead byte read as 1252 (Â … ô) can start such a sequence
  if (!/[\u00c2-\u00f4]/.test(value)) return value
  const bytes = encodeWindows1252(value)
  if (!bytes) return value
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return value
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
