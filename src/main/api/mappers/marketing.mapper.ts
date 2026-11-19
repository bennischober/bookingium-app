import type { schema } from '../../db/schema'
import type { MarketingItemRow } from '../../repositories/MarketingRepository'
import type {
  MarketingAtlasDto,
  MarketingCategory,
  MarketingItemDto,
  MarketingPriority,
  MarketingQuality,
  MarketingStatus
} from '../schemas/marketing.schema'

type AtlasRow = typeof schema.marketing_atlas.$inferSelect

/** A stored JSON list; a broken one reads as empty */
function parsed<T>(text: string): T[] {
  try {
    const value = JSON.parse(text) as unknown
    return Array.isArray(value) ? (value as T[]) : []
  } catch {
    return []
  }
}

export class MarketingMapper {
  static toItemDto(
    row: MarketingItemRow,
    actionStatus: MarketingItemDto['actionStatus'] = null
  ): MarketingItemDto {
    return {
      actionStatus,
      id: row.id,
      bandId: row.band_id,
      category: row.category as MarketingCategory,
      group: row.group_name,
      name: row.name,
      country: row.country,
      type: row.type,
      priority: row.priority as MarketingPriority,
      reason: row.reason,
      approach: row.approach,
      timing: row.timing,
      quality: row.quality as MarketingQuality,
      sourceUrl: row.source_url,
      contactEmail: row.contact_email,
      contactUrl: row.contact_url,
      contactNote: row.contact_note,
      activeNote: row.active_note,
      status: row.status as MarketingStatus,
      statusNote: row.status_note,
      statusDate: row.status_date,
      companyId: row.company_id,
      companyName: row.companyName,
      venueId: row.venue_id,
      venueName: row.venueName,
      inAtlas: row.in_atlas
    }
  }

  static toAtlasDto(row: AtlasRow): MarketingAtlasDto {
    return {
      bandId: row.band_id,
      stand: row.stand,
      run: row.run,
      lead: row.lead,
      facts: parsed(row.facts),
      refs: parsed(row.refs),
      tabs: parsed(row.tabs),
      runs: parsed(row.runs),
      excluded: parsed(row.excluded),
      sourceName: row.source_name,
      importedAt: row.imported_at
    }
  }
}
