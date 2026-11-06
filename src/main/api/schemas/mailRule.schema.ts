import { z } from 'zod'

// #124: rules for incoming mail (E-Mail-Regeln). A rule names conditions on the sender, the
// recipients and the subject, and what happens to a matching mail in the INBOX: marked read,
// flagged, moved to a folder on the server (writable accounts only) or linked to a record.

/** The records a rule can link to; the same five as "Zuordnen…" */
export const MailRuleLinkType = z.enum(['person', 'company', 'venue', 'band', 'event'])
export type MailRuleLinkType = z.infer<typeof MailRuleLinkType>

export const MailRuleDto = z.object({
  id: z.number(),
  accountId: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  position: z.number(),
  matchFrom: z.string(),
  matchTo: z.string(),
  matchSubject: z.string(),
  moveToFolderPath: z.string().nullable(),
  markRead: z.boolean(),
  markFlagged: z.boolean(),
  link: z
    .object({
      entityType: MailRuleLinkType,
      entityId: z.number(),
      // The record's name; null when the record no longer exists
      label: z.string().nullable()
    })
    .nullable(),
  hitCount: z.number(),
  lastAppliedAt: z.string().nullable(),
  lastError: z.string().nullable()
})
export type MailRuleDto = z.infer<typeof MailRuleDto>

// A full replace: every field is sent, so nothing is defaulted over a stored value
export const SaveMailRuleInput = z
  .object({
    // Omitted: a new rule, placed last
    id: z.number().optional(),
    accountId: z.string().min(1, 'Konto ist erforderlich'),
    name: z.string().trim().min(1, 'Name ist erforderlich'),
    enabled: z.boolean(),
    matchFrom: z.string().trim(),
    matchTo: z.string().trim(),
    matchSubject: z.string().trim(),
    moveToFolderPath: z.string().min(1).nullable(),
    markRead: z.boolean(),
    markFlagged: z.boolean(),
    link: z.object({ entityType: MailRuleLinkType, entityId: z.number().int() }).nullable()
  })
  .refine((rule) => Boolean(rule.matchFrom || rule.matchTo || rule.matchSubject), {
    message: 'Geben Sie mindestens eine Bedingung an.',
    path: ['matchFrom']
  })
  .refine(
    (rule) => Boolean(rule.moveToFolderPath || rule.markRead || rule.markFlagged || rule.link),
    { message: 'Wählen Sie mindestens eine Aktion.', path: ['moveToFolderPath'] }
  )
export type SaveMailRuleInput = z.infer<typeof SaveMailRuleInput>

export const SetMailRuleEnabledInput = z.object({ id: z.number(), enabled: z.boolean() })
export type SetMailRuleEnabledInput = z.infer<typeof SetMailRuleEnabledInput>

export const MoveMailRuleInput = z.object({ id: z.number(), direction: z.enum(['up', 'down']) })
export type MoveMailRuleInput = z.infer<typeof MoveMailRuleInput>

/** The alternatives of one condition: split on , and ; and trimmed */
export function ruleAlternatives(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
}
