import { z } from 'zod'

// #123: the user's own mail templates (E-Mail-Vorlagen) for the mail client. The fixed
// templates for invoices, reminders and contracts stay in the settings (EMAIL_TEMPLATES).

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
