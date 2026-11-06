import { emptyCompose, type ComposeState } from './composeDraft'

/**
 * #136: a new mail another page asks the mail page to open, such as the mailing list's
 * "E-Mail schreiben" with its addresses in BCC. Kept in memory, not in the URL: a list
 * has hundreds of addresses, and a reload or Back must not open the mail again. The
 * mail page takes it once, on the first account that can send.
 */
let pending: ComposeState | null = null

export function requestBccCompose(emails: readonly string[]): void {
  pending = { ...emptyCompose(), bcc: emails.map((email) => ({ name: '', email })) }
}

export function takePendingCompose(): ComposeState | null {
  const state = pending
  pending = null
  return state
}

export function hasPendingCompose(): boolean {
  return pending !== null
}
