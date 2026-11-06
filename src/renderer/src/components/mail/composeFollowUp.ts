// #121: "Wiedervorlage ohne Antwort" in the editor. A send with a choice made leaves a
// follow-up that names the sent mail; main's linker closes it when a reply comes.
import { addDays, localIsoDate } from '@/lib/followUps'
import {
  FollowUpRecord,
  type CreateFollowUpInput
} from '../../../../main/api/schemas/followUp.schema'

/** The choices next to "Senden"; 'none' (the default) leaves no follow-up */
export const FOLLOW_UP_CHOICES = [
  { value: 'none', label: 'Keine' },
  { value: '3', label: 'In 3 Tagen' },
  { value: '7', label: 'In 1 Woche' },
  { value: '14', label: 'In 2 Wochen' }
] as const
export type FollowUpChoice = (typeof FOLLOW_UP_CHOICES)[number]['value']

/** The follow-up a send leaves, or null when none was chosen */
export function followUpForSend(input: {
  choice: FollowUpChoice
  subject: string
  accountId: string
  messageId: string
  record?: FollowUpRecord | null
  today?: string
}): CreateFollowUpInput | null {
  if (input.choice === 'none' || !input.messageId) return null
  const subject = input.subject.trim()
  return {
    dueDate: addDays(input.today ?? localIsoDate(), Number(input.choice)),
    note: subject ? `Antwort auf „${subject}“` : 'Antwort auf eine E-Mail ohne Betreff',
    ...(input.record ? { record: input.record } : {}),
    mail: { accountId: input.accountId, messageId: input.messageId }
  }
}

/** The `record` of the window's query ("invoice:12"), or null when it is none */
export function parseRecordParam(value: unknown): FollowUpRecord | null {
  if (value == null) return null
  const [type, id] = String(value).split(':')
  const parsed = FollowUpRecord.safeParse({ type, id: Number(id) })
  return parsed.success ? parsed.data : null
}
