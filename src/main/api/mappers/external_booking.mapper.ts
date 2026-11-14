import type { ExternalBookingRow } from '../../repositories/ExternalBookingRepository'
import type {
  ExternalBookingDto,
  ExternalBookingKind,
  ExternalBookingStatus
} from '../schemas/external_booking.schema'

const asKind = (kind: string): ExternalBookingKind => (kind === 'festival' ? 'festival' : 'venue')

const asStatus = (status: string): ExternalBookingStatus =>
  status === 'pending' || status === 'cancelled' ? status : 'confirmed'

export class ExternalBookingMapper {
  static toDto(row: ExternalBookingRow): ExternalBookingDto {
    return {
      id: row.id,
      bandId: row.band_id,
      bandName: row.band_name,
      date: row.date,
      kind: asKind(row.kind),
      status: asStatus(row.status),
      venueName: row.venue_name,
      street: row.street,
      zipCode: row.zip_code,
      city: row.city,
      country: row.country,
      notes: row.notes,
      agency: row.agency,
      sourceFile: row.source_file,
      importedAt: row.imported_at
    }
  }

  static toDtoList(rows: ExternalBookingRow[]): ExternalBookingDto[] {
    return rows.map((row) => this.toDto(row))
  }
}
