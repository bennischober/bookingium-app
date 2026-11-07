import { injectable, inject } from 'tsyringe'
import {
  AppointmentRepository,
  type AppointmentFields,
  type AppointmentRow,
  type ReminderCandidate
} from '../repositories/AppointmentRepository'
import { AppointmentMapper } from '../api/mappers/appointment.mapper'
import { appointmentTimesError } from '../calendar/appointments'
import { scheduleAppointmentCalendarUpdate } from './CalendarFeedService'
import type {
  AppointmentDto,
  CreateAppointmentInput,
  UpdateAppointmentInput
} from '../api/schemas/appointment.schema'

// #71: own appointments (Termine) in the calendar: a title, a time or all-day, a place, notes, a
// reminder and optionally the record they are on. A change rewrites the calendar file soon when
// it lists appointments (off by default).

@injectable()
export class AppointmentService {
  constructor(
    @inject(AppointmentRepository) private appointmentRepository: AppointmentRepository
  ) {}

  /** The appointments on any day from `from` to `to` (YYYY-MM-DD, both included) */
  listBetween(from: string, to: string): AppointmentDto[] {
    return AppointmentMapper.toDtoList(this.appointmentRepository.listBetween(from, to))
  }

  getById(id: number): AppointmentDto {
    return AppointmentMapper.toDto(this.get(id))
  }

  /** The appointment taken over from the invitation with this UID, null when there is none */
  getByIcalUid(uid: string): AppointmentDto | null {
    const row = this.appointmentRepository.getByIcalUid(uid)
    return row ? AppointmentMapper.toDto(row) : null
  }

  create(input: CreateAppointmentInput): AppointmentDto {
    // The dialog updates the one already taken over; a second row would be a duplicate
    if (input.icalUid && this.appointmentRepository.getByIcalUid(input.icalUid)) {
      throw new Error('Diese Einladung ist schon als Termin im Kalender')
    }
    const id = this.appointmentRepository.create({
      title: input.title,
      startDate: input.startDate,
      startTime: input.startTime,
      endDate: input.endDate,
      endTime: input.endTime,
      place: input.place ?? '',
      notes: input.notes ?? '',
      reminderMinutes: input.reminderMinutes ?? null,
      record: input.record ?? null,
      icalUid: input.icalUid ?? null
    })
    scheduleAppointmentCalendarUpdate()
    return this.getById(id)
  }

  /**
   * Only the given fields change, the rest stay as stored. A new time or reminder clears the
   * "reminded" mark, so the reminder comes (again) for the new time.
   */
  update(input: UpdateAppointmentInput): AppointmentDto {
    const row = this.get(input.id)
    const stored = AppointmentMapper.toDto(row)
    const { appointment } = row
    // The stored link, also one whose record has no name to show
    const storedRecord = AppointmentMapper.storedRecord(row)
    const fields: AppointmentFields = {
      title: input.title ?? stored.title,
      startDate: input.startDate ?? stored.startDate,
      startTime: input.startTime !== undefined ? input.startTime : stored.startTime,
      endDate: input.endDate ?? stored.endDate,
      endTime: input.endTime !== undefined ? input.endTime : stored.endTime,
      place: input.place ?? stored.place,
      notes: input.notes ?? stored.notes,
      reminderMinutes:
        input.reminderMinutes !== undefined ? input.reminderMinutes : stored.reminderMinutes,
      record: input.record !== undefined ? input.record : storedRecord
    }
    const error = appointmentTimesError(fields)
    if (error) throw new Error(error)
    const resetReminder =
      fields.startDate !== appointment.start_date ||
      fields.startTime !== appointment.start_time ||
      fields.reminderMinutes !== appointment.reminder_minutes
    this.appointmentRepository.update(input.id, fields, resetReminder)
    scheduleAppointmentCalendarUpdate()
    return this.getById(input.id)
  }

  delete(id: number): void {
    this.appointmentRepository.delete(id)
    scheduleAppointmentCalendarUpdate()
  }

  /** For the reminder check: not yet reminded appointments starting from `from` to `to` */
  reminderCandidates(from: string, to: string): ReminderCandidate[] {
    return this.appointmentRepository.reminderCandidates(from, to)
  }

  markReminded(ids: readonly number[]): void {
    this.appointmentRepository.markReminded(ids)
  }

  private get(id: number): AppointmentRow {
    const row = this.appointmentRepository.getById(id)
    if (!row) throw new Error(`Termin ${id} nicht gefunden`)
    return row
  }
}
