import { z } from 'zod'
import { DocumentDto, DocumentOwnerType, LinkableRecordType } from './document.schema'

// A document belongs to its owner (where the file lies) and can be linked to further records:
// the contract filed at the event is also the promoter's, its contact's and the festival's.
// The records a document can be linked to are LINKABLE_RECORD_TYPES (a release is not one).

/** One further record a document belongs to */
export const DocumentLinkDto = z.object({
  kind: DocumentOwnerType,
  id: z.number(),
  name: z.string(),
  /** The event's date, null for other records */
  date: z.string().nullable()
})
export type DocumentLinkDto = z.infer<typeof DocumentLinkDto>

export const DocumentLinksInput = z.object({ documentId: z.number().int().positive() })
export type DocumentLinksInput = z.infer<typeof DocumentLinksInput>

/** Link (linked: true) or unlink a document and a record */
export const SetDocumentLinkInput = z.object({
  documentId: z.number().int().positive(),
  kind: LinkableRecordType,
  id: z.number().int().positive(),
  linked: z.boolean()
})
export type SetDocumentLinkInput = z.infer<typeof SetDocumentLinkInput>

export const RelatedDocumentsInput = z.object({
  kind: DocumentOwnerType,
  id: z.number().int().positive()
})
export type RelatedDocumentsInput = z.infer<typeof RelatedDocumentsInput>

/**
 * A document of another record that concerns this one: linked to it, or filed at one of its
 * events (the promoter's, the contact's, the venue's). `source` is where the file lies.
 */
export const RelatedDocumentDto = DocumentDto.extend({
  via: z.enum(['linked', 'event']),
  source: DocumentLinkDto
})
export type RelatedDocumentDto = z.infer<typeof RelatedDocumentDto>

export const LinkTargetSearchInput = z.object({
  query: z.string().trim().min(1).max(100)
})
export type LinkTargetSearchInput = z.infer<typeof LinkTargetSearchInput>
