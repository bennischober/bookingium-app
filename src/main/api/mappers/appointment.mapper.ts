import type { AppointmentRow } from '../../repositories/AppointmentRepository'
import type { AppointmentDto, AppointmentRecord } from '../schemas/appointment.schema'
import { germanDate } from './followUp.mapper'

export class AppointmentMapper {
  static toDto(row: AppointmentRow): AppointmentDto {
    const { appointment } = row
    return {
      id: appointment.id,
      title: appointment.title,
      startDate: appointment.start_date,
      startTime: appointment.start_time,
      endDate: appointment.end_date,
      endTime: appointment.end_time,
      place: appointment.place,
      notes: appointment.notes,
      reminderMinutes: appointment.reminder_minutes,
      record: this.record(row)
    }
  }

  static toDtoList(rows: AppointmentRow[]): AppointmentDto[] {
    return rows.map((row) => this.toDto(row))
  }

  /** The link as stored, without a name: kept by an update that does not touch it */
  static storedRecord(row: AppointmentRow): AppointmentRecord | null {
    const { appointment } = row
    if (appointment.event_id !== null) return { type: 'event', id: appointment.event_id }
    if (appointment.band_id !== null) return { type: 'band', id: appointment.band_id }
    if (appointment.venue_id !== null) return { type: 'venue', id: appointment.venue_id }
    if (appointment.company_id !== null) return { type: 'company', id: appointment.company_id }
    if (appointment.person_id !== null) return { type: 'person', id: appointment.person_id }
    return null
  }

  private static record(row: AppointmentRow): AppointmentDto['record'] {
    const { appointment } = row
    if (appointment.event_id !== null && row.eventName !== null) {
      const name = row.eventDate ? `${row.eventName} (${germanDate(row.eventDate)})` : row.eventName
      return { type: 'event', id: appointment.event_id, name }
    }
    if (appointment.band_id !== null && row.bandName !== null) {
      return { type: 'band', id: appointment.band_id, name: row.bandName }
    }
    if (appointment.venue_id !== null && row.venueName !== null) {
      return { type: 'venue', id: appointment.venue_id, name: row.venueName }
    }
    if (appointment.company_id !== null && row.companyName !== null) {
      return { type: 'company', id: appointment.company_id, name: row.companyName }
    }
    if (appointment.person_id !== null && row.personLastName !== null) {
      const name = `${row.personFirstName ?? ''} ${row.personLastName}`.trim()
      return { type: 'person', id: appointment.person_id, name }
    }
    return null
  }
}
