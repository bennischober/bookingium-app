import type { FollowUpRow } from '../../repositories/FollowUpRepository'
import type { FollowUpDto } from '../schemas/followUp.schema'

/** 2026-06-11 -> 11.06.2026 */
const germanDate = (iso: string): string => iso.split('-').reverse().join('.')

export class FollowUpMapper {
  static toDto(row: FollowUpRow): FollowUpDto {
    const { followUp } = row
    return {
      id: followUp.id,
      dueDate: followUp.due_date,
      note: followUp.note,
      doneAt: followUp.done_at,
      record: this.record(row)
    }
  }

  static toDtoList(rows: FollowUpRow[]): FollowUpDto[] {
    return rows.map((row) => this.toDto(row))
  }

  private static record(row: FollowUpRow): FollowUpDto['record'] {
    const { followUp } = row
    if (followUp.event_id !== null && row.eventName !== null) {
      const name = row.eventDate ? `${row.eventName} (${germanDate(row.eventDate)})` : row.eventName
      return { type: 'event', id: followUp.event_id, name }
    }
    if (followUp.band_id !== null && row.bandName !== null) {
      return { type: 'band', id: followUp.band_id, name: row.bandName }
    }
    if (followUp.venue_id !== null && row.venueName !== null) {
      return { type: 'venue', id: followUp.venue_id, name: row.venueName }
    }
    if (followUp.company_id !== null && row.companyName !== null) {
      return { type: 'company', id: followUp.company_id, name: row.companyName }
    }
    if (followUp.person_id !== null && row.personLastName !== null) {
      const name = `${row.personFirstName ?? ''} ${row.personLastName}`.trim()
      return { type: 'person', id: followUp.person_id, name }
    }
    if (followUp.invoice_id !== null) {
      // Drafts have no number yet
      const invoice =
        row.invoiceNumber === null ? 'Rechnungsentwurf' : `Rechnung #${row.invoiceNumber}`
      const name = row.invoiceRecipient ? `${invoice} · ${row.invoiceRecipient}` : invoice
      return { type: 'invoice', id: followUp.invoice_id, name }
    }
    return null
  }
}
