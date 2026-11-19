// Builds a small .xlsx in memory (a zip of the XML parts), so the import's Excel reader is tested
// against the real file format without a spreadsheet library.
import { deflateRawSync } from 'zlib'

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, 'utf-8')
    const data = deflateRawSync(raw)
    const nameBytes = Buffer.from(name, 'utf-8')
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

/** A cell: text (shared string), a number, or a date serial with the date style */
export type Cell = string | number | { date: number } | { zip: number } | null

/** A workbook with one sheet named `sheetName` holding `rows` */
export function buildXlsx(rows: Cell[][], sheetName = 'Tour'): Buffer {
  return buildXlsxSheets([{ name: sheetName, rows }])
}

/**
 * A workbook with several sheets in tab order. The parts are numbered against the tab order
 * (the last tab is sheet1.xml), as Excel does after sheets were moved, so readers must follow
 * the relationships.
 */
export function buildXlsxSheets(sheets: Array<{ name: string; rows: Cell[][] }>): Buffer {
  const strings: string[] = []
  // quotes too: the sheet name lands in an attribute
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  const col = (i: number) => String.fromCharCode(65 + i)
  const sheetXml = (rows: Cell[][]) =>
    rows
      .map((row, r) => {
        const cells = row
          .map((cell, c) => {
            const ref = `${col(c)}${r + 1}`
            if (cell === null) return ''
            if (typeof cell === 'string') {
              strings.push(cell)
              return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`
            }
            if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`
            if ('date' in cell) return `<c r="${ref}" s="1"><v>${cell.date}</v></c>`
            return `<c r="${ref}" s="2"><v>${cell.zip}</v></c>`
          })
          .join('')
        return `<row r="${r + 1}">${cells}</row>`
      })
      .join('')
  const part = (index: number) => sheets.length - index
  const files: Record<string, string> = {}
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${part(index)}.xml`] =
      `<?xml version="1.0"?><worksheet><sheetData>${sheetXml(sheet.rows)}</sheetData></worksheet>`
  })
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns:r="r"><sheets>${sheets
      .map(
        (sheet, index) =>
          `<sheet name="${esc(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
      )
      .join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships>${sheets
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="worksheet" Target="worksheets/sheet${part(index)}.xml"/>`
      )
      .join('')}</Relationships>`,
    ...files,
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`,
    'xl/styles.xml':
      '<?xml version="1.0"?><styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="00000"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>'
  })
}
