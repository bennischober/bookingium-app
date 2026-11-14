import { injectable } from 'tsyringe'
import { eq, like, or, sql } from 'drizzle-orm'
import { listOrder, listPage } from './listQuery'
import { deleteUnusedGenres, genresByOwner, genresSql, withGenres, writeGenres } from './genres'
import { db } from '../db'
import { schema } from '../db/schema'
import { CreateBandInput, UpdateBandInput } from '../api/schemas/band.schema'
import { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class BandRepository {
  async getAll() {
    return withGenres('band', await db.select().from(schema.band))
  }

  async getAllPaginated(pagination: PaginationInput) {
    const { search } = pagination
    const { page, pageSize, offset } = listPage(pagination)

    // Build where clause for search
    const genres = genresSql('band', schema.band.id)
    const whereClause = search
      ? or(like(schema.band.name, `%${search}%`), like(genres, `%${search}%`))
      : undefined

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.band)
      .where(whereClause)

    const total = countResult[0]?.count || 0

    // Get paginated data
    const rows = await db
      .select()
      .from(schema.band)
      .where(whereClause)
      .orderBy(
        ...listOrder(
          pagination,
          {
            name: [schema.band.name],
            genre: [genres],
            founded: [schema.band.founded],
            notes: [schema.band.notes]
          },
          { key: 'name', dir: 'asc' },
          schema.band.id
        )
      )
      .limit(pageSize)
      .offset(offset)
    const items = withGenres('band', rows)

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  }

  /** Bands the company owns or manages, by name */
  async listByCompany(companyId: number) {
    return withGenres(
      'band',
      await db
        .select()
        .from(schema.band)
        .where(
          or(
            eq(schema.band.company_id, companyId),
            eq(schema.band.management_company_id, companyId)
          )
        )
        .orderBy(schema.band.name)
    )
  }

  /** Bands whose technical director (TL) the person is, by name */
  async listByResponsiblePerson(personId: number) {
    return withGenres(
      'band',
      await db
        .select()
        .from(schema.band)
        .where(eq(schema.band.responsible_person_id, personId))
        .orderBy(schema.band.name)
    )
  }

  async getById(id: number) {
    const result = await db.select().from(schema.band).where(eq(schema.band.id, id))
    return result[0] ? withGenres('band', result)[0] : null
  }

  async create(data: CreateBandInput) {
    return db.transaction((tx) => {
      const created = tx
        .insert(schema.band)
        .values({
          name: data.name,
          founded: data.founded,
          notes: data.notes,
          company_id: data.companyId,
          responsible_person_id: data.responsiblePersonId ?? null,
          management_company_id: data.managementCompanyId ?? null
        })
        .returning()
        .get()
      writeGenres(tx, 'band', created.id, data.genre ?? '')
      return withGenres('band', [created], tx)[0]
    })
  }

  async update(data: UpdateBandInput) {
    const existing = await db.select().from(schema.band).where(eq(schema.band.id, data.id)).limit(1)
    if (existing.length === 0) throw new Error('Band not found')
    const prev = existing[0]

    return db.transaction((tx) => {
      const updated = tx
        .update(schema.band)
        .set({
          name: data.name ?? prev.name,
          founded: data.founded ?? prev.founded,
          notes: data.notes ?? prev.notes,
          company_id: data.companyId ?? prev.company_id,
          responsible_person_id:
            data.responsiblePersonId !== undefined
              ? data.responsiblePersonId
              : prev.responsible_person_id,
          management_company_id:
            data.managementCompanyId !== undefined
              ? data.managementCompanyId
              : prev.management_company_id
        })
        .where(eq(schema.band.id, data.id))
        .returning()
        .get()
      if (data.genre !== undefined) writeGenres(tx, 'band', data.id, data.genre)
      return withGenres('band', [updated], tx)[0]
    })
  }

  /** #162: events keep their band (no ON DELETE rule), so they block the delete */
  countEvents(id: number) {
    return (
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.deal_memo)
        .where(eq(schema.deal_memo.band_id, id))
        .get()?.n ?? 0
    )
  }

  async delete(id: number) {
    return db.transaction((tx) => {
      // The tags go with the band (cascade), so read them first for the returned row
      const genres = genresByOwner('band', [id], tx).get(id) ?? ''
      const [deleted] = tx.delete(schema.band).where(eq(schema.band.id, id)).returning().all()
      deleteUnusedGenres(tx)
      return deleted ? { ...deleted, genres } : undefined
    })
  }
}
