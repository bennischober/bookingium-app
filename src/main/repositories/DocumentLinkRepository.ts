import { injectable } from 'tsyringe'
import { and, desc, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { db } from '../db'
import { schema } from '../db/schema'
import { notArchived } from './archiveFilter'
import {
  LINKABLE_RECORD_TYPES,
  type DocumentOwnerType,
  type LinkableRecordType
} from '../api/schemas/document.schema'
import type { DocumentLinkDto } from '../api/schemas/document_link.schema'

type DocumentRow = typeof schema.document.$inferSelect

/** The link column of each kind of record */
const LINK_COLUMN: Record<LinkableRecordType, SQLiteColumn> = {
  event: schema.document_link.deal_memo_id,
  band: schema.document_link.band_id,
  company: schema.document_link.company_id,
  venue: schema.document_link.venue_id,
  person: schema.document_link.person_id
}

const LINK_FIELD: Record<LinkableRecordType, keyof typeof schema.document_link.$inferInsert> = {
  event: 'deal_memo_id',
  band: 'band_id',
  company: 'company_id',
  venue: 'venue_id',
  person: 'person_id'
}

const SEARCH_LIMIT = 8

function isLinkable(kind: DocumentOwnerType): kind is LinkableRecordType {
  return (LINKABLE_RECORD_TYPES as readonly string[]).includes(kind)
}

/**
 * Further records a document belongs to (document_link), and the documents that concern a
 * record without lying in its own folder: linked to it, or filed at one of its events.
 */
@injectable()
export class DocumentLinkRepository {
  /** Names (and event dates) of records of one kind, by id */
  labels(kind: DocumentOwnerType, ids: number[]): Map<number, DocumentLinkDto> {
    const unique = [...new Set(ids)]
    const out = new Map<number, DocumentLinkDto>()
    if (unique.length === 0) return out
    const put = (id: number, name: string, date: string | null = null) =>
      out.set(id, { kind, id, name, date })
    switch (kind) {
      case 'event':
        for (const row of db
          .select({
            id: schema.deal_memo.id,
            name: schema.deal_memo.name,
            date: schema.deal_memo.date
          })
          .from(schema.deal_memo)
          .where(inArray(schema.deal_memo.id, unique))
          .all())
          put(row.id, row.name, row.date)
        break
      case 'band':
        for (const row of db
          .select({ id: schema.band.id, name: schema.band.name })
          .from(schema.band)
          .where(inArray(schema.band.id, unique))
          .all())
          put(row.id, row.name)
        break
      case 'company':
        for (const row of db
          .select({ id: schema.company.id, name: schema.company.name })
          .from(schema.company)
          .where(inArray(schema.company.id, unique))
          .all())
          put(row.id, row.name)
        break
      case 'venue':
        for (const row of db
          .select({ id: schema.venue.id, name: schema.venue.name })
          .from(schema.venue)
          .where(inArray(schema.venue.id, unique))
          .all())
          put(row.id, row.name)
        break
      case 'person':
        for (const row of db
          .select({
            id: schema.person.id,
            first: schema.person.first_name,
            last: schema.person.last_name
          })
          .from(schema.person)
          .where(inArray(schema.person.id, unique))
          .all())
          put(row.id, `${row.first} ${row.last}`.trim())
        break
      case 'release':
        for (const row of db
          .select({ id: schema.release.id, name: schema.release.title })
          .from(schema.release)
          .where(inArray(schema.release.id, unique))
          .all())
          put(row.id, row.name)
        break
    }
    return out
  }

  /** The further records of a document, by kind and name */
  links(documentId: number): DocumentLinkDto[] {
    const rows = db
      .select()
      .from(schema.document_link)
      .where(eq(schema.document_link.document_id, documentId))
      .all()
    const out: DocumentLinkDto[] = []
    for (const kind of LINKABLE_RECORD_TYPES) {
      const field = LINK_FIELD[kind]
      const ids = rows.map((row) => row[field] as number | null).filter((id) => id !== null)
      out.push(...this.labels(kind, ids).values())
    }
    return out
  }

  /** Links or unlinks; linking twice keeps one row */
  setLink(documentId: number, kind: LinkableRecordType, id: number, linked: boolean): void {
    if (linked) {
      db.insert(schema.document_link)
        .values({ document_id: documentId, [LINK_FIELD[kind]]: id })
        .onConflictDoNothing()
        .run()
    } else {
      db.delete(schema.document_link)
        .where(and(eq(schema.document_link.document_id, documentId), eq(LINK_COLUMN[kind], id)))
        .run()
    }
  }

  /** The events (not archived) a record takes part in, other than as their band */
  private eventIdsOf(kind: DocumentOwnerType, id: number): number[] {
    let where: SQL | undefined
    switch (kind) {
      case 'company':
        where = or(
          eq(schema.deal_memo.lopro_company_id, id),
          eq(schema.deal_memo.invoice_company_id, id),
          eq(schema.deal_memo.representing_company_id, id)
        )
        break
      case 'person':
        where = or(
          eq(schema.deal_memo.lopro_person_id, id),
          inArray(
            schema.deal_memo.id,
            db
              .select({ id: schema.event_advancing.deal_memo_id })
              .from(schema.event_advancing)
              .where(eq(schema.event_advancing.local_contact_id, id))
          )
        )
        break
      case 'venue':
        where = eq(schema.deal_memo.venue_id, id)
        break
      // a band's event documents have their own list on the band page; an event is itself
      default:
        return []
    }
    return db
      .select({ id: schema.deal_memo.id })
      .from(schema.deal_memo)
      .where(and(where, notArchived()))
      .all()
      .map((row) => row.id)
  }

  /**
   * Documents that concern a record but lie elsewhere: linked to it first, then those filed at
   * its events; its own documents are left out (its document list shows them). Newest first.
   */
  related(
    kind: DocumentOwnerType,
    id: number
  ): Array<{ document: DocumentRow; via: 'linked' | 'event'; source: DocumentLinkDto }> {
    const own = (row: DocumentRow) => row.owner_type === kind && row.owner_id === id
    // a release (#289) has no link column: nothing is linked to it
    const linked = isLinkable(kind)
      ? db
          .select({ document: schema.document })
          .from(schema.document_link)
          .innerJoin(schema.document, eq(schema.document.id, schema.document_link.document_id))
          .where(eq(LINK_COLUMN[kind], id))
          .all()
          .map((row) => row.document)
          .filter((row) => !own(row))
      : []
    const eventIds = this.eventIdsOf(kind, id)
    const fromEvents =
      eventIds.length === 0
        ? []
        : db
            .select()
            .from(schema.document)
            .where(
              and(
                eq(schema.document.owner_type, 'event'),
                inArray(schema.document.owner_id, eventIds)
              )
            )
            .all()
    const seen = new Set<number>()
    const picked: Array<{ document: DocumentRow; via: 'linked' | 'event' }> = []
    for (const document of linked)
      if (!seen.has(document.id)) {
        seen.add(document.id)
        picked.push({ document, via: 'linked' })
      }
    for (const document of fromEvents)
      if (!seen.has(document.id)) {
        seen.add(document.id)
        picked.push({ document, via: 'event' })
      }

    // where each file lies, named
    const byKind = new Map<DocumentOwnerType, Map<number, DocumentLinkDto>>()
    for (const ownerKind of LINKABLE_RECORD_TYPES) {
      const ids = picked
        .filter(({ document }) => document.owner_type === ownerKind)
        .map(({ document }) => document.owner_id)
      byKind.set(ownerKind, this.labels(ownerKind, ids))
    }
    return picked
      .map(({ document, via }) => ({
        document,
        via,
        source: byKind.get(document.owner_type)?.get(document.owner_id) ?? {
          kind: document.owner_type,
          id: document.owner_id,
          name: '',
          date: null
        }
      }))
      .sort((a, b) => b.document.uploaded_at.localeCompare(a.document.uploaded_at))
  }

  /** Records whose name contains the query, a few of each kind, for the link picker */
  searchTargets(query: string): DocumentLinkDto[] {
    // LIKE is case-insensitive for ASCII; a % or _ typed in the query simply matches more
    const pattern = `%${query.trim()}%`
    const match = (column: SQLiteColumn | SQL) => like(column, pattern)
    const out: DocumentLinkDto[] = []
    out.push(
      ...db
        .select({
          id: schema.deal_memo.id,
          name: schema.deal_memo.name,
          date: schema.deal_memo.date
        })
        .from(schema.deal_memo)
        .leftJoin(schema.band, eq(schema.band.id, schema.deal_memo.band_id))
        .where(and(notArchived(), or(match(schema.deal_memo.name), match(schema.band.name))))
        .orderBy(desc(schema.deal_memo.date))
        .limit(SEARCH_LIMIT)
        .all()
        .map((row) => ({ kind: 'event' as const, ...row }))
    )
    const simple = (
      kind: 'band' | 'company' | 'venue',
      table: typeof schema.band | typeof schema.company | typeof schema.venue
    ) =>
      db
        .select({ id: table.id, name: table.name })
        .from(table)
        .where(match(table.name))
        .orderBy(table.name)
        .limit(SEARCH_LIMIT)
        .all()
        .map((row) => ({ kind, id: row.id, name: row.name, date: null }))
    out.push(...simple('band', schema.band))
    out.push(...simple('company', schema.company))
    out.push(...simple('venue', schema.venue))
    out.push(
      ...db
        .select({
          id: schema.person.id,
          first: schema.person.first_name,
          last: schema.person.last_name
        })
        .from(schema.person)
        .where(match(sql`${schema.person.first_name} || ' ' || ${schema.person.last_name}`))
        .orderBy(schema.person.last_name, schema.person.first_name)
        .limit(SEARCH_LIMIT)
        .all()
        .map((row) => ({
          kind: 'person' as const,
          id: row.id,
          name: `${row.first} ${row.last}`.trim(),
          date: null
        }))
    )
    return out
  }
}
