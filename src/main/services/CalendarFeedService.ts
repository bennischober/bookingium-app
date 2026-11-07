import { singleton, inject, container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { rename, writeFile } from 'fs/promises'
import { db } from '../db'
import { schema } from '../db/schema'
import { notArchived } from '../repositories/archiveFilter'
import { SettingsService } from './SettingsService'
import { FollowUpRepository } from '../repositories/FollowUpRepository'
import { FollowUpMapper } from '../api/mappers/followUp.mapper'
import { AppointmentRepository } from '../repositories/AppointmentRepository'
import { AppointmentMapper } from '../api/mappers/appointment.mapper'
import {
  buildCalendar,
  type CalendarAppointment,
  type CalendarEvent,
  type CalendarFollowUp
} from '../calendar/ics'
import type { CalendarFeedStatusDto } from '../api/schemas/settings.schema'

const UPDATE_DELAY_MS = 1500

/**
 * Keeps the calendar file chosen in Einstellungen (calendarFeedPath) up to
 * date: rewritten shortly after events, bands, venues, hotels or (when
 * included) follow-ups or own appointments change, and on start. Calendar apps subscribed to the file (or its shared link) pick
 * the changes up on their next refresh.
 */
// One instance: it owns the pending write and the last status
@singleton()
export class CalendarFeedService {
  private timer: NodeJS.Timeout | null = null
  private lastWrittenAt: string | null = null
  private lastError: string | null = null
  private lastCount = 0
  private lastFollowUpCount = 0
  private lastAppointmentCount = 0

  // The repositories, not the services: those schedule updates here
  constructor(
    @inject(SettingsService) private settings: SettingsService,
    @inject(FollowUpRepository) private followUpRepository: FollowUpRepository,
    @inject(AppointmentRepository) private appointmentRepository: AppointmentRepository
  ) {}

  async events(): Promise<CalendarEvent[]> {
    const rows = await db
      .select({
        event: schema.deal_memo,
        bandName: schema.band.name,
        venueName: schema.venue.name,
        street: schema.address.street,
        streetNumber: schema.address.street_number,
        zipCode: schema.address.zip_code,
        city: schema.address.city,
        hotelName: schema.hotel.name
      })
      .from(schema.deal_memo)
      .leftJoin(schema.band, eq(schema.deal_memo.band_id, schema.band.id))
      .leftJoin(schema.venue, eq(schema.deal_memo.venue_id, schema.venue.id))
      .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
      .leftJoin(schema.hotel, eq(schema.deal_memo.hotel_id, schema.hotel.id))
      // D3: an archived gig stays out of the feed subscribers already have
      .where(notArchived())
      .orderBy(schema.deal_memo.date)

    return rows.map((row) => {
      const street = [row.street, row.streetNumber].filter(Boolean).join(' ')
      const place = [row.zipCode, row.city].filter(Boolean).join(' ')
      return {
        id: row.event.id,
        name: row.event.name,
        date: row.event.date,
        performanceTime: row.event.performance_time ?? '',
        performanceDuration: row.event.performance_duration ?? '',
        status: row.event.status,
        bandName: row.bandName,
        venueName: row.venueName,
        venueAddress: [street, place].filter(Boolean).join(', ') || null,
        hotelName: row.hotelName,
        deal: row.event.deal,
        notes: row.event.notes,
        updatedAt: row.event.updated_at ?? row.event.created_at
      }
    })
  }

  /** Open follow-ups, when the setting includes them; none otherwise */
  followUps(): CalendarFollowUp[] {
    if (!this.settings.get().calendarFeedFollowUps) return []
    return this.followUpRepository.listOpen().map((row) => ({
      id: row.followUp.id,
      dueDate: row.followUp.due_date,
      note: row.followUp.note,
      recordName: FollowUpMapper.toDto(row).record?.name ?? null,
      updatedAt: row.followUp.updated_at
    }))
  }

  /** #71: own appointments, when the setting includes them (off by default); none otherwise */
  appointments(): CalendarAppointment[] {
    if (!this.settings.get().calendarFeedAppointments) return []
    return this.appointmentRepository.listAll().map((row) => ({
      id: row.appointment.id,
      title: row.appointment.title,
      startDate: row.appointment.start_date,
      startTime: row.appointment.start_time,
      endDate: row.appointment.end_date,
      endTime: row.appointment.end_time,
      place: row.appointment.place,
      notes: row.appointment.notes,
      recordName: AppointmentMapper.toDto(row).record?.name ?? null,
      updatedAt: row.appointment.updated_at ?? row.appointment.created_at
    }))
  }

  /** The calendar as text (also for a one-off export) */
  async calendar(): Promise<{
    ics: string
    count: number
    followUps: number
    appointments: number
  }> {
    const events = await this.events()
    const followUps = this.followUps()
    const appointments = this.appointments()
    return {
      ics: buildCalendar(events, new Date(), followUps, appointments),
      count: events.length,
      followUps: followUps.length,
      appointments: appointments.length
    }
  }

  /** Writes the calendar to `path` (temp file + rename: never half-written) */
  async writeTo(
    path: string
  ): Promise<{ events: number; followUps: number; appointments: number }> {
    const { ics, count, followUps, appointments } = await this.calendar()
    const temp = `${path}.tmp`
    await writeFile(temp, ics, 'utf-8')
    await rename(temp, path)
    return { events: count, followUps, appointments }
  }

  /** Rewrites the feed file now, if one is set */
  async update(): Promise<CalendarFeedStatusDto> {
    const path = this.settings.get().calendarFeedPath
    if (path) {
      try {
        const written = await this.writeTo(path)
        this.lastCount = written.events
        this.lastFollowUpCount = written.followUps
        this.lastAppointmentCount = written.appointments
        this.lastWrittenAt = new Date().toISOString()
        this.lastError = null
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error)
        console.error('Calendar feed update failed:', error)
      }
    }
    return this.status()
  }

  /** Coalesces bursts of changes into one write */
  scheduleUpdate(): void {
    if (!this.settings.get().calendarFeedPath) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.update()
    }, UPDATE_DELAY_MS)
  }

  /** Only when follow-ups or appointments are in the file: their record is named in it */
  scheduleFollowUpUpdate(): void {
    const settings = this.settings.get()
    if (settings.calendarFeedFollowUps || settings.calendarFeedAppointments) this.scheduleUpdate()
  }

  /** Only when own appointments are in the file */
  scheduleAppointmentUpdate(): void {
    if (this.settings.get().calendarFeedAppointments) this.scheduleUpdate()
  }

  status(): CalendarFeedStatusDto {
    const settings = this.settings.get()
    return {
      path: settings.calendarFeedPath,
      lastWrittenAt: this.lastWrittenAt,
      events: this.lastCount,
      includeFollowUps: settings.calendarFeedFollowUps,
      followUps: this.lastFollowUpCount,
      includeAppointments: settings.calendarFeedAppointments,
      appointments: this.lastAppointmentCount,
      error: this.lastError
    }
  }
}

/** For services that change calendar data: rewrite the feed soon */
export function scheduleCalendarUpdate(): void {
  try {
    container.resolve(CalendarFeedService).scheduleUpdate()
  } catch (error) {
    console.error('Calendar feed update could not be scheduled:', error)
  }
}

/**
 * For records follow-ups can be on that are not in the calendar themselves
 * (person, company, invoice): a rename changes the "Zu: ..." line, a delete
 * takes their follow-ups with it (ON DELETE CASCADE)
 */
export function scheduleFollowUpCalendarUpdate(): void {
  try {
    container.resolve(CalendarFeedService).scheduleFollowUpUpdate()
  } catch (error) {
    console.error('Calendar feed update could not be scheduled:', error)
  }
}

/** #71: after an own appointment changes, when appointments are in the file */
export function scheduleAppointmentCalendarUpdate(): void {
  try {
    container.resolve(CalendarFeedService).scheduleAppointmentUpdate()
  } catch (error) {
    console.error('Calendar feed update could not be scheduled:', error)
  }
}
