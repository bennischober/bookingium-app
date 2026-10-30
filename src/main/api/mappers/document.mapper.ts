import type { DocumentDto } from '../schemas/document.schema'
import { schema } from '../../db/schema'

export class DocumentMapper {
  static toDtoList(documents: (typeof schema.document.$inferSelect)[]): DocumentDto[] {
    return documents.map((doc) => this.toDto(doc))
  }

  static toDto(document: typeof schema.document.$inferSelect): DocumentDto {
    return {
      id: document.id,
      ownerType: document.owner_type,
      ownerId: document.owner_id,
      fileName: document.file_name,
      displayName: document.display_name,
      fileType: document.file_type,
      filePath: document.file_path,
      documentType: document.document_type,
      fileSize: document.file_size,
      uploadedAt: document.uploaded_at,
      uploadedBy: document.uploaded_by,
      createdAt: document.created_at,
      updatedAt: document.updated_at
    }
  }
}
