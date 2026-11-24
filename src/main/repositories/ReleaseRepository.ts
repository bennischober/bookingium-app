import { injectable } from 'tsyringe'
import { and, asc, eq, exists, inArray, like, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { sqlTimestamp } from '../db/timestamps'
import { listOrder, listPage } from './listQuery'
import type { Tx } from './tx'
import type { PaginationInput } from '../api/schemas/base.schema'
import type {
  ContributorInput,
  CreateReleaseInput,
  ReleaseFields,
  SaveProductData,
  SaveTrackData,
  UpdateReleaseInput,
  WorkShareInput
} from '../api/schemas/release.schema'

// ========================================
// Releases (#289): the release, its tracks, products, credits and work shares
// ========================================

type ReleaseRow = typeof schema.release.$inferSelect
type TrackRow = typeof schema.release_track.$inferSelect
type ProductRow = typeof schema.release_product.$inferSelect
type ContributorRow = typeof schema.release_contributor.$inferSelect
type WorkShareRow = typeof schema.release_work_share.$inferSelect
type ProductTrackRow = typeof schema.release_product_track.$inferSelect

/** A release row with what the list shows next to it */
export type ReleaseListRow = ReleaseRow & {
  band_name: string | null
  product_count: number
  track_count: number
  upcs: string
}

export type ReleaseDetailRow = ReleaseListRow & {
  credits: ContributorRow[]
  tracks: Array<TrackRow & { contributors: ContributorRow[]; work_shares: WorkShareRow[] }>
  products: Array<ProductRow & { tracks: ProductTrackRow[] }>
}

const r = schema.release

const productCount = sql<number>`(SELECT count(*) FROM release_product p WHERE p.release_id = ${r.id})`
const trackCount = sql<number>`(SELECT count(*) FROM release_track t WHERE t.release_id = ${r.id})`
const upcList = sql<string>`coalesce((SELECT group_concat(p.upc, ', ') FROM (SELECT upc FROM release_product WHERE release_id = ${r.id} AND upc <> '' ORDER BY position, id) p), '')`

const listColumns = {
  release: r,
  band_name: schema.band.name,
  product_count: productCount,
  track_count: trackCount,
  upcs: upcList
}

type ListSelect = {
  release: ReleaseRow
  band_name: string | null
  product_count: number
  track_count: number
  upcs: string
}

function toListRow(row: ListSelect): ReleaseListRow {
  return {
    ...row.release,
    band_name: row.band_name,
    product_count: Number(row.product_count),
    track_count: Number(row.track_count),
    upcs: row.upcs ?? ''
  }
}

/** Title, artist, band, label, catalogue number, or a product's UPC or a track's ISRC/title */
function searchCondition(search: string): SQL | undefined {
  const term = search.trim()
  if (!term) return undefined
  const pattern = `%${term}%`
  const compact = `%${term.replace(/[\s-]/g, '')}%`
  return or(
    like(r.title, pattern),
    like(r.artist_name, pattern),
    like(schema.band.name, pattern),
    like(r.label, pattern),
    like(r.catalog_number, pattern),
    exists(
      db
        .select({ one: sql`1` })
        .from(schema.release_product)
        .where(
          and(
            eq(schema.release_product.release_id, r.id),
            or(
              like(schema.release_product.upc, compact),
              like(schema.release_product.catalog_number, pattern)
            )
          )
        )
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(schema.release_track)
        .where(
          and(
            eq(schema.release_track.release_id, r.id),
            or(
              like(sql`replace(${schema.release_track.isrc}, '-', '')`, compact),
              like(schema.release_track.title, pattern)
            )
          )
        )
    )
  )
}

function releaseValues(input: ReleaseFields) {
  return {
    band_id: input.bandId,
    artist_name: input.artistName,
    title: input.title,
    version: input.version,
    release_type: input.releaseType,
    release_date: input.releaseDate,
    original_release_date: input.originalReleaseDate,
    preorder_d2c_date: input.preorderD2cDate,
    preorder_retail_date: input.preorderRetailDate,
    preorder_digital_date: input.preorderDigitalDate,
    label: input.label,
    catalog_number: input.catalogNumber,
    p_line: input.pLine,
    c_line: input.cLine,
    genre: input.genre,
    sub_genre: input.subGenre,
    metadata_language: input.metadataLanguage,
    recording_country: input.recordingCountry,
    project_number: input.projectNumber,
    notes: input.notes
  }
}

function contributorValues(
  releaseId: number,
  trackId: number | null,
  list: ContributorInput[]
): Array<typeof schema.release_contributor.$inferInsert> {
  return list.map((c, index) => ({
    release_id: releaseId,
    track_id: trackId,
    position: index,
    name: c.name,
    role: c.role,
    instrument: c.instrument,
    person_id: c.personId
  }))
}

function workShareValues(
  trackId: number,
  list: WorkShareInput[]
): Array<typeof schema.release_work_share.$inferInsert> {
  return list.map((s, index) => ({
    track_id: trackId,
    position: index,
    name: s.name,
    role: s.role,
    share_percent: s.sharePercent,
    society: s.society,
    ipi: s.ipi,
    publisher: s.publisher,
    country: s.country,
    person_id: s.personId
  }))
}

function touch(tx: Tx, releaseId: number) {
  tx.update(r).set({ updated_at: sqlTimestamp() }).where(eq(r.id, releaseId)).run()
}

function nextPosition(tx: Tx, table: 'release_track' | 'release_product', releaseId: number) {
  const t = schema[table]
  const row = tx
    .select({ max: sql<number | null>`max(${t.position})` })
    .from(t)
    .where(eq(t.release_id, releaseId))
    .get()
  return (row?.max ?? -1) + 1
}

@injectable()
export class ReleaseRepository {
  async getAllPaginated(pagination: PaginationInput) {
    const { page, pageSize, offset } = listPage(pagination)
    const where = pagination.search ? searchCondition(pagination.search) : undefined

    const [{ count }] = db
      .select({ count: sql<number>`count(*)` })
      .from(r)
      .leftJoin(schema.band, eq(r.band_id, schema.band.id))
      .where(where)
      .all()

    const rows = db
      .select(listColumns)
      .from(r)
      .leftJoin(schema.band, eq(r.band_id, schema.band.id))
      .where(where)
      .orderBy(
        ...listOrder(
          pagination,
          {
            artist: [sql`coalesce(nullif(${r.artist_name}, ''), ${schema.band.name})`],
            title: [r.title],
            releaseType: [r.release_type],
            releaseDate: [r.release_date],
            label: [r.label],
            catalogNumber: [r.catalog_number],
            upcs: [upcList],
            trackCount: [trackCount]
          },
          { key: 'releaseDate', dir: 'desc' },
          r.id
        )
      )
      .limit(pageSize)
      .offset(offset)
      .all()

    const total = Number(count) || 0
    return {
      items: rows.map(toListRow),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  }

  async listByBand(bandId: number): Promise<ReleaseListRow[]> {
    return db
      .select(listColumns)
      .from(r)
      .leftJoin(schema.band, eq(r.band_id, schema.band.id))
      .where(eq(r.band_id, bandId))
      .orderBy(sql`${r.release_date} IS NULL`, sql`${r.release_date} DESC`, asc(r.title))
      .all()
      .map(toListRow)
  }

  async getById(id: number): Promise<ReleaseListRow | null> {
    const row = db
      .select(listColumns)
      .from(r)
      .leftJoin(schema.band, eq(r.band_id, schema.band.id))
      .where(eq(r.id, id))
      .get()
    return row ? toListRow(row) : null
  }

  async getDetail(id: number): Promise<ReleaseDetailRow | null> {
    const head = await this.getById(id)
    if (!head) return null

    const tracks = db
      .select()
      .from(schema.release_track)
      .where(eq(schema.release_track.release_id, id))
      .orderBy(asc(schema.release_track.position), asc(schema.release_track.id))
      .all()
    const trackIds = tracks.map((t) => t.id)

    const contributors = db
      .select()
      .from(schema.release_contributor)
      .where(eq(schema.release_contributor.release_id, id))
      .orderBy(asc(schema.release_contributor.position), asc(schema.release_contributor.id))
      .all()
    const shares =
      trackIds.length === 0
        ? []
        : db
            .select()
            .from(schema.release_work_share)
            .where(inArray(schema.release_work_share.track_id, trackIds))
            .orderBy(asc(schema.release_work_share.position), asc(schema.release_work_share.id))
            .all()

    const products = db
      .select()
      .from(schema.release_product)
      .where(eq(schema.release_product.release_id, id))
      .orderBy(asc(schema.release_product.position), asc(schema.release_product.id))
      .all()
    const productIds = products.map((p) => p.id)
    const productTracks =
      productIds.length === 0
        ? []
        : db
            .select()
            .from(schema.release_product_track)
            .where(inArray(schema.release_product_track.product_id, productIds))
            .orderBy(
              asc(schema.release_product_track.position),
              asc(schema.release_product_track.id)
            )
            .all()

    return {
      ...head,
      credits: contributors.filter((c) => c.track_id === null),
      tracks: tracks.map((t) => ({
        ...t,
        contributors: contributors.filter((c) => c.track_id === t.id),
        work_shares: shares.filter((s) => s.track_id === t.id)
      })),
      products: products.map((p) => ({
        ...p,
        tracks: productTracks.filter((pt) => pt.product_id === p.id)
      }))
    }
  }

  async create(input: CreateReleaseInput): Promise<number> {
    const [row] = db.insert(r).values(releaseValues(input)).returning({ id: r.id }).all()
    return row.id
  }

  async update(input: UpdateReleaseInput): Promise<void> {
    db.update(r)
      .set({ ...releaseValues(input), updated_at: sqlTimestamp() })
      .where(eq(r.id, input.id))
      .run()
  }

  async delete(id: number): Promise<void> {
    db.delete(r).where(eq(r.id, id)).run()
  }

  /** Replaces the credits of the release as a whole */
  async saveCredits(releaseId: number, contributors: ContributorInput[]): Promise<void> {
    db.transaction((tx) => {
      tx.delete(schema.release_contributor)
        .where(
          and(
            eq(schema.release_contributor.release_id, releaseId),
            sql`${schema.release_contributor.track_id} IS NULL`
          )
        )
        .run()
      const values = contributorValues(releaseId, null, contributors)
      if (values.length > 0) tx.insert(schema.release_contributor).values(values).run()
      touch(tx, releaseId)
    })
  }

  async getTrack(id: number): Promise<TrackRow | null> {
    return (
      db.select().from(schema.release_track).where(eq(schema.release_track.id, id)).get() ?? null
    )
  }

  async getProduct(id: number): Promise<ProductRow | null> {
    return (
      db.select().from(schema.release_product).where(eq(schema.release_product.id, id)).get() ??
      null
    )
  }

  /** Creates or updates a track with its contributors and work shares; returns its id */
  async saveTrack(input: SaveTrackData): Promise<number> {
    return db.transaction((tx) => {
      const values = {
        title: input.title,
        version: input.version,
        duration_seconds: input.durationSeconds,
        isrc: input.isrc,
        explicit: input.explicit,
        genre: input.genre,
        p_line: input.pLine,
        c_line: input.cLine,
        video_isrc: input.videoIsrc,
        lyrics: input.lyrics,
        notes: input.notes
      }
      let trackId: number
      if (input.id === null) {
        const [row] = tx
          .insert(schema.release_track)
          .values({
            ...values,
            release_id: input.releaseId,
            position: nextPosition(tx, 'release_track', input.releaseId)
          })
          .returning({ id: schema.release_track.id })
          .all()
        trackId = row.id
      } else {
        trackId = input.id
        tx.update(schema.release_track)
          .set({ ...values, updated_at: sqlTimestamp() })
          .where(eq(schema.release_track.id, trackId))
          .run()
        tx.delete(schema.release_contributor)
          .where(eq(schema.release_contributor.track_id, trackId))
          .run()
        tx.delete(schema.release_work_share)
          .where(eq(schema.release_work_share.track_id, trackId))
          .run()
      }
      const contributors = contributorValues(input.releaseId, trackId, input.contributors)
      if (contributors.length > 0) tx.insert(schema.release_contributor).values(contributors).run()
      const shares = workShareValues(trackId, input.workShares)
      if (shares.length > 0) tx.insert(schema.release_work_share).values(shares).run()
      touch(tx, input.releaseId)
      return trackId
    })
  }

  async deleteTrack(id: number, releaseId: number): Promise<void> {
    db.transaction((tx) => {
      tx.delete(schema.release_track).where(eq(schema.release_track.id, id)).run()
      touch(tx, releaseId)
    })
  }

  /** Swaps a track with its neighbour in the release's order */
  async moveTrack(track: TrackRow, direction: 'up' | 'down'): Promise<void> {
    db.transaction((tx) => {
      const ordered = tx
        .select({ id: schema.release_track.id })
        .from(schema.release_track)
        .where(eq(schema.release_track.release_id, track.release_id))
        .orderBy(asc(schema.release_track.position), asc(schema.release_track.id))
        .all()
        .map((row) => row.id)
      const from = ordered.indexOf(track.id)
      const to = direction === 'up' ? from - 1 : from + 1
      if (from < 0 || to < 0 || to >= ordered.length) return
      ;[ordered[from], ordered[to]] = [ordered[to], ordered[from]]
      ordered.forEach((id, position) =>
        tx
          .update(schema.release_track)
          .set({ position })
          .where(eq(schema.release_track.id, id))
          .run()
      )
      touch(tx, track.release_id)
    })
  }

  /** The ids among `trackIds` that are tracks of the release */
  async trackIdsOf(releaseId: number, trackIds: number[]): Promise<Set<number>> {
    if (trackIds.length === 0) return new Set()
    return new Set(
      db
        .select({ id: schema.release_track.id })
        .from(schema.release_track)
        .where(
          and(
            eq(schema.release_track.release_id, releaseId),
            inArray(schema.release_track.id, trackIds)
          )
        )
        .all()
        .map((row) => row.id)
    )
  }

  /** Creates or updates a product with its tracklist; returns its id */
  async saveProduct(input: SaveProductData): Promise<number> {
    return db.transaction((tx) => {
      const values = {
        format: input.format,
        title: input.title,
        packaging: input.packaging,
        color: input.color,
        upc: input.upc,
        catalog_number: input.catalogNumber,
        territory: input.territory,
        disc_count: input.discCount,
        release_date: input.releaseDate,
        price_code: input.priceCode,
        box_lot: input.boxLot,
        notes: input.notes
      }
      let productId: number
      if (input.id === null) {
        const [row] = tx
          .insert(schema.release_product)
          .values({
            ...values,
            release_id: input.releaseId,
            position: nextPosition(tx, 'release_product', input.releaseId)
          })
          .returning({ id: schema.release_product.id })
          .all()
        productId = row.id
      } else {
        productId = input.id
        tx.update(schema.release_product)
          .set({ ...values, updated_at: sqlTimestamp() })
          .where(eq(schema.release_product.id, productId))
          .run()
        tx.delete(schema.release_product_track)
          .where(eq(schema.release_product_track.product_id, productId))
          .run()
      }
      const seen = new Set<number>()
      const tracks = input.tracks.filter((t) => !seen.has(t.trackId) && seen.add(t.trackId))
      if (tracks.length > 0)
        tx.insert(schema.release_product_track)
          .values(
            tracks.map((t, position) => ({
              product_id: productId,
              track_id: t.trackId,
              position,
              disc: t.disc,
              side: t.side
            }))
          )
          .run()
      touch(tx, input.releaseId)
      return productId
    })
  }

  async deleteProduct(id: number, releaseId: number): Promise<void> {
    db.transaction((tx) => {
      tx.delete(schema.release_product).where(eq(schema.release_product.id, id)).run()
      touch(tx, releaseId)
    })
  }
}
