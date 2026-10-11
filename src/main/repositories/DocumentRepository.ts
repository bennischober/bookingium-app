import { injectable } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { CreateDocumentInput, UpdateDocumentInput } from '../api/schemas/document.schema'

@injectable()
export class DocumentRepository {
  async getByDealMemoId(dealMemoId: number) {
    const documents = await db
      .select()
      .from(schema.document)
      .where(eq(schema.document.deal_memo_id, dealMemoId))
      .orderBy(schema.document.uploaded_at)

    return documents
  }

  async getById(id: number) {
    const documents = await db.select().from(schema.document).where(eq(schema.document.id, id))

    return documents[0] || null
  }

  async create(input: CreateDocumentInput) {
    const result = await db
      .insert(schema.document)
      .values({
        deal_memo_id: input.dealMemoId,
        file_name: input.fileName,
        file_type: input.fileType,
        file_path: input.filePath,
        document_type: input.documentType || 'other',
        file_size: input.fileSize,
        uploaded_by: input.uploadedBy || null
      })
      .returning()

    return result[0]
  }

  async update(input: UpdateDocumentInput) {
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    }

    if (input.documentType) {
      updates.document_type = input.documentType
    }

    if (input.uploadedBy !== undefined) {
      updates.uploaded_by = input.uploadedBy
    }

    const result = await db
      .update(schema.document)
      .set(updates)
      .where(eq(schema.document.id, input.id))
      .returning()

    return result[0]
  }

  async delete(id: number) {
    await db.delete(schema.document).where(eq(schema.document.id, id))
  }

  async deleteByFilePath(filePath: string) {
    await db.delete(schema.document).where(eq(schema.document.file_path, filePath))
  }
}
