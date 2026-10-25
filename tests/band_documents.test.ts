// D1: the pure half of the band's combined document view - what the two filters keep.
// The e2e asserts that both filters are usable, but Radix animates its popup, which makes
// an e2e click on an option flaky; the narrowing itself is proven here.
import { describe, expect, it } from 'vitest'
import {
  ALL,
  categoriesOf,
  eventsOf,
  rowsOf,
  type BandDocumentRow
} from '../src/renderer/src/components/documents/bandDocuments'
import { DOCUMENT_TYPE_LABELS } from '../src/main/api/schemas/document.schema'
import type { DocumentDto, EventDocumentDto } from '../src/main/api/schemas/document.schema'

const own = (id: number, fileName: string, documentType: string): DocumentDto =>
  ({
    id,
    ownerType: 'band',
    ownerId: 1,
    fileName,
    fileType: 'pdf',
    filePath: `documents/bands/1/\\${fileName}`,
    documentType,
    fileSize: 10,
    uploadedAt: '2026-01-01',
    uploadedBy: null,
    sourceMessageId: null,
    sourceMailAccountId: null
  }) as unknown as DocumentDto

const fromEvent = (
  id: number,
  eventId: number,
  fileName: string,
  documentType: string,
  eventDate = '2026-06-11'
): EventDocumentDto =>
  ({
    ...own(id, fileName, documentType),
    ownerType: 'event',
    ownerId: eventId,
    eventName: `Gig ${eventId}`,
    eventDate
  }) as unknown as EventDocumentDto

const labels = (rows: BandDocumentRow[]): string[] =>
  rows.map((row) => (row.doc as { fileName: string }).fileName)

describe('D1: the band documents view combines both sources', () => {
  const bandOwn = [own(1, 'Rider.pdf', 'rider'), own(2, 'Vertrag.pdf', 'contract')]
  const eventDocs = [
    fromEvent(10, 7, 'Settlement.pdf', 'settlement', '2026-06-11'),
    fromEvent(11, 8, 'Berlin Rider.pdf', 'rider', '2026-08-01')
  ]

  it('shows the band documents first, then its events', () => {
    expect(labels(rowsOf(bandOwn, eventDocs))).toEqual([
      'Rider.pdf',
      'Vertrag.pdf',
      'Settlement.pdf',
      'Berlin Rider.pdf'
    ])
  })

  it('marks where each row comes from', () => {
    const rows = rowsOf(bandOwn, eventDocs)
    // The band's own documents carry no event
    expect(rows[0].event).toBeNull()
    expect(rows[2].event).toMatchObject({ id: 7, name: 'Gig 7', date: '2026-06-11' })
  })

  it('narrows by category across both sources', () => {
    const riders = rowsOf(bandOwn, eventDocs, { category: 'rider' })
    expect(labels(riders)).toEqual(['Rider.pdf', 'Berlin Rider.pdf'])
  })

  it('narrows to one event, which hides the band own documents', () => {
    // A band document does not belong to a gig, so an event filter must not list it
    const oneGig = rowsOf(bandOwn, eventDocs, { eventId: '8' })
    expect(labels(oneGig)).toEqual(['Berlin Rider.pdf'])
    expect(oneGig[0].event?.id).toBe(8)
  })

  it('combines both filters', () => {
    expect(labels(rowsOf(bandOwn, eventDocs, { category: 'rider', eventId: '8' }))).toEqual([
      'Berlin Rider.pdf'
    ])
    // A category that only the band has, with an event filter: nothing
    expect(rowsOf(bandOwn, eventDocs, { category: 'contract', eventId: '7' })).toHaveLength(0)
  })

  it('offers only the categories that occur, sorted by their German label', () => {
    const categories = categoriesOf(bandOwn, eventDocs, DOCUMENT_TYPE_LABELS)
    // Abrechnung, Rider, Vertrag - alphabetical by German label, not by the stored key
    expect(categories).toEqual(['settlement', 'rider', 'contract'])
    expect(
      categories.map((c) => DOCUMENT_TYPE_LABELS[c as keyof typeof DOCUMENT_TYPE_LABELS])
    ).toEqual(['Abrechnung', 'Rider', 'Vertrag'])
  })

  it('offers only the events that have documents, newest first', () => {
    const events = eventsOf(eventDocs)
    expect(events).toEqual([
      { id: 8, name: 'Gig 8', date: '2026-08-01' },
      { id: 7, name: 'Gig 7', date: '2026-06-11' }
    ])
  })

  it('defaults to everything', () => {
    expect(rowsOf(bandOwn, eventDocs, {})).toHaveLength(4)
    expect(rowsOf(bandOwn, eventDocs, { category: ALL, eventId: ALL })).toHaveLength(4)
  })

  it('shows nothing when the band has no documents at all', () => {
    expect(rowsOf([], [])).toHaveLength(0)
    expect(categoriesOf([], [], DOCUMENT_TYPE_LABELS)).toEqual([])
    expect(eventsOf([])).toEqual([])
  })
})
