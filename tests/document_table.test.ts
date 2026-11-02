// The pure half of the shared document table: order by column and German formatting.
import { describe, it, expect } from 'vitest'
import { DOCUMENT_TYPE_LABELS } from '../src/main/api/schemas/document.schema'
import {
  DEFAULT_DOCUMENT_SORT,
  formatFileSize,
  nextDocumentSort,
  sortDocuments,
  type DocumentSort
} from '../src/renderer/src/components/documents/documentSort'

type Row = {
  doc: {
    fileName: string
    documentType: string
    fileSize: number
    uploadedAt: string
  }
}

const row = (
  fileName: string,
  documentType: string,
  fileSize: number,
  uploadedAt: string
): Row => ({ doc: { fileName, documentType, fileSize, uploadedAt } })

const names = (rows: Row[]): string[] => rows.map((entry) => entry.doc.fileName)

// Newest first, the order the repository delivers and the table opens with
const rows: Row[] = [
  row('scan_0042.pdf', 'other', 512, '2026-03-02 10:00:00'),
  row('Vertrag März.pdf', 'contract', 1_572_864, '2026-03-01 10:00:00'),
  row('rider_2.pdf', 'rider', 2_048, '2026-02-01 10:00:00'),
  row('rider_10.pdf', 'rider', 1_048_576, '2026-01-01 10:00:00')
]

describe('the default order', () => {
  it('is newest first', () => {
    expect(DEFAULT_DOCUMENT_SORT).toEqual({ key: 'uploadedAt', desc: true })
    expect(names(sortDocuments(rows, DEFAULT_DOCUMENT_SORT, DOCUMENT_TYPE_LABELS))).toEqual([
      'scan_0042.pdf',
      'Vertrag März.pdf',
      'rider_2.pdf',
      'rider_10.pdf'
    ])
  })

  it('does not mutate the rows it was given', () => {
    const before = names(rows)
    sortDocuments(rows, { key: 'name', desc: false }, DOCUMENT_TYPE_LABELS)
    expect(names(rows)).toEqual(before)
  })
})

describe('sorting by a header', () => {
  it('orders names the German way, with numbers read as numbers', () => {
    expect(names(sortDocuments(rows, { key: 'name', desc: false }, DOCUMENT_TYPE_LABELS))).toEqual([
      'rider_2.pdf',
      'rider_10.pdf',
      'scan_0042.pdf',
      'Vertrag März.pdf'
    ])
  })

  it('orders types by their German label, not the stored value', () => {
    // Alphabetically by label: Rider < Sonstiges < Vertrag. By stored value it would be
    // contract < other < rider, so "Vertrag" would come first - this pins the label order.
    expect(names(sortDocuments(rows, { key: 'type', desc: false }, DOCUMENT_TYPE_LABELS))).toEqual([
      'rider_2.pdf',
      'rider_10.pdf',
      'scan_0042.pdf',
      'Vertrag März.pdf'
    ])
  })

  it('orders sizes numerically and can reverse them', () => {
    expect(names(sortDocuments(rows, { key: 'size', desc: false }, DOCUMENT_TYPE_LABELS))).toEqual([
      'scan_0042.pdf',
      'rider_2.pdf',
      'rider_10.pdf',
      'Vertrag März.pdf'
    ])
    expect(names(sortDocuments(rows, { key: 'size', desc: true }, DOCUMENT_TYPE_LABELS))).toEqual([
      'Vertrag März.pdf',
      'rider_10.pdf',
      'rider_2.pdf',
      'scan_0042.pdf'
    ])
  })
})

describe('clicking a header', () => {
  it('flips the current column and starts a new one ascending', () => {
    const current: DocumentSort = { key: 'uploadedAt', desc: true }
    expect(nextDocumentSort(current, 'uploadedAt')).toEqual({ key: 'uploadedAt', desc: false })
    expect(nextDocumentSort(current, 'name')).toEqual({ key: 'name', desc: false })
    expect(nextDocumentSort({ key: 'name', desc: false }, 'name')).toEqual({
      key: 'name',
      desc: true
    })
  })
})

describe('file sizes', () => {
  it('use the German decimal comma and no trailing zero', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(1_572_864)).toBe('1,5 MB')
    expect(formatFileSize(2_048)).toBe('2 KB')
    expect(formatFileSize(1_048_576)).toBe('1 MB')
    expect(formatFileSize(1_073_741_824)).toBe('1 GB')
  })
})
