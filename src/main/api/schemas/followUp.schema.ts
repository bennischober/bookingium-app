import { z } from 'zod'
import { DOCUMENT_OWNER_TYPES } from './document.schema'

/** Records a follow-up can be on: those that own documents ('event' = deal memo), and invoices */
export const FollowUpRecordType = z.enum([...DOCUMENT_OWNER_TYPES, 'invoice'])
export type FollowUpRecordType = z.infer<typeof FollowUpRecordType>

export const FollowUpRecord = z.object({
  type: FollowUpRecordType,
  id: z.number().int()
})
export type FollowUpRecord = z.infer<typeof FollowUpRecord>

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum ist erforderlich')
const Note = z.string().trim().min(1, 'Notiz ist erforderlich')

/** #121: the sent mail a follow-up waits for an answer to */
export const FollowUpMail = z.object({
  accountId: z.string().min(1),
  // stored without the angle brackets
  messageId: z
    .string()
    .transform((id) => id.trim().replace(/^</, '').replace(/>$/, '').trim())
    .pipe(z.string().min(1))
})
export type FollowUpMail = z.infer<typeof FollowUpMail>

export const FollowUpDto = z.object({
  id: z.number(),
  dueDate: z.string(),
  note: z.string(),
  doneAt: z.string().nullable(),
  // null: a general follow-up; an event's name with its date, e.g. "München (11.06.2026)"
  record: FollowUpRecord.extend({ name: z.string() }).nullable(),
  // #121: the sent mail it waits for an answer to, and when one came (SQLite UTC)
  mail: z.object({ accountId: z.string(), messageId: z.string() }).nullable(),
  repliedAt: z.string().nullable()
})
export type FollowUpDto = z.infer<typeof FollowUpDto>

export const CreateFollowUpInput = z.object({
  dueDate: IsoDate,
  note: Note,
  record: FollowUpRecord.optional(),
  mail: FollowUpMail.optional()
})
export type CreateFollowUpInput = z.infer<typeof CreateFollowUpInput>

export const UpdateFollowUpInput = z.object({
  id: z.number().int(),
  dueDate: IsoDate.optional(),
  note: Note.optional()
})
export type UpdateFollowUpInput = z.infer<typeof UpdateFollowUpInput>

/** #52: the history of done follow-ups, in pages that grow */
export const ListDoneFollowUpsInput = z.object({
  limit: z.number().int().min(1).max(1000).default(50)
})
export type ListDoneFollowUpsInput = z.infer<typeof ListDoneFollowUpsInput>

export const FollowUpHistoryDto = z.object({
  items: z.array(FollowUpDto),
  // More done ones beyond `limit`
  hasMore: z.boolean()
})
export type FollowUpHistoryDto = z.infer<typeof FollowUpHistoryDto>

export const SetFollowUpDoneInput = z.object({
  id: z.number().int(),
  done: z.boolean()
})
export type SetFollowUpDoneInput = z.infer<typeof SetFollowUpDoneInput>
