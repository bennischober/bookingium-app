import { z } from 'zod'
import { DOCUMENT_OWNER_TYPES } from './document.schema'

/** Records a follow-up can be on: the same ones that own documents ('event' = deal memo) */
export const FollowUpRecordType = z.enum(DOCUMENT_OWNER_TYPES)
export type FollowUpRecordType = z.infer<typeof FollowUpRecordType>

export const FollowUpRecord = z.object({
  type: FollowUpRecordType,
  id: z.number().int()
})
export type FollowUpRecord = z.infer<typeof FollowUpRecord>

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum ist erforderlich')
const Note = z.string().trim().min(1, 'Notiz ist erforderlich')

export const FollowUpDto = z.object({
  id: z.number(),
  dueDate: z.string(),
  note: z.string(),
  doneAt: z.string().nullable(),
  // null: a general follow-up; an event's name with its date, e.g. "München (11.06.2026)"
  record: FollowUpRecord.extend({ name: z.string() }).nullable()
})
export type FollowUpDto = z.infer<typeof FollowUpDto>

export const CreateFollowUpInput = z.object({
  dueDate: IsoDate,
  note: Note,
  record: FollowUpRecord.optional()
})
export type CreateFollowUpInput = z.infer<typeof CreateFollowUpInput>

export const UpdateFollowUpInput = z.object({
  id: z.number().int(),
  dueDate: IsoDate.optional(),
  note: Note.optional()
})
export type UpdateFollowUpInput = z.infer<typeof UpdateFollowUpInput>

export const SetFollowUpDoneInput = z.object({
  id: z.number().int(),
  done: z.boolean()
})
export type SetFollowUpDoneInput = z.infer<typeof SetFollowUpDoneInput>
