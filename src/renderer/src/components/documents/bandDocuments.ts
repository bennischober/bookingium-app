// D1: the pure half of the band's combined document view, so the filter logic is testable
// without a DOM (vitest runs in a node environment here).
import type { DocumentDto, EventDocumentDto } from '../../../../main/api/schemas/document.schema'

/** "Alle" is the default of both filters. Radix refuses an empty Select value, so the
 * sentinel is a real word rather than ''. */
export const ALL = 'all'

export type BandDocumentRow = {
  doc: DocumentDto | EventDocumentDto
  /** null for a document the band itself owns */
  event: { id: number; name: string; date: string } | null
}

/** The categories that actually occur, sorted by their German label */
export function categoriesOf(
  own: DocumentDto[],
  fromEvents: EventDocumentDto[],
  labels: Record<string, string>
): string[] {
  const present = new Set<string>()
  for (const doc of [...own, ...fromEvents]) present.add(doc.documentType)
  return [...present].sort((a, b) => {
    const left = labels[a] ?? a
    const right = labels[b] ?? b
    return left.localeCompare(right, 'de')
  })
}

/** The events that actually have documents, newest first - a filter over empty ones is noise */
export function eventsOf(
  fromEvents: EventDocumentDto[]
): { id: number; name: string; date: string }[] {
  const seen = new Map<number, { name: string; date: string }>()
  for (const doc of fromEvents) {
    if (!seen.has(doc.ownerId)) seen.set(doc.ownerId, { name: doc.eventName, date: doc.eventDate })
  }
  return [...seen.entries()]
    .sort((a, b) => b[1].date.localeCompare(a[1].date))
    .map(([id, event]) => ({ id, ...event }))
}

/**
 * One list: the band's own documents first, then its events' newest first, narrowed by the
 * category and event filters. An event filter hides the band's own documents, because they do
 * not belong to that gig.
 */
export function rowsOf(
  own: DocumentDto[],
  fromEvents: EventDocumentDto[],
  filters: { category?: string; eventId?: string } = {}
): BandDocumentRow[] {
  const category = filters.category ?? ALL
  const eventId = filters.eventId ?? ALL
  const matchesCategory = (doc: DocumentDto | EventDocumentDto): boolean =>
    category === ALL || doc.documentType === category

  // A band's own document does not belong to any gig, so an event filter hides it. The
  // event rows carry the filter on their owner id instead.
  const ownRows: BandDocumentRow[] =
    eventId === ALL ? own.filter(matchesCategory).map((doc) => ({ doc, event: null })) : []
  const eventRows: BandDocumentRow[] = fromEvents
    .filter(matchesCategory)
    .filter((doc) => eventId === ALL || String(doc.ownerId) === eventId)
    .map((doc) => ({
      doc,
      event: { id: doc.ownerId, name: doc.eventName, date: doc.eventDate }
    }))

  return [...ownRows, ...eventRows]
}
