import type { DocumentDto, DocumentOwnerType } from '../../../../main/api/schemas/document.schema'
import type {
  DocumentLinkDto,
  RelatedDocumentDto
} from '../../../../main/api/schemas/document_link.schema'
import { formatShortDate } from '@/lib/utils'
import { t } from '../../../../main/i18n/translate'
import { shownName } from './documentSort'

// Documents linked to further records ("Zuordnen") and the list of documents that concern a
// record (Verträge & Dokumente). Pure, so vitest covers it.

export const LINK_KIND_LABELS: Record<DocumentOwnerType, string> = {
  event: t('Event'),
  band: t('Band'),
  company: t('Firma'),
  venue: t('Club / Festival'),
  person: t('Person')
}

/** "14.11.26 Show" for an event, the name for anything else */
export function linkLabel(link: Pick<DocumentLinkDto, 'name' | 'date'>): string {
  return link.date ? `${formatShortDate(link.date)} ${link.name}` : link.name
}

/** File types "Vertrag einlesen" reads */
const READABLE = /\.(pdf|txt|eml)$/i

/** A contract filed at an event, in a format the import reads */
export function isReadableContract(
  doc: Pick<DocumentDto, 'ownerType' | 'documentType' | 'fileName'>
): boolean {
  return doc.ownerType === 'event' && doc.documentType === 'contract' && READABLE.test(doc.fileName)
}

/** A file name that says it is a contract ("Gastspielvertrag …", "Contract …") */
export function looksLikeContract(fileName: string): boolean {
  return /vertrag|contract|agreement|gastspiel/i.test(fileName) && READABLE.test(fileName)
}

export const ALL = '__all__'

/** Contracts first: what the list is mostly opened for */
export function relatedCategories(rows: RelatedDocumentDto[]): string[] {
  const types = [...new Set(rows.map((row) => row.documentType))]
  return types.sort((a, b) => (a === 'contract' ? -1 : b === 'contract' ? 1 : a.localeCompare(b)))
}

/** Every word of the search is in the file's name or where it lies; the category matches */
export function filterRelated(
  rows: RelatedDocumentDto[],
  filter: { search: string; category: string }
): RelatedDocumentDto[] {
  const words = filter.search.toLowerCase().split(/\s+/).filter(Boolean)
  return rows.filter((row) => {
    if (filter.category !== ALL && row.documentType !== filter.category) return false
    const haystack = `${shownName(row)} ${row.fileName} ${linkLabel(row.source)}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}
