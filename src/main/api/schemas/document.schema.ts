import { z } from 'zod'
import { createPaginatedResponse } from './base.schema'
import { t } from '../../i18n/translate'

/** Records documents can belong to ('event' = deal memo) */
/**
 * The records a document can also be linked to (document_link has a column for each) and that
 * follow-ups and appointments can be attached to.
 */
export const LINKABLE_RECORD_TYPES = ['event', 'band', 'company', 'venue', 'person'] as const
export const LinkableRecordType = z.enum(LINKABLE_RECORD_TYPES)
export type LinkableRecordType = z.infer<typeof LinkableRecordType>

export function isLinkableRecordType(kind: string): kind is LinkableRecordType {
  return (LINKABLE_RECORD_TYPES as readonly string[]).includes(kind)
}

/** #289: a release keeps its label copies as documents, but has no links, follow-ups or appointments */
export const DOCUMENT_OWNER_TYPES = [...LINKABLE_RECORD_TYPES, 'release'] as const
export const DocumentOwnerType = z.enum(DOCUMENT_OWNER_TYPES)
export type DocumentOwnerType = z.infer<typeof DocumentOwnerType>

export const DocumentType = z.enum([
  'deal_memo',
  'contract',
  'rider',
  'stage_plot',
  'press',
  'photo',
  'invoice',
  'deposit', // receipt or invoice of a prepayment (Vorkasse)
  'settlement', // show settlement, provided by the Veranstalter
  'label_copy', // #289: a release's label copy (PDF report or Excel template)
  'other'
])
export type DocumentType = z.infer<typeof DocumentType>

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  deal_memo: t('Deal Memo'),
  contract: t('Vertrag'),
  rider: t('Rider'),
  stage_plot: t('Stageplot'),
  press: t('Presse'),
  photo: t('Foto'),
  invoice: t('Rechnung'),
  deposit: t('Vorkasse'),
  settlement: t('Abrechnung'),
  label_copy: t('Labelcopy'),
  other: t('Sonstiges')
}

/**
 * Document DTO for list/detail views.
 */
export const DocumentDto = z.object({
  id: z.number(),
  ownerType: DocumentOwnerType,
  ownerId: z.number(),
  fileName: z.string(),
  /** The name the user gave it; null = the file name on disk is shown */
  displayName: z.string().nullable(),
  fileType: z.string(),
  // Relative to the storage folder
  filePath: z.string(),
  documentType: z.string(),
  fileSize: z.number(),
  uploadedAt: z.string(),
  uploadedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable()
})

export type DocumentDto = z.infer<typeof DocumentDto>

/** A document of one of a band's events (read-only on the band page) */
export const EventDocumentDto = DocumentDto.extend({
  eventName: z.string(),
  eventDate: z.string()
})

export type EventDocumentDto = z.infer<typeof EventDocumentDto>

export const PaginatedDocumentResponse = createPaginatedResponse(DocumentDto)
export type PaginatedDocumentResponse = z.infer<typeof PaginatedDocumentResponse>

export const DocumentOwnerInput = z.object({
  ownerType: DocumentOwnerType,
  ownerId: z.number()
})

export type DocumentOwnerInput = z.infer<typeof DocumentOwnerInput>

/**
 * Copies a local file into the owner's document folder and records it.
 */
export const UploadDocumentInput = DocumentOwnerInput.extend({
  sourcePath: z.string().min(1),
  documentType: DocumentType.default('other')
})

export type UploadDocumentInput = z.infer<typeof UploadDocumentInput>

/**
 * Input for updating a document.
 */
export const UpdateDocumentInput = z.object({
  id: z.number(),
  documentType: DocumentType.optional(),
  uploadedBy: z.string().optional(),
  /** A new name; null or empty clears it back to the file name */
  displayName: z.string().nullable().optional()
})

export type UpdateDocumentInput = z.infer<typeof UpdateDocumentInput>

/** Longest display name the lists can show without cutting the extension off */
export const DOCUMENT_DISPLAY_NAME_MAX = 120

/**
 * Cleans a name the user typed: trimmed, no path separators (it is not a path),
 * no control characters, and at most DOCUMENT_DISPLAY_NAME_MAX characters.
 * Returns null for a name that is empty after cleaning, so "clear" and "whitespace"
 * are the same thing.
 */
export function normalizeDisplayName(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '-')
    .trim()
    .slice(0, DOCUMENT_DISPLAY_NAME_MAX)
    .trim()
  return cleaned.length > 0 ? cleaned : null
}
