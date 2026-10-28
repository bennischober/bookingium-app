import { injectable, inject } from 'tsyringe'
import { basename, dirname, extname } from 'path'
import { existsSync } from 'fs'
import { DocumentRepository } from '../repositories/DocumentRepository'
import type {
  DocumentOwnerType,
  UpdateDocumentInput,
  UploadDocumentInput
} from '../api/schemas/document.schema'
import { deleteDocumentFile, getDocumentFullPath } from '../utils/fileStorage'
import {
  isInDocumentsLayout,
  moveIntoOwnerFolder,
  ownerFolderFullPath,
  removeIfEmpty,
  storeOwnerFile,
  storeOwnerFileFromBytes
} from '../utils/documentStorage'

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  zip: 'application/zip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/x-rar-compressed'
}

function mimeType(fileName: string): string {
  return MIME_TYPES[extname(fileName).slice(1).toLowerCase()] ?? 'application/octet-stream'
}

@injectable()
export class DocumentService {
  constructor(@inject(DocumentRepository) private documentRepository: DocumentRepository) {}

  async listByOwner(ownerType: DocumentOwnerType, ownerId: number) {
    return await this.documentRepository.listByOwner(ownerType, ownerId)
  }

  async listEventDocumentsForBand(bandId: number) {
    return await this.documentRepository.listEventDocumentsForBand(bandId)
  }

  async getById(id: number) {
    return await this.documentRepository.getById(id)
  }

  private async requireOwnerLabel(ownerType: DocumentOwnerType, ownerId: number) {
    const label = await this.documentRepository.ownerLabel(ownerType, ownerId)
    if (label === null) throw new Error('Eintrag für die Dokumente nicht gefunden')
    return label
  }

  /** Copies the file into the owner's folder and records it */
  async upload(input: UploadDocumentInput) {
    if (!existsSync(input.sourcePath)) throw new Error('Datei nicht gefunden')
    const label = await this.requireOwnerLabel(input.ownerType, input.ownerId)
    const stored = await storeOwnerFile(
      input.sourcePath,
      input.ownerType,
      input.ownerId,
      label,
      basename(input.sourcePath)
    )
    return await this.documentRepository.create({
      owner_type: input.ownerType,
      owner_id: input.ownerId,
      file_name: stored.fileName,
      file_type: mimeType(stored.fileName),
      file_path: stored.relativePath,
      document_type: input.documentType,
      file_size: Math.max(stored.fileSize, 1)
    })
  }

  /**
   * C5: an attachment of a mail becomes a document of a record. The bytes come from the
   * mail store (the caller has them already), so this writes the file and records where
   * it came from - the same storage rules as an upload.
   */
  async saveFromMail(input: {
    ownerType: DocumentOwnerType
    ownerId: number
    fileName: string
    documentType?: string
    bytes: Uint8Array
    messageId: string | null
    mailAccountId: string
  }) {
    const label = await this.requireOwnerLabel(input.ownerType, input.ownerId)
    const name = input.fileName.trim() || 'Anhang'
    const stored = await storeOwnerFileFromBytes(
      input.bytes,
      input.ownerType,
      input.ownerId,
      label,
      name
    )
    return await this.documentRepository.create({
      owner_type: input.ownerType,
      owner_id: input.ownerId,
      file_name: stored.fileName,
      file_type: mimeType(stored.fileName),
      file_path: stored.relativePath,
      document_type: input.documentType ?? 'other',
      file_size: Math.max(stored.fileSize, 1),
      source_message_id: input.messageId,
      source_mail_account_id: input.mailAccountId
    })
  }

  async updateDocument(input: UpdateDocumentInput) {
    return await this.documentRepository.update(input)
  }

  /** Deletes the record and its file (a missing file is no error) */
  async deleteDocument(id: number) {
    const doc = await this.getById(id)
    if (!doc) return null
    try {
      await deleteDocumentFile(doc.file_path)
    } catch (error) {
      console.error(`Failed to delete file for document ${id}:`, error)
    }
    await this.documentRepository.delete(id)
    return doc
  }

  async getFullPath(id: number) {
    const doc = await this.getById(id)
    if (!doc) return null
    return { filePath: await getDocumentFullPath(doc.file_path), fileName: doc.file_name }
  }

  /** Absolute path of the owner's folder (created if missing) */
  async ownerFolder(ownerType: DocumentOwnerType, ownerId: number) {
    const label = await this.requireOwnerLabel(ownerType, ownerId)
    return await ownerFolderFullPath(ownerType, ownerId, label)
  }

  /**
   * One-time move of files from the old storage/events/<id>/ layout into
   * storage/documents/<type>/<id>-<name>/. Safe to run on every start: files
   * already in the new layout are skipped, missing files keep their path.
   */
  async relocateLegacyFiles(): Promise<{ moved: number; missing: number }> {
    let moved = 0
    let missing = 0
    const oldFolders = new Set<string>()
    for (const doc of await this.documentRepository.listAll()) {
      if (isInDocumentsLayout(doc.file_path)) continue
      const label = await this.documentRepository.ownerLabel(doc.owner_type, doc.owner_id)
      if (label === null || !existsSync(await getDocumentFullPath(doc.file_path))) {
        missing++
        continue
      }
      const newPath = await moveIntoOwnerFolder(doc.file_path, doc.owner_type, doc.owner_id, label)
      await this.documentRepository.updateFilePath(doc.id, newPath)
      oldFolders.add(dirname(doc.file_path))
      moved++
    }
    // Leftover empty folders of the old layout (events/<id>, then events)
    for (const folder of oldFolders) {
      await removeIfEmpty(folder)
      await removeIfEmpty(dirname(folder))
    }
    return { moved, missing }
  }
}
