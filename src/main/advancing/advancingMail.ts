// #235: the advancing mail of a show and what a promoter's mail says about it. Pure.

import type { AdvancingStatus } from '../api/schemas/advancing.schema'
import type { ComposeDraft } from '../mail/composeWindow'

export type AdvancingMailShow = {
  date: string
  bandName: string
  venueName: string
  city: string
  performanceTime: string | null
}

type Person = { firstName: string; lastName: string; email: string | null } | undefined

/** "Fr., 13.11.2026" */
const showDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  })

const address = (person: {
  firstName?: string
  lastName?: string
  name?: string
  email: string | null
}) => {
  const email = (person.email ?? '').trim()
  if (!email) return ''
  const name = (person.name ?? [person.firstName, person.lastName].filter(Boolean).join(' ')).trim()
  return name ? `${name.replace(/[",<>]/g, '')} <${email}>` : email
}

/**
 * The advancing mail: to the promoter's contact (else the promoter), the contact on site in cc;
 * the questions every show needs answered
 */
export function advancingDraft(
  show: AdvancingMailShow,
  people: {
    promoterPerson: Person
    promoterCompany: { name: string; email: string | null } | undefined
    local: Person
  },
  signature = ''
): ComposeDraft {
  const to = people.promoterPerson?.email
    ? address(people.promoterPerson)
    : people.promoterCompany?.email
      ? address(people.promoterCompany)
      : ''
  const cc =
    people.local?.email && people.local.email !== people.promoterPerson?.email
      ? address(people.local)
      : ''
  const greeting = people.promoterPerson?.firstName
    ? `Hallo ${people.promoterPerson.firstName},`
    : 'Hallo,'
  const place = [show.venueName, show.city].filter(Boolean).join(', ')
  const lines = [
    greeting,
    '',
    `für die Show von ${show.bandName} am ${showDate(show.date)}${place ? ` (${place})` : ''} würden wir gern die Details abstimmen:`,
    '',
    '- Ansprechpartner vor Ort (Name, Handynummer)',
    '- Load-in / Get-in',
    '- Soundcheck',
    '- Einlass (Doors)',
    `- Showtime${show.performanceTime ? ` (bei uns notiert: ${show.performanceTime})` : ''} und Curfew`,
    '- Parken (Bus/Transporter), Adresse für die Anfahrt',
    '- Catering / Buyout',
    '- Hotel',
    '- Gästeliste',
    '- Merch (Fläche, Abgabe)',
    '- Aktueller Ticketstand',
    '',
    'Vielen Dank und viele Grüße'
  ]
  const body = signature ? `${lines.join('\n')}\n\n${signature}` : lines.join('\n')
  return {
    to,
    cc,
    subject: `Advancing ${show.bandName} – ${showDate(show.date)}${place ? `, ${place}` : ''}`,
    body
  }
}

/**
 * A ticket count in a mail's subject or text ("aktuell 143 Tickets verkauft", "VVK-Stand: 212"),
 * null for none
 */
export function soldInText(text: string): number | null {
  const patterns = [
    /(\d{1,3}(?:\.\d{3})*|\d{1,6})\s*(?:tickets?|karten)\b[^.\n]{0,20}?(?:verkauft|weg|sold)/i,
    /(?:verkauft|vvk[- ]?stand|ticketstand|stand|sold)\s*[:=]?\s*(?:sind|bei|aktuell)?\s*(\d{1,3}(?:\.\d{3})*|\d{1,6})\b/i,
    /(\d{1,3}(?:\.\d{3})*|\d{1,6})\s*(?:tickets?|karten)\b/i
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match) return Number(match[1].replace(/\./g, ''))
  }
  return null
}

/** The stage a mail from the promoter's side suggests: a reply moves "angeschrieben" on */
export function suggestedStage(current: AdvancingStatus): AdvancingStatus | null {
  return current === 'open' || current === 'contacted' ? 'in_progress' : null
}
