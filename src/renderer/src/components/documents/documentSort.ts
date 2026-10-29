// The pure half of the shared document table, so the order is testable without a DOM
// (vitest runs in a node environment here).
import type { DocumentDto } from '../../../../main/api/schemas/document.schema'

/** The columns the table can be sorted by; `source` and the actions are not sortable */
export type DocumentSortKey = 'name' | 'type' | 'size' | 'uploadedAt'

export type DocumentSort = { key: DocumentSortKey; desc: boolean }

/** Newest first: the order the list shows before the user picks a column */
export const DEFAULT_DOCUMENT_SORT: DocumentSort = { key: 'uploadedAt', desc: true }

type SortableDocument = Pick<DocumentDto, 'fileName' | 'documentType' | 'fileSize' | 'uploadedAt'>

/** German labels decide the type order ("Vertrag" before "Sonstiges"), not the stored value */
function typeLabel(document: SortableDocument, labels: Record<string, string>): string {
  return labels[document.documentType] ?? document.documentType
}

function compare(
  left: SortableDocument,
  right: SortableDocument,
  key: DocumentSortKey,
  labels: Record<string, string>
): number {
  switch (key) {
    case 'name':
      return left.fileName.localeCompare(right.fileName, 'de', { numeric: true })
    case 'type':
      return typeLabel(left, labels).localeCompare(typeLabel(right, labels), 'de')
    case 'size':
      return left.fileSize - right.fileSize
    case 'uploadedAt':
      return left.uploadedAt.localeCompare(right.uploadedAt)
  }
}

/**
 * Sorts a copy of the rows. Ties keep their incoming order (the repository's newest
 * first), so equal upload dates do not shuffle between renders.
 */
export function sortDocuments<T extends { doc: SortableDocument }>(
  rows: T[],
  sort: DocumentSort,
  labels: Record<string, string>
): T[] {
  const direction = sort.desc ? -1 : 1
  return [...rows].sort((a, b) => direction * compare(a.doc, b.doc, sort.key, labels))
}

/** The next sort state when a header is clicked: same column flips, a new one starts ascending */
export function nextDocumentSort(current: DocumentSort, key: DocumentSortKey): DocumentSort {
  return current.key === key ? { key, desc: !current.desc } : { key, desc: false }
}

/** "1,5 MB" / "512 B" - German decimal comma, no trailing ".0" */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  // Whole bytes have no fraction; everything else keeps at most one decimal
  const maximumFractionDigits = unitIndex === 0 ? 0 : 1
  return `${size.toLocaleString('de-DE', { maximumFractionDigits })} ${units[unitIndex]}`
}
