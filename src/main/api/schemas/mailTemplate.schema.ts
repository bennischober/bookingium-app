import { z } from 'zod'

// #123: the user's own mail templates (E-Mail-Vorlagen) for the mail client. #136: the eight
// fixed texts for invoices, reminders, dunning letters and contracts live in the same table
// (kind + lang); they can be edited and reset, not renamed or deleted.

export const MailTemplateDto = z.object({
  id: z.number(),
  name: z.string(),
  subject: z.string(),
  body: z.string()
})
export type MailTemplateDto = z.infer<typeof MailTemplateDto>

// A full replace: every field is sent, so nothing is defaulted over a stored value
export const SaveMailTemplateInput = z.object({
  // Omitted: a new template
  id: z.number().optional(),
  name: z.string().trim().min(1, 'Name ist erforderlich'),
  subject: z.string(),
  body: z.string()
})
export type SaveMailTemplateInput = z.infer<typeof SaveMailTemplateInput>

export const DocumentEmailKind = z.enum(['invoice', 'reminder', 'dunning', 'contract'])
export const DocumentEmailLang = z.enum(['de', 'en'])

export const DocumentTemplateDto = z.object({
  kind: DocumentEmailKind,
  lang: DocumentEmailLang,
  subject: z.string(),
  body: z.string(),
  // The user changed it; "Zurücksetzen" goes back to the default
  edited: z.boolean()
})
export type DocumentTemplateDto = z.infer<typeof DocumentTemplateDto>

export const DocumentTemplateRef = z.object({ kind: DocumentEmailKind, lang: DocumentEmailLang })
export type DocumentTemplateRef = z.infer<typeof DocumentTemplateRef>

export const SaveDocumentTemplateInput = DocumentTemplateRef.extend({
  subject: z.string(),
  body: z.string()
})
export type SaveDocumentTemplateInput = z.infer<typeof SaveDocumentTemplateInput>
