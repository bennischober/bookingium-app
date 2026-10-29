import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { z } from 'zod'
import { shell } from 'electron'
import { DocumentService } from '../../services/DocumentService'
import { mailClient } from '../../mailclient/MailClientService'
import { DocumentMapper } from '../mappers/document.mapper'
import {
  DocumentOwnerInput,
  UpdateDocumentInput,
  UploadDocumentInput
} from '../schemas/document.schema'

const t = initTRPC.create()
const documentService = container.resolve(DocumentService)

const badRequest = (error: unknown, fallback: string) =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: error instanceof Error ? error.message : fallback
  })

export const documentRouter = t.router({
  /** Documents of one record (event, band, company, venue, person) */
  listByOwner: t.procedure.input(DocumentOwnerInput).query(async ({ input }) => {
    const documents = await documentService.listByOwner(input.ownerType, input.ownerId)
    return DocumentMapper.toDtoList(documents)
  }),

  /** Documents of a band's events, for the band's Dokumente tab */
  listEventDocumentsForBand: t.procedure.input(z.number()).query(async ({ input }) => {
    const documents = await documentService.listEventDocumentsForBand(input)
    return documents.map((doc) => ({
      ...DocumentMapper.toDto(doc),
      eventName: doc.eventName,
      eventDate: doc.eventDate
    }))
  }),

  getById: t.procedure.input(z.number()).query(async ({ input }) => {
    const document = await documentService.getById(input)
    if (!document) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' })
    }
    return DocumentMapper.toDto(document)
  }),

  /** Copies a local file into the owner's folder and records it */
  upload: t.procedure.input(UploadDocumentInput).mutation(async ({ input }) => {
    try {
      return DocumentMapper.toDto(await documentService.upload(input))
    } catch (error) {
      throw badRequest(error, 'Upload fehlgeschlagen')
    }
  }),

  /**
   * C5: an attachment of a mail becomes a document of a record. The bytes come from the
   * mail store, so the record and the type are all the caller chooses.
   */
  saveFromMail: t.procedure
    .input(
      DocumentOwnerInput.extend({
        mailAccountId: z.string().min(1),
        messageId: z.number().int().positive(),
        partId: z.string().min(1),
        filename: z.string(),
        /** the mail's Message-ID, for the origin column */
        mailMessageId: z.string().nullable().optional(),
        documentType: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      try {
        const bytes = (await mailClient.call('getAttachment', [
          input.messageId,
          input.partId,
          input.mailAccountId
        ])) as Uint8Array
        const saved = await documentService.saveFromMail({
          ownerType: input.ownerType,
          ownerId: input.ownerId,
          fileName: input.filename,
          documentType: input.documentType,
          bytes,
          messageId: input.mailMessageId ?? null,
          mailAccountId: input.mailAccountId
        })
        return DocumentMapper.toDto(saved)
      } catch (error) {
        throw badRequest(error, 'Anhang konnte nicht als Dokument gespeichert werden')
      }
    }),

  /**
   * Update document metadata (e.g., document type, uploaded_by).
   */
  update: t.procedure.input(UpdateDocumentInput).mutation(async ({ input }) => {
    const document = await documentService.updateDocument(input)
    return DocumentMapper.toDto(document)
  }),

  /**
   * Delete a document: its file goes to the OS trash (recoverable), then the record is removed.
   * A file that is already gone is no error - the record still goes.
   */
  delete: t.procedure.input(z.number()).mutation(async ({ input: documentId }) => {
    const found = await documentService.detachFileForTrash(documentId)
    if (!found) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' })
    }
    if (found.filePath) {
      try {
        await shell.trashItem(found.filePath)
      } catch (error) {
        throw badRequest(error, 'Datei konnte nicht in den Papierkorb verschoben werden')
      }
    }
    await documentService.deleteDocumentRecord(documentId)
  }),

  /** Opens the owner's document folder in the file manager */
  openOwnerFolder: t.procedure.input(DocumentOwnerInput).mutation(async ({ input }) => {
    try {
      const folder = await documentService.ownerFolder(input.ownerType, input.ownerId)
      const error = await shell.openPath(folder)
      if (error) throw new Error(error)
    } catch (error) {
      throw badRequest(error, 'Ordner konnte nicht geöffnet werden')
    }
  }),

  /**
   * Get the full path of a document file for download.
   * Returns the full file system path; the renderer should request the file through IPC.
   */
  getFilePath: t.procedure.input(z.number()).query(async ({ input: documentId }) => {
    const result = await documentService.getFullPath(documentId)
    if (!result) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' })
    }
    return result
  })
})
