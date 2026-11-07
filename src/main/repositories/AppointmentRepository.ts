import { injectable } from 'tsyringe'
import {
  and,
  asc,
  between,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
  type SQL
} from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { AppointmentRecord, AppointmentRecordType } from '../api/schemas/appointment.schema'

const RECORD_KEYS = {
  event: 'event_id',
  band: 'band_id',
  venue: 'venue_id',
  company: 'company_id',
  person: 'person_id'
} as const satisfies Record<AppointmentRecordType, keyof typeof schema.appointment.$inferInsert>

/** All-day first (NULL sorts first), then by time */
const START_FIRST = [
  asc(schema.appointment.start_date),
  asc(schema.appointment.start_time),
  asc(schema.appointment.id)
]

/** The stored fields of an appointment, as the service has merged them */
export interface AppointmentFields {
  title: string
  startDate: string
  startTime: string | null
  endDate: string
  endTime: string | null
  place: string
  notes: string
  reminderMinutes: number | null
  record: AppointmentRecord | null
}

/** The link columns for `record`: the chosen one set, the others cleared */
function recordColumns(record: AppointmentRecord | null) {
  const columns = {
    event_id: null as number | null,
    band_id: null as number | null,
    venue_id: null as number | null,
    company_id: null as number | null,
    person_id: null as number | null
  }
  if (record) columns[RECORD_KEYS[record.type]] = record.id
  return columns
}

function columns(fields: AppointmentFields) {
  return {
    title: fields.title,
    start_date: fields.startDate,
    start_time: fields.startTime,
    end_date: fields.endDate,
    end_time: fields.endTime,
    place: fields.place,
    notes: fields.notes,
    reminder_minutes: fields.reminderMinutes,
    ...recordColumns(fields.record)
  }
}

/** An appointment with the names of the record it is on */
export type AppointmentRow = ReturnType<AppointmentRepository['listAll']>[number]

/** What the reminder check needs of an appointment */
export type ReminderCandidate = ReturnType<AppointmentRepository['reminderCandidates']>[number]

@injectable()
export class AppointmentRepository {
  private select(where: SQL | undefined) {
    return db
      .select({
        appointment: schema.appointment,
        eventName: schema.deal_memo.name,
        eventDate: schema.deal_memo.date,
        bandName: schema.band.name,
        venueName: schema.venue.name,
        companyName: schema.company.name,
        personFirstName: schema.person.first_name,
        personLastName: schema.person.last_name
      })
      .from(schema.appointment)
      .leftJoin(schema.deal_memo, eq(schema.appointment.event_id, schema.deal_memo.id))
      .leftJoin(schema.band, eq(schema.appointment.band_id, schema.band.id))
      .leftJoin(schema.venue, eq(schema.appointment.venue_id, schema.venue.id))
      .leftJoin(schema.company, eq(schema.appointment.company_id, schema.company.id))
      .leftJoin(schema.person, eq(schema.appointment.person_id, schema.person.id))
      .where(where)
      .orderBy(...START_FIRST)
      .all()
  }

  /** Every appointment, the earliest first (the calendar file) */
  listAll() {
    return this.select(undefined)
  }

  /** Appointments on any day from `from` to `to` (both included), several-day ones too */
  listBetween(from: string, to: string) {
    return this.select(
      and(lte(schema.appointment.start_date, to), gte(schema.appointment.end_date, from))
    )
  }

  getById(id: number) {
    return this.select(eq(schema.appointment.id, id))[0] ?? null
  }

  /** Not yet reminded appointments with a reminder that start from `from` to `to` */
  reminderCandidates(from: string, to: string) {
    return db
      .select({
        id: schema.appointment.id,
        startDate: schema.appointment.start_date,
        startTime: schema.appointment.start_time,
        reminderMinutes: schema.appointment.reminder_minutes
      })
      .from(schema.appointment)
      .where(
        and(
          isNotNull(schema.appointment.reminder_minutes),
          isNull(schema.appointment.reminded_at),
          between(schema.appointment.start_date, from, to)
        )
      )
      .orderBy(...START_FIRST)
      .all()
  }

  markReminded(ids: readonly number[]): void {
    if (ids.length === 0) return
    db.update(schema.appointment)
      .set({ reminded_at: sql`datetime('now')` })
      .where(inArray(schema.appointment.id, [...ids]))
      .run()
  }

  create(fields: AppointmentFields): number {
    return db
      .insert(schema.appointment)
      .values(columns(fields))
      .returning({ id: schema.appointment.id })
      .get().id
  }

  /** Writes every field; `resetReminder` clears reminded_at, so the reminder fires again */
  update(id: number, fields: AppointmentFields, resetReminder: boolean): void {
    db.update(schema.appointment)
      .set({
        ...columns(fields),
        ...(resetReminder && { reminded_at: null }),
        updated_at: sql`datetime('now')`
      })
      .where(eq(schema.appointment.id, id))
      .run()
  }

  delete(id: number): void {
    db.delete(schema.appointment).where(eq(schema.appointment.id, id)).run()
  }
}
