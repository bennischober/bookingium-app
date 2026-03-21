import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { DocumentService } from '../../services/DocumentService'
import { DocumentMapper } from '../mappers/document.mapper'
import { CreateDocumentInput, UpdateDocumentInput } from '../schemas/document.schema'
import { deleteDocumentFile, getDocumentFullPath } from '../../utils/fileStorage'

const t = initTRPC.create()
const documentService = container.resolve(DocumentService)

export const documentRouter = t.router({
  /**
   * Get all documents for a specific deal memo/event.
   */
  getByDealMemoId: t.procedure.input(z.number()).query(async ({ input }) => {
    const documents = await documentService.getByDealMemoId(input)
    return DocumentMapper.toDtoList(documents)
  }),

  /**
   * Get a specific document by ID.
   */
  getById: t.procedure.input(z.number()).query(async ({ input }) => {
    const document = await documentService.getById(input)
    if (!document) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' })
    }
    return DocumentMapper.toDto(document)
  }),

  /**
   * Create a document record after a file has been uploaded/copied.
   * The file should already exist at the specified filePath.
   */
  create: t.procedure
    .input(CreateDocumentInput)
    .mutation(async ({ input }) => {
      // Validate that the file exists before creating the database record
      try {
        await getDocumentFullPath(input.filePath)
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid file path'
        })
      }

      const document = await documentService.createDocument(input)
      return DocumentMapper.toDto(document)
    }),

  /**
   * Update document metadata (e.g., document type, uploaded_by).
   */
  update: t.procedure
    .input(UpdateDocumentInput)
    .mutation(async ({ input }) => {
      const document = await documentService.updateDocument(input)
      return DocumentMapper.toDto(document)
    }),

  /**
   * Delete a document (both the file and the database record).
   */
  delete: t.procedure
    .input(z.number())
    .mutation(async ({ input: documentId }) => {
      const document = await documentService.getById(documentId)
      if (!document) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' })
      }

      // Delete the physical file
      try {
        await deleteDocumentFile(document.file_path)
      } catch (error) {
        console.error(`Failed to delete file for document ${documentId}:`, error)
        // Don't throw - the DB record should still be deleted even if file deletion fails
      }

      // Delete the database record
      await documentService.deleteDocument(documentId)
    }),

  /**
   * Get the full path of a document file for download.
   * Returns the full file system path; the renderer should request the file through IPC.
   */
  getFilePath: t.procedure
    .input(z.number())
    .query(async ({ input: documentId }) => {
      const document = await documentService.getById(documentId)
      if (!document) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' })
      }

      try {
        const fullPath = await getDocumentFullPath(document.file_path)
        return { filePath: fullPath, fileName: document.file_name }
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get file path'
        })
      }
    })
})
