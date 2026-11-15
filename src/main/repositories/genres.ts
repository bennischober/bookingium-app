import { asc, eq, getTableName, inArray, sql, type AnyColumn } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { Tx } from './tx'
import { splitGenres } from '../api/schemas/genres'

/**
 * #152: genre tags live in `genre` with one junction table per owner. The API still speaks
 * the comma-separated form ("Metal, Rock") on venues, companies and bands, so the
 * repositories read and write through these helpers and nothing above them changed.
 * A genre no record uses any more is deleted, which keeps `genre` the list of known
 * genres the forms suggest and the Verteiler filters by.
 */

export type GenreOwner = 'venue' | 'company' | 'band'

const LINKS = {
  venue: { table: schema.venue_genre, owner: schema.venue_genre.venue_id },
  company: { table: schema.company_genre, owner: schema.company_genre.company_id },
  band: { table: schema.band_genre, owner: schema.band_genre.band_id }
} as const

const reader = (): Tx => db as unknown as Tx

/** Each owner's tags joined as "Metal, Rock", in the order they were entered */
export function genresByOwner(
  owner: GenreOwner,
  ids: number[],
  tx: Tx = reader()
): Map<number, string> {
  const result = new Map<number, string>()
  if (ids.length === 0) return result
  const link = LINKS[owner]
  const rows = tx
    .select({ ownerId: link.owner, name: schema.genre.name })
    .from(link.table)
    .innerJoin(schema.genre, eq(schema.genre.id, link.table.genre_id))
    .where(inArray(link.owner, [...new Set(ids)]))
    .orderBy(asc(link.owner), asc(link.table.position), asc(link.table.id))
    .all()
  for (const { ownerId, name } of rows) {
    const before = result.get(ownerId)
    result.set(ownerId, before ? `${before}, ${name}` : name)
  }
  return result
}

/** The rows with a `genres` field, '' for none */
export function withGenres<T extends { id: number }>(
  owner: GenreOwner,
  rows: T[],
  tx: Tx = reader()
): (T & { genres: string })[] {
  const byOwner = genresByOwner(
    owner,
    rows.map((row) => row.id),
    tx
  )
  return rows.map((row) => ({ ...row, genres: byOwner.get(row.id) ?? '' }))
}

/** Known genres (used by at least one record), sorted for a picker */
export function listGenres(tx: Tx = reader()): string[] {
  return tx
    .select({ name: schema.genre.name })
    .from(schema.genre)
    .all()
    .map(({ name }) => name)
    .sort((a, b) => a.localeCompare(b, 'de'))
}

const fold = (name: string) => name.toLocaleLowerCase('de')

/**
 * Replaces an owner's tags with the ones in `value` (comma- or semicolon-separated).
 * An existing genre is reused whatever the case it was typed in; then genres nobody
 * uses any more go.
 */
export function writeGenres(tx: Tx, owner: GenreOwner, ownerId: number, value: string): void {
  const tags = splitGenres(value)
  const known = new Map(
    tx
      .select({ id: schema.genre.id, name: schema.genre.name })
      .from(schema.genre)
      .all()
      .map(({ id, name }) => [fold(name), id])
  )
  const ids: number[] = []
  for (const tag of tags) {
    let id = known.get(fold(tag))
    if (id === undefined) {
      id = tx.insert(schema.genre).values({ name: tag }).returning({ id: schema.genre.id }).get().id
      known.set(fold(tag), id)
    }
    if (!ids.includes(id)) ids.push(id)
  }

  const rows = ids.map((genre_id, position) => ({ genre_id, position }))
  switch (owner) {
    case 'venue':
      tx.delete(schema.venue_genre).where(eq(schema.venue_genre.venue_id, ownerId)).run()
      if (rows.length > 0) {
        tx.insert(schema.venue_genre)
          .values(rows.map((row) => ({ ...row, venue_id: ownerId })))
          .run()
      }
      break
    case 'company':
      tx.delete(schema.company_genre).where(eq(schema.company_genre.company_id, ownerId)).run()
      if (rows.length > 0) {
        tx.insert(schema.company_genre)
          .values(rows.map((row) => ({ ...row, company_id: ownerId })))
          .run()
      }
      break
    case 'band':
      tx.delete(schema.band_genre).where(eq(schema.band_genre.band_id, ownerId)).run()
      if (rows.length > 0) {
        tx.insert(schema.band_genre)
          .values(rows.map((row) => ({ ...row, band_id: ownerId })))
          .run()
      }
      break
  }
  deleteUnusedGenres(tx)
}

/** Deletes the genres no venue, company or band uses (after a write or a delete) */
export function deleteUnusedGenres(tx: Tx): void {
  // Raw SQL: drizzle would leave the outer `genre.id` unqualified, and inside the
  // subqueries a bare `id` is the junction row's
  tx.run(
    sql.raw(
      `delete from "genre" where ${Object.values(LINKS)
        .map(
          ({ table }) =>
            `not exists (select 1 from "${getTableName(table)}" l where l."genre_id" = "genre"."id")`
        )
        .join(' and ')}`
    )
  )
}

/**
 * SQL for an owner's tags as one string, for list search and sort (band list):
 * the same text genresByOwner gives
 */
export function genresSql(owner: GenreOwner, ownerId: AnyColumn) {
  const link = getTableName(LINKS[owner].table)
  const key = LINKS[owner].owner.name
  // Qualified by hand: drizzle leaves out the table name in a query without joins,
  // which makes `id` ambiguous inside the subquery
  const outer = `"${getTableName(ownerId.table)}"."${ownerId.name}"`
  return sql<string>`coalesce((${sql.raw(
    `select group_concat(g."name", ', ' order by l."position", l."id") from "${link}" l inner join "genre" g on g."id" = l."genre_id" where l."${key}" = ${outer}`
  )}), '')`
}
