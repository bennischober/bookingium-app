import { z } from 'zod'
import { DOCUMENT_OWNER_TYPES } from './document.schema'
import { appointmentTimesError, REMINDER_MAX_MINUTES } from '../../calendar/appointments'

/** #71: records an appointment can be on, the same five as documents ('event' = deal memo) */
export const AppointmentRecordType = z.enum(DOCUMENT_OWNER_TYPES)
export type AppointmentRecordType = z.infer<typeof AppointmentRecordType>

export const AppointmentRecord = z.object({
  type: AppointmentRecordType,
  id: z.number().int()
})
export type AppointmentRecord = z.infer<typeof AppointmentRecord>

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum ist erforderlich')
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit als HH:MM')
const Title = z.string().trim().min(1, 'Titel ist erforderlich').max(200)
const Place = z.string().trim().max(500)
const Notes = z.string().max(10_000)
const ReminderMinutes = z.number().int().min(0).max(REMINDER_MAX_MINUTES)
const IcalUid = z.string().trim().min(1).max(500)

export const AppointmentDto = z.object({
  id: z.number(),
  title: z.string(),
  startDate: z.string(),
  // null: all-day
  startTime: z.string().nullable(),
  endDate: z.string(),
  endTime: z.string().nullable(),
  place: z.string(),
  notes: z.string(),
  // null: no reminder
  reminderMinutes: z.number().nullable(),
  // null: not on a record; an event's name with its date, e.g. "München (11.06.2026)"
  record: AppointmentRecord.extend({ name: z.string() }).nullable(),
  // null: made in the app, not taken over from an invitation
  icalUid: z.string().nullable()
})
export type AppointmentDto = z.infer<typeof AppointmentDto>

export const CreateAppointmentInput = z
  .object({
    title: Title,
    startDate: IsoDate,
    startTime: Time.nullable(),
    endDate: IsoDate,
    endTime: Time.nullable(),
    place: Place.optional(),
    notes: Notes.optional(),
    reminderMinutes: ReminderMinutes.nullable().optional(),
    record: AppointmentRecord.nullable().optional(),
    // Taken over from an invitation; an appointment with this UID already there is refused
    icalUid: IcalUid.optional()
  })
  .superRefine((input, ctx) => {
    const error = appointmentTimesError(input)
    if (error) ctx.addIssue({ code: 'custom', message: error, path: ['endDate'] })
  })
export type CreateAppointmentInput = z.infer<typeof CreateAppointmentInput>

/**
 * Only the given keys change (moving sends the times alone); the service checks the merged
 * times. `record: null` takes the link off.
 */
export const UpdateAppointmentInput = z.object({
  id: z.number().int(),
  title: Title.optional(),
  startDate: IsoDate.optional(),
  startTime: Time.nullable().optional(),
  endDate: IsoDate.optional(),
  endTime: Time.nullable().optional(),
  place: Place.optional(),
  notes: Notes.optional(),
  reminderMinutes: ReminderMinutes.nullable().optional(),
  record: AppointmentRecord.nullable().optional()
})
export type UpdateAppointmentInput = z.infer<typeof UpdateAppointmentInput>

/** The appointments on any day from `from` to `to` (YYYY-MM-DD, both included) */
export const ListAppointmentsInput = z
  .object({ from: IsoDate, to: IsoDate })
  .refine((input) => input.from <= input.to, 'Der Zeitraum endet vor seinem Beginn')
export type ListAppointmentsInput = z.infer<typeof ListAppointmentsInput>

/** The appointment taken over from the invitation with this UID */
export const AppointmentByIcalUidInput = z.object({ uid: IcalUid })
