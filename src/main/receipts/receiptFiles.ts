// Receipt files (#225): what a dropped or mailed file is, photos turned into a PDF page, and
// the name DATEV shows. No Electron; pdf-lib for the image page.
import { PDFDocument } from 'pdf-lib'

export type ReceiptFileKind = 'pdf' | 'xml' | 'jpeg' | 'png'

/** The kind by the file's first bytes (the name may lie), null for anything else */
export function receiptFileKind(bytes: Uint8Array): ReceiptFileKind | null {
  const starts = (...values: number[]): boolean => values.every((v, i) => bytes[i] === v)
  if (starts(0x25, 0x50, 0x44, 0x46)) return 'pdf'
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png'
  if (starts(0xff, 0xd8, 0xff)) return 'jpeg'
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, 512))
    .replace(/^\uFEFF/, '')
    .trimStart()
  return head.startsWith('<') ? 'xml' : null
}

export const RECEIPT_CONTENT_TYPES: Record<'pdf' | 'xml', string> = {
  pdf: 'application/pdf',
  xml: 'application/xml'
}

// A4 in PDF points; photos are scaled to fit inside the margin, never enlarged
const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 28

/** A photo of a paper receipt as a one-page A4 PDF */
export async function imageToPdf(bytes: Uint8Array, kind: 'jpeg' | 'png'): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const image = kind === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
  // Landscape photos get a landscape page
  const landscape = image.width > image.height
  const page = landscape ? doc.addPage([A4.height, A4.width]) : doc.addPage([A4.width, A4.height])
  const { width, height } = page.getSize()
  const scale = Math.min(
    (width - 2 * MARGIN) / image.width,
    (height - 2 * MARGIN) / image.height,
    1
  )
  const drawn = { width: image.width * scale, height: image.height * scale }
  page.drawImage(image, {
    x: (width - drawn.width) / 2,
    y: (height - drawn.height) / 2,
    ...drawn
  })
  return doc.save()
}

// Characters Windows refuses in a file name, control characters included
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]+/g

/**
 * A file name as typed, made safe: no path parts or characters Windows refuses, at most 120
 * characters, and the extension of the stored file ("Hotel März" → "Hotel März.pdf")
 */
export function receiptFileName(typed: string, extension: 'pdf' | 'xml'): string {
  const base = typed
    .replace(/\.(pdf|xml|jpe?g|png)$/i, '')
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 120)
    .trim()
  return `${base || 'Beleg'}.${extension}`
}

/** "2026-11-03 Hotel Beispiel Kreditkartenbeleg": date, supplier and category */
export function suggestReceiptName(input: {
  receiptDate: string | null
  supplierName: string
  categoryLabel: string
  reference?: string
}): string {
  return [input.receiptDate ?? '', input.supplierName, input.reference ?? '', input.categoryLabel]
    .map((part) => part.replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
}
