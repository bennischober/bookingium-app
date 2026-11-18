/**
 * #214: "Spam" / "Kein Spam" and "Absender immer als Spam", in a pure module so vitest can hold
 * the decisions. The app has no spam filter of its own: the provider fills the account's Junk
 * folder on the server. These actions only move mail there and back, and block a sender with an
 * ordinary mail rule (#124), so every step stays visible and can be undone.
 */
import type { FolderNode } from '../../../../main/mailclient/core/types'
import type { SaveMailRuleInput } from '../../../../main/api/schemas/mailRule.schema'

/** A list row as far as these decisions read it */
export type SpamItem = { id: number; folderId: string }

/** The account's Junk folder (special-use \Junk), or none */
export function junkFolderOf(folders: FolderNode[]): FolderNode | undefined {
  return folders.find((f) => f.specialUse?.includes('Junk'))
}

/** The account's inbox, where "Kein Spam" puts a mail back */
export function inboxOf(folders: FolderNode[]): FolderNode | undefined {
  return folders.find((f) => f.path.toUpperCase() === 'INBOX')
}

/** Which of the mails "Spam" moves (not in Junk yet) and which "Kein Spam" moves (in Junk) */
export function spamTargets(
  items: SpamItem[],
  folders: FolderNode[]
): { toSpam: number[]; notSpam: number[] } {
  const junk = junkFolderOf(folders)
  if (!junk) return { toSpam: [], notSpam: [] }
  return {
    toSpam: items.filter((item) => item.folderId !== junk.id).map((item) => item.id),
    notSpam: items.filter((item) => item.folderId === junk.id).map((item) => item.id)
  }
}

export type BlockScope = 'sender' | 'domain'

/**
 * What the rule matches: the whole address, or "@domain" for every sender of the domain. Null for
 * an address without a domain, which no rule should be built from. Rules match the sender as a
 * part of the name or address, so "@example.org" also catches "a@example.org".
 */
export function blockPattern(email: string, scope: BlockScope): string | null {
  const address = email.trim().toLowerCase()
  const at = address.lastIndexOf('@')
  if (at <= 0 || at === address.length - 1) return null
  return scope === 'domain' ? address.slice(at) : address
}

/** The mail rule behind "Absender immer als Spam": move each new mail of the sender to Junk */
export function blockRule(
  accountId: string,
  email: string,
  scope: BlockScope,
  junk: FolderNode
): SaveMailRuleInput | null {
  const pattern = blockPattern(email, scope)
  if (!pattern) return null
  return {
    accountId,
    name: `Spam: ${pattern}`,
    enabled: true,
    matchFrom: pattern,
    matchTo: '',
    matchSubject: '',
    moveToFolderPath: junk.path,
    markRead: true,
    markFlagged: false,
    link: null
  }
}
