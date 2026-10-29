import { injectable } from 'tsyringe'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { notArchived } from './archiveFilter'
import type { DocumentOwnerType, UpdateDocumentInput } from '../api/schemas/document.schema'
import { normalizeDisplayName } from '../api/schemas/document.schema'

type NewDocument = typeof schema.document.$inferInsert

@injectable()
export class DocumentRepository {
  async listByOwner(ownerType: DocumentOwnerType, ownerId: number) {
    return db
      .select()
      .from(schema.document)
      .where(and(eq(schema.document.owner_type, ownerType), eq(schema.document.owner_id, ownerId)))
      .orderBy(desc(schema.document.uploaded_at), desc(schema.document.id))
  }

  /** Documents of all events of a band, newest event first */
  async listEventDocumentsForBand(bandId: number) {
    const rows = await db
      .select({
        document: schema.document,
        eventName: schema.deal_memo.name,
        eventDate: schema.deal_memo.date
      })
      .from(schema.document)
      .innerJoin(
        schema.deal_memo,
        and(
          eq(schema.document.owner_type, 'event'),
          eq(schema.document.owner_id, schema.deal_memo.id)
        )
      )
      // D3: an archived gig's documents are out of the band's working list
      .where(and(eq(schema.deal_memo.band_id, bandId), notArchived()))
      .orderBy(desc(schema.deal_memo.date), desc(schema.document.uploaded_at))
    return rows.map((row) => ({
      ...row.document,
      eventName: row.eventName,
      eventDate: row.eventDate
    }))
  }

  async listAll() {
    return db.select().from(schema.document).orderBy(desc(schema.document.id))
  }

  async getById(id: number) {
    const documents = await db.select().from(schema.document).where(eq(schema.document.id, id))
    return documents[0] || null
  }

  /**
   * Readable name of the owner for its folder ("2026-06-11 The New Roses
   * München"), or null if the owner does not exist
   */
  async ownerLabel(ownerType: DocumentOwnerType, ownerId: number): Promise<string | null> {
    switch (ownerType) {
      case 'event': {
        const [row] = await db
          .select({ name: schema.deal_memo.name, date: schema.deal_memo.date })
          .from(schema.deal_memo)
          .where(eq(schema.deal_memo.id, ownerId))
        return row ? `${row.date} ${row.name}` : null
      }
      case 'band': {
        const [row] = await db
          .select({ name: schema.band.name })
          .from(schema.band)
          .where(eq(schema.band.id, ownerId))
        return row?.name ?? null
      }
      case 'company': {
        const [row] = await db
          .select({ name: schema.company.name })
          .from(schema.company)
          .where(eq(schema.company.id, ownerId))
        return row?.name ?? null
      }
      case 'venue': {
        const [row] = await db
          .select({ name: schema.venue.name })
          .from(schema.venue)
          .where(eq(schema.venue.id, ownerId))
        return row?.name ?? null
      }
      case 'person': {
        const [row] = await db
          .select({ first: schema.person.first_name, last: schema.person.last_name })
          .from(schema.person)
          .where(eq(schema.person.id, ownerId))
        return row ? `${row.first} ${row.last}`.trim() : null
      }
    }
  }

  async create(values: NewDocument) {
    const result = await db.insert(schema.document).values(values).returning()
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

    // The file on disk keeps its name; only the shown name changes. An empty or
    // whitespace-only name clears the override, so the file name shows again.
    if (input.displayName !== undefined) {
      updates.display_name = normalizeDisplayName(input.displayName)
    }

    const result = await db
      .update(schema.document)
      .set(updates)
      .where(eq(schema.document.id, input.id))
      .returning()

    return result[0]
  }

  async updateFilePath(id: number, filePath: string) {
    await db.update(schema.document).set({ file_path: filePath }).where(eq(schema.document.id, id))
  }

  async delete(id: number) {
    await db.delete(schema.document).where(eq(schema.document.id, id))
  }
}
