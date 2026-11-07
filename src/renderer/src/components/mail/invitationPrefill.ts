// #71: "Als Termin übernehmen" in the reader. Which part of a mail is its invitation, and what
// the appointment dialog opens with (pure, unit-tested; the parser is main/calendar/invitation).
import type { AttachmentInfo } from '../../../../main/mailclient/core/types'
import { isCalendarPart, type Invitation } from '../../../../main/calendar/invitation'
import { eventNameFromSubject } from './eventPrefill'

/**
 * The calendar part to take over: an iMIP text/calendar part before an attached .ics, so the
 * invitation itself wins over a copy attached to it. Null when the mail has none.
 */
export function invitationPart(attachments: readonly AttachmentInfo[]): AttachmentInfo | null {
  const parts = attachments.filter(isCalendarPart)
  return parts.find((part) => /^text\/calendar\b/i.test(part.contentType)) ?? parts[0] ?? null
}

/** The bytes of a calendar part as text (RFC 5545: UTF-8); TextDecoder drops a byte order mark */
export function calendarText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

/** An invitation without SUMMARY takes the mail's subject as title */
export function withTitle(invitation: Invitation, subject: string): Invitation {
  if (invitation.title) return invitation
  return { ...invitation, title: eventNameFromSubject(subject).slice(0, 200) }
}
