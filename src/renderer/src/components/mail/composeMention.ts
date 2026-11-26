// #306: "@Name" in the compose editor. Typing "@" offers the mail's recipients and the
// contacts; the pick becomes a highlighted mention and, when the person is not on the
// mail yet, a recipient under "An" (as Outlook does). Pure rules here, the DOM work in
// ComposeView.
import type { Address } from './composeDraft'

/**
 * The "@" must start a word, so an address typed into the text ("a@example.test") never
 * opens the suggestions. The query runs up to the caret and holds no space: the menu
 * closes once the user types on past a name it did not offer.
 */
const MENTION = /(?:^|[\s([{"'„«])@([^\s@<>]{0,40})$/u

/** The text typed after "@" up to the caret, or null when the caret is not in a mention */
export function mentionQuery(beforeCaret: string): string | null {
  const match = MENTION.exec(beforeCaret.replace(/\u00a0/g, ' '))
  return match ? match[1] : null
}

/** A recipient matches when its name, a word of the name, or its address starts with the query */
function matches(address: Address, query: string): boolean {
  if (!query) return true
  const name = address.name.toLowerCase()
  return (
    name.startsWith(query) ||
    name.split(/\s+/).some((word) => word.startsWith(query)) ||
    address.email.toLowerCase().startsWith(query)
  )
}

/**
 * What the menu offers: the mail's own recipients first (they are who a mention is usually
 * about), then the contact search's hits, each address once.
 */
export function mentionCandidates(
  query: string,
  recipients: Address[],
  contacts: Address[],
  limit = 8
): Address[] {
  const q = query.toLowerCase()
  const seen = new Set<string>()
  const out: Address[] = []
  for (const address of [...recipients.filter((a) => matches(a, q)), ...contacts]) {
    const key = address.email.toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ name: address.name, email: address.email })
    if (out.length >= limit) break
  }
  return out
}

/** The text a mention shows: the name, or the address when there is none */
export function mentionLabel(address: Address): string {
  return address.name.trim() || address.email
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * The mention as the editor holds it. A mailto link, so the sent mail keeps it as a link to
 * the person (the compose allowlist keeps the href and drops the class); in the editor the
 * class highlights it. The space after it lets the user type on outside the link.
 *
 * No contenteditable=false: Chromium's insertHTML lifts such an element out of its paragraph,
 * so the sentence broke at the mention.
 */
export function mentionHtml(address: Address): string {
  return (
    `<a href="mailto:${escapeAttr(address.email)}" class="mention">` +
    `@${escapeHtml(mentionLabel(address))}</a>&nbsp;`
  )
}

/**
 * The recipients after a mention: unchanged (null) when the person is already on the mail
 * under An, Cc or Bcc, otherwise added under An.
 */
export function addMentioned(
  mail: { to: Address[]; cc: Address[]; bcc: Address[] },
  address: Address
): { to: Address[] } | null {
  const key = address.email.trim().toLowerCase()
  if (!key) return null
  const onMail = [...mail.to, ...mail.cc, ...mail.bcc].some((a) => a.email.toLowerCase() === key)
  if (onMail) return null
  return { to: [...mail.to, { name: address.name.trim(), email: address.email.trim() }] }
}
