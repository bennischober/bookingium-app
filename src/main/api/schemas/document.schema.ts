import { z } from 'zod'
import { createPaginatedResponse } from './base.schema'

export const DocumentType = z.enum(['deal_memo', 'contract', 'rider', 'invoice', 'other'])
export type DocumentType = z.infer<typeof DocumentType>

/**
 * Document DTO for list/detail views.
 */
export const DocumentDto = z.object({
  id: z.number(),
  dealMemoId: z.number(),
  fileName: z.string(),
  fileType: z.string(),
  filePath: z.string(),
  documentType: z.string(),
  fileSize: z.number(),
  uploadedAt: z.string(),
  uploadedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable()
})

export type DocumentDto = z.infer<typeof DocumentDto>

export const PaginatedDocumentResponse = createPaginatedResponse(DocumentDto)
export type PaginatedDocumentResponse = z.infer<typeof PaginatedDocumentResponse>

/**
 * Input for creating a document.
 * The file itself is handled separately via the file upload endpoint.
 */
export const CreateDocumentInput = z.object({
  dealMemoId: z.number(),
  fileName: z.string().min(1),
  fileType: z.string(),
  filePath: z.string(),
  documentType: DocumentType.default('other'),
  fileSize: z.number().positive(),
  uploadedBy: z.string().optional()
})

export type CreateDocumentInput = z.infer<typeof CreateDocumentInput>

/**
 * Input for updating a document.
 */
export const UpdateDocumentInput = z.object({
  id: z.number(),
  documentType: DocumentType.optional(),
  uploadedBy: z.string().optional()
})

export type UpdateDocumentInput = z.infer<typeof UpdateDocumentInput>
