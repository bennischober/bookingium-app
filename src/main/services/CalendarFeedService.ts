import { singleton, inject, container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { rename, writeFile } from 'fs/promises'
import { db } from '../db'
import { schema } from '../db/schema'
import { notArchived } from '../repositories/archiveFilter'
import { SettingsService } from './SettingsService'
import { buildCalendar, type CalendarEvent } from '../calendar/ics'
import type { CalendarFeedStatusDto } from '../api/schemas/settings.schema'

const UPDATE_DELAY_MS = 1500

/**
 * Keeps the calendar file chosen in Einstellungen (calendarFeedPath) up to
 * date: rewritten shortly after events, bands, venues or hotels change, and
 * on start. Calendar apps subscribed to the file (or its shared link) pick
 * the changes up on their next refresh.
 */
// One instance: it owns the pending write and the last status
@singleton()
export class CalendarFeedService {
  private timer: NodeJS.Timeout | null = null
  private lastWrittenAt: string | null = null
  private lastError: string | null = null
  private lastCount = 0

  constructor(@inject(SettingsService) private settings: SettingsService) {}

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

  /** The calendar as text (also for a one-off export) */
  async calendar(): Promise<{ ics: string; count: number }> {
    const events = await this.events()
    return { ics: buildCalendar(events), count: events.length }
  }

  /** Writes the calendar to `path` (temp file + rename: never half-written) */
  async writeTo(path: string): Promise<number> {
    const { ics, count } = await this.calendar()
    const temp = `${path}.tmp`
    await writeFile(temp, ics, 'utf-8')
    await rename(temp, path)
    return count
  }

  /** Rewrites the feed file now, if one is set */
  async update(): Promise<CalendarFeedStatusDto> {
    const path = this.settings.get().calendarFeedPath
    if (path) {
      try {
        this.lastCount = await this.writeTo(path)
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

  status(): CalendarFeedStatusDto {
    return {
      path: this.settings.get().calendarFeedPath,
      lastWrittenAt: this.lastWrittenAt,
      events: this.lastCount,
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
