// #123: the user's own mail templates, inserted while composing a mail in the mail client.
// Subject and text use {Platzhalter}: the event's values once an event is chosen, the
// recipient's name from the first To recipient. A placeholder without a value stays as it
// is, so the user sees what is still to fill in.
//
// Pure (no Node or Electron APIs): the renderer imports it.
import { fillPlaceholders, formatDate, tidySubject } from './invoiceEmail'

/** The placeholders a template can use, in the order the settings list them */
export const MAIL_TEMPLATE_PLACEHOLDERS = [
  'Event',
  'Datum',
  'Beginn',
  'Band',
  'Veranstaltungsort',
  'Ort',
  'LoPro',
  'Empfänger'
] as const
export type MailTemplatePlaceholder = (typeof MAIL_TEMPLATE_PLACEHOLDERS)[number]

/** What the placeholders need from an event */
export type MailTemplateEvent = {
  name: string
  /** ISO date */
  date: string
  /** Free text, "20:00" */
  performanceTime: string
  band: string
  venue: string
  /** The venue's city */
  city: string
  /** The local promoter: the person, else the company */
  lopro: string
}

export function mailTemplateEventValues(
  event: MailTemplateEvent
): Record<Exclude<MailTemplatePlaceholder, 'Empfänger'>, string> {
  return {
    Event: event.name.trim(),
    Datum: formatDate(event.date),
    Beginn: event.performanceTime.trim(),
    Band: event.band.trim(),
    Veranstaltungsort: event.venue.trim(),
    Ort: event.city.trim(),
    LoPro: event.lopro.trim()
  }
}

export function fillMailTemplate(
  template: { subject: string; body: string },
  values: Partial<Record<MailTemplatePlaceholder, string>>
): { subject: string; body: string } {
  // A value that is empty would leave a gap mid-sentence: keep the placeholder instead
  const known: Record<string, string> = {}
  for (const [name, value] of Object.entries(values)) if (value) known[name] = value
  return {
    subject: tidySubject(fillPlaceholders(template.subject, known)),
    body: fillPlaceholders(template.body, known)
  }
}
