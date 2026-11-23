// ========================================
// The text of a show file
// ========================================
// PDF, mail (.eml), Word (.docx), Pages (its preview PDF) and plain text. Everything else (old
// .doc and .xls, images) has no text here: it can be filed, but nothing is read from it.
// No Electron: the archive import and tests use it directly.
import { simpleParser } from 'mailparser'
import { decodeXml } from '../import/xlsx'
import { zipEntries, zipPart } from '../import/zip'

export type FileText = { text: string; links: string[] }

const NONE: FileText = { text: '', links: [] }

type TextItem = { str?: string; hasEOL?: boolean }

/** A PDF's text and its link targets (mailto: and web links survive broken ligatures) */
export async function pdfText(bytes: Uint8Array): Promise<FileText> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0
    })
    const pdf = await task.promise
    const pages: string[] = []
    const links: string[] = []
    for (let number = 1; number <= Math.min(pdf.numPages, 10); number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      pages.push(
        (content.items as TextItem[])
          .map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : ' '))
          .join('')
      )
      for (const annotation of (await page.getAnnotations()) as Array<{ url?: string }>)
        if (annotation.url) links.push(annotation.url)
    }
    await task.destroy()
    return { text: pages.join('\n'), links }
  } catch {
    return NONE
  }
}

/** A mail as text: the header lines the extraction reads ("Von:", "An:"), then the body */
export async function mailText(bytes: Buffer): Promise<FileText> {
  try {
    const mail = await simpleParser(bytes)
    const addresses = (value: typeof mail.to): string =>
      (Array.isArray(value) ? value : value ? [value] : []).map((entry) => entry.text).join(', ')
    const header = [
      mail.from ? `Von: ${mail.from.text}` : '',
      mail.to ? `An: ${addresses(mail.to)}` : '',
      mail.subject ? `Betreff: ${mail.subject}` : ''
    ].filter(Boolean)
    const links = [...(mail.text ?? '').matchAll(/mailto:[^\s>"]+/gi)].map((match) => match[0])
    return { text: [...header, '', mail.text ?? ''].join('\n'), links }
  } catch {
    return NONE
  }
}

/** A Word document's paragraphs, one per line (word/document.xml) */
export function docxText(bytes: Buffer): FileText {
  try {
    const entries = zipEntries(bytes)
    const xml = zipPart(bytes, entries, 'word/document.xml')?.toString('utf-8')
    if (!xml) return NONE
    const text = docxBody(xml)
    const links = [...xml.matchAll(/mailto:[^"<\s]+/g)].map((match) => match[0])
    return { text, links }
  } catch {
    return NONE
  }
}

/**
 * The text of word/document.xml. Only the text runs (<w:t>) are taken, paragraph by paragraph;
 * markup is never "stripped", so nothing of it can be left behind in the text. A table row is one
 * line: a label cell beside its value reads "Label: value" (info sheets laid out as tables), other
 * rows keep their cells apart by spaces, as a PDF does ("18:35 – 19:50   Beispielband").
 */
function docxBody(xml: string): string {
  const paragraphs = (part: string): string[] =>
    part
      .split(/<\/w:p>/)
      // what follows the last paragraph is none
      .filter((piece, at, all) => at < all.length - 1 || /<w:t[\s>]/.test(piece))
      .map((paragraph) =>
        [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br)\s*\/>/g)]
          .map((match) =>
            match[2] === 'tab' ? '\t' : match[2] === 'br' ? '\n' : decodeXml(match[1])
          )
          .join('')
      )
      .map((line) => line.trim())
  const lines: string[] = []
  // tables are not nested in the sheets read here; a nested one is read as plain paragraphs
  for (const [index, part] of xml.split(/<w:tbl>|<\/w:tbl>/).entries()) {
    if (index % 2 === 0) {
      lines.push(...paragraphs(part))
      continue
    }
    for (const row of part.split(/<\/w:tr>/)) {
      const cells = row
        .split(/<\/w:tc>/)
        .map((cell) => paragraphs(cell).filter(Boolean))
        .filter((cell, at, all) => cell.length > 0 || at < all.length - 1)
      const filled = cells.filter((cell) => cell.length > 0)
      if (filled.length === 0) continue
      const [first, second] = cells
      const isLabel =
        cells.length === 2 &&
        first.length === 1 &&
        first[0].length <= 40 &&
        /\p{L}/u.test(first[0]) &&
        !/^\d/.test(first[0]) &&
        !/:$/.test(first[0])
      if (isLabel && second.length > 0) {
        lines.push(`${first[0]}: ${second[0]}`, ...second.slice(1))
      } else if (isLabel) {
        lines.push(first[0])
      } else {
        lines.push(filled.map((cell) => cell.join(' ')).join('   '))
      }
    }
  }
  return lines.join('\n')
}

/** A Pages document: the preview PDF it carries (older versions), else nothing */
export async function pagesText(bytes: Buffer): Promise<FileText> {
  try {
    const entries = zipEntries(bytes)
    for (const name of ['QuickLook/Preview.pdf', 'preview.pdf', 'Preview.pdf']) {
      const pdf = zipPart(bytes, entries, name)
      if (pdf) return pdfText(pdf)
    }
    return NONE
  } catch {
    return NONE
  }
}

/** The text of a file by its extension; '' for formats that are not read */
export async function fileText(extension: string, bytes: Buffer): Promise<FileText> {
  switch (extension) {
    case '.pdf':
      return pdfText(bytes)
    case '.eml':
      return mailText(bytes)
    case '.docx':
      return docxText(bytes)
    case '.pages':
      return pagesText(bytes)
    case '.txt':
      return { text: bytes.toString('utf-8'), links: [] }
    default:
      return NONE
  }
}
