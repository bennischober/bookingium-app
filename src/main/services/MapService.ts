// Read-only aggregate for the map preview (#102), like DashboardService and
// SearchService: queries db directly on purpose (no repository), one IPC
// round-trip, marker building in the pure module (src/main/map/markers.ts).

import { injectable } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { notArchived } from '../repositories/archiveFilter'
import { buildMapData } from '../map/markers'
import type { MapData, MapDataFilter, MapEventRow, MapVenueRow } from '../map/markers'

@injectable()
export class MapService {
  /**
   * Events (deal memos) and venues for the map, filters applied. Archived
   * events are out (D3); a cancelled gig never happens, so it draws no ring
   * (the marker builder leaves it out). Events carry their venue's address,
   * venues their own.
   */
  async getData(filter: MapDataFilter): Promise<MapData> {
    // One event row per event; its venue's kind and address ride along.
    // Left-joined columns are null together: no venue, or a venue without an
    // address, makes the whole address null.
    const eventRows = await db
      .select({
        id: schema.deal_memo.id,
        name: schema.deal_memo.name,
        date: schema.deal_memo.date,
        status: schema.deal_memo.status,
        band_id: schema.deal_memo.band_id,
        venue_id: schema.deal_memo.venue_id,
        venue_kind: schema.venue.kind,
        street: schema.address.street,
        street_number: schema.address.street_number,
        zip_code: schema.address.zip_code,
        city: schema.address.city,
        country: schema.address.country,
        country_code: schema.address.country_code
      })
      .from(schema.deal_memo)
      .leftJoin(schema.venue, eq(schema.deal_memo.venue_id, schema.venue.id))
      .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
      .where(notArchived())

    const venueRows = await db
      .select({
        id: schema.venue.id,
        name: schema.venue.name,
        kind: schema.venue.kind,
        street: schema.address.street,
        street_number: schema.address.street_number,
        zip_code: schema.address.zip_code,
        city: schema.address.city,
        country: schema.address.country,
        country_code: schema.address.country_code
      })
      .from(schema.venue)
      .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))

    const asAddress = (row: {
      street: string | null
      street_number: string | null
      zip_code: string | null
      city: string | null
      country: string | null
      country_code: string | null
    }) =>
      row.zip_code === null && row.city === null
        ? null
        : {
            street: row.street ?? '',
            street_number: row.street_number ?? '',
            zip_code: row.zip_code ?? '',
            city: row.city ?? '',
            country: row.country ?? '',
            country_code: row.country_code ?? ''
          }

    const events: MapEventRow[] = eventRows.map((row) => ({
      id: row.id,
      name: row.name,
      date: row.date,
      status: row.status,
      band_id: row.band_id,
      venue_id: row.venue_id,
      venue_kind: row.venue_kind,
      address: asAddress(row)
    }))

    const venues: MapVenueRow[] = venueRows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      address: asAddress(row)
    }))

    return buildMapData(events, venues, filter)
  }
}
