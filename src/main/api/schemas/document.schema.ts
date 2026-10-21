import { z } from 'zod'
import { createPaginatedResponse } from './base.schema'

/** Records documents can belong to ('event' = deal memo) */
export const DOCUMENT_OWNER_TYPES = ['event', 'band', 'company', 'venue', 'person'] as const
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
  'settlement', // show settlement, provided by the Veranstalter
  'other'
])
export type DocumentType = z.infer<typeof DocumentType>

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  deal_memo: 'Deal Memo',
  contract: 'Vertrag',
  rider: 'Rider',
  stage_plot: 'Stageplot',
  press: 'Presse',
  photo: 'Foto',
  invoice: 'Rechnung',
  settlement: 'Abrechnung',
  other: 'Sonstiges'
}

/**
 * Document DTO for list/detail views.
 */
export const DocumentDto = z.object({
  id: z.number(),
  ownerType: DocumentOwnerType,
  ownerId: z.number(),
  fileName: z.string(),
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
  uploadedBy: z.string().optional()
})

export type UpdateDocumentInput = z.infer<typeof UpdateDocumentInput>
