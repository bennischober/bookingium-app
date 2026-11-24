import type { ReleaseDetailRow, ReleaseListRow } from '../../repositories/ReleaseRepository'
import { schema } from '../../db/schema'
import {
  ReleaseFormat,
  ReleaseType,
  WorkRole,
  type ContributorDto,
  type ProductDto,
  type ReleaseDetailDto,
  type ReleaseDto,
  type TrackDto,
  type WorkShareDto
} from '../schemas/release.schema'

type ContributorRow = typeof schema.release_contributor.$inferSelect
type WorkShareRow = typeof schema.release_work_share.$inferSelect

/** A stored value outside the enum (an older or newer app wrote it) falls back to the default */
function oneOf<T extends string>(values: readonly T[], value: string, fallback: T): T {
  return (values as readonly string[]).includes(value) ? (value as T) : fallback
}

export class ReleaseMapper {
  static toDto(row: ReleaseListRow): ReleaseDto {
    return {
      id: row.id,
      bandId: row.band_id,
      bandName: row.band_name,
      artist: row.artist_name || row.band_name || '',
      artistName: row.artist_name,
      title: row.title,
      version: row.version,
      releaseType: oneOf(ReleaseType.options, row.release_type, 'other'),
      releaseDate: row.release_date,
      originalReleaseDate: row.original_release_date,
      preorderD2cDate: row.preorder_d2c_date,
      preorderRetailDate: row.preorder_retail_date,
      preorderDigitalDate: row.preorder_digital_date,
      label: row.label,
      labelCompanyId: row.label_company_id,
      labelCompanyName: row.label_company_name,
      labelShown: row.label || row.label_company_name || '',
      catalogNumber: row.catalog_number,
      pLine: row.p_line,
      cLine: row.c_line,
      genre: row.genre,
      subGenre: row.sub_genre,
      metadataLanguage: row.metadata_language,
      recordingCountry: row.recording_country,
      projectNumber: row.project_number,
      notes: row.notes,
      productCount: row.product_count,
      trackCount: row.track_count,
      upcs: row.upcs,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  static toDtoList(rows: ReleaseListRow[]): ReleaseDto[] {
    return rows.map((row) => this.toDto(row))
  }

  static contributor(row: ContributorRow): ContributorDto {
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      instrument: row.instrument,
      personId: row.person_id
    }
  }

  static workShare(row: WorkShareRow): WorkShareDto {
    return {
      id: row.id,
      name: row.name,
      role: oneOf(WorkRole.options, row.role, 'other'),
      sharePercent: row.share_percent,
      society: row.society,
      ipi: row.ipi,
      publisher: row.publisher,
      country: row.country,
      personId: row.person_id
    }
  }

  static toDetailDto(row: ReleaseDetailRow): ReleaseDetailDto {
    const tracks: TrackDto[] = row.tracks.map((t, index) => ({
      id: t.id,
      releaseId: t.release_id,
      // shown 1, 2, 3 … in the stored order, whatever the stored numbers are
      position: index + 1,
      title: t.title,
      version: t.version,
      durationSeconds: t.duration_seconds,
      isrc: t.isrc,
      explicit: t.explicit,
      genre: t.genre,
      pLine: t.p_line,
      cLine: t.c_line,
      videoIsrc: t.video_isrc,
      lyrics: t.lyrics,
      notes: t.notes,
      contributors: t.contributors.map((c) => this.contributor(c)),
      workShares: t.work_shares.map((s) => this.workShare(s))
    }))
    const products: ProductDto[] = row.products.map((p, index) => ({
      id: p.id,
      releaseId: p.release_id,
      position: index + 1,
      format: oneOf(ReleaseFormat.options, p.format, 'other'),
      title: p.title,
      packaging: p.packaging,
      color: p.color,
      upc: p.upc,
      catalogNumber: p.catalog_number,
      territory: p.territory,
      discCount: p.disc_count,
      releaseDate: p.release_date,
      priceCode: p.price_code,
      boxLot: p.box_lot,
      notes: p.notes,
      tracks: p.tracks.map((pt, i) => ({
        trackId: pt.track_id,
        position: i + 1,
        disc: pt.disc,
        side: pt.side
      }))
    }))
    return {
      ...this.toDto(row),
      credits: row.credits.map((c) => this.contributor(c)),
      tracks,
      products
    }
  }
}
