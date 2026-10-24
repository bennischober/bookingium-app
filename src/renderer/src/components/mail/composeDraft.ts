import type { DraftInput, MessageDetail, SavedDraft } from '../../../../main/mailclient/core/types'

export type Address = { name: string; email: string }

/** What the editor holds: the mail itself plus where its saved version is */
export type ComposeState = DraftInput & {
  /** UID of the saved version in Drafts; it is replaced on the next save and removed on send */
  draftUid: number | null
  /** Attachments a forward takes along from the original (the core adds them) */
  forwardedNames: string[]
}

// The same check the core makes before it builds the mail
const EMAIL = /^[^\s<>()",;:@\\]+@[^\s<>()",;:@\\]+$/

export function isValidEmail(email: string): boolean {
  return EMAIL.test(email)
}

/** "Name <a@b.de>", "<a@b.de>" or "a@b.de"; the address is not checked here */
export function parseAddress(text: string): Address {
  const match = text.trim().match(/^(.*?)\s*<([^<>]*)>$/)
  if (!match) return { name: '', email: text.trim() }
  return { name: match[1].trim().replace(/^"(.*)"$/, '$1'), email: match[2].trim() }
}

export function emptyCompose(): ComposeState {
  return {
    to: [],
    cc: [],
    bcc: [],
    subject: '',
    bodyText: '',
    bodyHtml: null,
    inReplyTo: null,
    references: [],
    attachments: [],
    draftUid: null,
    forwardedNames: []
  }
}

/** The body as plain text; HTML-only mails are reduced to their text */
function plainText(message: MessageDetail): string {
  if (message.text) return message.text
  if (!message.html || typeof DOMParser === 'undefined') return ''
  return new DOMParser().parseFromString(message.html, 'text/html').body.textContent ?? ''
}

function sender(message: MessageDetail): string {
  return message.fromName || message.fromEmail
}

function formatDate(message: MessageDetail): string {
  const iso = message.date ?? message.internalDate
  return iso
    ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
    : 'unbekanntem Datum'
}

function prefixed(subject: string, prefix: string, known: RegExp): string {
  const clean = subject.trim()
  return known.test(clean) ? clean : `${prefix}: ${clean}`
}

function uniqueWithout(list: Address[], exclude: string[]): Address[] {
  const seen = new Set(exclude.map((e) => e.toLowerCase()))
  return list.filter((a) => {
    const key = a.email.toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function replyCompose(
  message: MessageDetail,
  { all, ownEmail }: { all: boolean; ownEmail: string }
): ComposeState {
  const from = { name: message.fromName, email: message.fromEmail }
  // A reply to your own mail goes to its recipients again
  const fromSelf = message.fromEmail.toLowerCase() === ownEmail.toLowerCase()
  const to = fromSelf ? message.to : [from]
  const others = all ? uniqueWithout([...to, ...message.to, ...message.cc], [ownEmail]) : []
  const toList = uniqueWithout(to, fromSelf ? [ownEmail] : [])
  const quoted = plainText(message)
    .replace(/\s+$/, '')
    .split(/\r?\n/)
    .map((line) => (line.startsWith('>') ? `>${line}` : `> ${line}`))
    .join('\n')
  return {
    ...emptyCompose(),
    to: toList.length ? toList : [from],
    cc: uniqueWithout(
      others,
      toList.map((a) => a.email)
    ),
    subject: prefixed(message.subject, 'AW', /^(aw|re|antw)\s*:/i),
    bodyText: `\n\nAm ${formatDate(message)} schrieb ${sender(message)}:\n${quoted}\n`,
    inReplyTo: message.messageId,
    references: message.messageId
      ? [...message.references.filter((r) => r !== message.messageId), message.messageId]
      : message.references,
    repliesTo: message.id
  }
}

export function forwardCompose(message: MessageDetail): ComposeState {
  const field = (list: Address[]) =>
    list.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ')
  const header = [
    FORWARD_HEADER,
    `Von: ${field([{ name: message.fromName, email: message.fromEmail }])}`,
    `Datum: ${formatDate(message)}`,
    `Betreff: ${message.subject}`,
    `An: ${field(message.to)}`,
    ...(message.cc.length ? [`Cc: ${field(message.cc)}`] : [])
  ].join('\n')
  return {
    ...emptyCompose(),
    subject: prefixed(message.subject, 'WG', /^(wg|fw|fwd)\s*:/i),
    bodyText: `\n\n${header}\n\n${plainText(message).replace(/\s+$/, '')}\n`,
    forwardsFrom: message.id,
    forwardedNames: message.attachments
      .filter((a) => !a.isInline || !a.contentId)
      .map((a) => a.filename || 'Anhang')
  }
}

/** Marks the start of a forwarded mail's header block (B8: the signature goes above it) */
const FORWARD_HEADER = '---------- Weitergeleitete Nachricht ----------'

/**
 * B8: the signature goes between the new text and the quote, and only once. * The editor keeps the body as plain text, so a signature is appended as text.
 * `hasSignature` decides from the existing body, which is what makes reopening a
 * draft idempotent: the second call sees its own signature and adds nothing.
 */
export function withSignature(state: ComposeState, signature: string | undefined): ComposeState {
  const text = signature?.trim()
  if (!text || state.bodyText.includes(text)) return state
  // Above the quote: everything from the first quoted line or the forwarded header
  // stays below the signature
  const lines = state.bodyText.split('\n')
  const quoteAt = lines.findIndex((line) => line.startsWith('>') || line.startsWith(FORWARD_HEADER))
  const body =
    quoteAt < 0
      ? `${state.bodyText.replace(/\s+$/, '')}\n\n${text}\n`
      : [
          ...lines.slice(0, quoteAt).join('\n').replace(/\s+$/, ''),
          '',
          text,
          '',
          ...lines.slice(quoteAt)
        ].join('\n')
  return { ...state, bodyText: body }
}

/** A draft opened from Drafts: its attachments are its own now, nothing is forwarded */
export function fromSavedDraft(draft: SavedDraft): ComposeState {
  return {
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    bodyText: draft.bodyText,
    bodyHtml: null,
    inReplyTo: draft.inReplyTo,
    references: draft.references,
    attachments: draft.attachments,
    draftUid: draft.uid,
    forwardedNames: []
  }
}

/** The part of the editor state the core stores or sends (plain text only for now) */
export function toDraftInput(state: ComposeState): DraftInput {
  return {
    to: state.to,
    cc: state.cc,
    bcc: state.bcc,
    subject: state.subject,
    bodyText: state.bodyText,
    bodyHtml: null,
    inReplyTo: state.inReplyTo,
    references: state.references,
    attachments: state.attachments,
    repliesTo: state.repliesTo ?? null,
    forwardsFrom: state.forwardsFrom ?? null
  }
}

/** B7: most providers refuse mails above 20-25 MB, and base64 adds a third on top */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

/** The decoded size of one base64 attachment, without decoding it */
export function base64Bytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4)
}

/**
 * B7: would these attachments fit? Checked before anything is read, so an oversized
 * file never becomes a 20 MB string in memory first.
 */
export function attachmentsFit(
  existing: { base64: string }[],
  incoming: { size: number }[],
  limit = MAX_ATTACHMENT_BYTES
): boolean {
  const used = existing.reduce((n, a) => n + base64Bytes(a.base64), 0)
  return used + incoming.reduce((n, f) => n + f.size, 0) <= limit
}

/**
 * F2: a NEW mail to one address from an open mail's header ("Von", "An", "Cc").
 *
 * Not a reply and not a forward: no quote, no In-Reply-To/References (it must not
 * land in the old thread) and no attachments. Only the recipient travels over -
 * the subject stays empty, because a new mail is not about the old subject.
 */
export function composeTo(address: Address, signature?: string): ComposeState {
  const state: ComposeState = {
    ...emptyCompose(),
    to: [{ name: address.name.trim(), email: address.email.trim() }]
  }
  return withSignature(state, signature)
}
