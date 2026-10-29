/**
 * The unread count on the "E-Mail" menu entry: every account's INBOX added up, so new mail in an
 * account the mail page is not showing still shows. It follows the mail client's own events (a
 * sync that stored or changed mail, a write op such as marking read), never a timer.
 */
import type { MailEvent } from '../../../../main/mailclient/protocol'
import { OP_REFRESH_MS, SYNC_REFRESH_MS, syncChanged, type RefreshPlan } from './mailRefresh'

/** Outside the `['mail', accountId]` keys, so the mail page's per-account refreshes leave it alone */
export const UNREAD_BADGE_KEY = ['mail-badge', 'inbox-unread'] as const

const unreadOf = (n: number | undefined): number =>
  n !== undefined && Number.isFinite(n) && n > 0 ? n : 0

export interface AccountUnread {
  id: string
  email: string
  unread: number
}

/** Each account's INBOX unread, in the order of the account list; 0 before the counts arrive */
export function inboxUnreadByAccount(
  accounts: { id: string; email: string }[],
  counts: Record<string, number> | undefined
): AccountUnread[] {
  return accounts.map(({ id, email }) => ({ id, email, unread: unreadOf(counts?.[id]) }))
}

/** The badge's tooltip: the total, then each account's share when there are several */
export function unreadBadgeTitle(accounts: AccountUnread[]): string {
  const total = accounts.reduce((sum, account) => sum + account.unread, 0)
  const mails = `${total} ${total === 1 ? 'ungelesene E-Mail' : 'ungelesene E-Mails'}`
  if (accounts.length < 2) return `${mails} im Posteingang`
  return [
    `${mails} in den Posteingängen:`,
    ...accounts.map((account) => `${account.email}: ${account.unread}`)
  ].join('\n')
}

/** What the badge shows: the count, capped so the narrow menu does not grow */
export function unreadBadgeLabel(total: number): string {
  return total > 99 ? '99+' : String(total)
}

/** When an event makes the count stale, and how long to wait for more; null for none */
export function unreadBadgePlan(
  event: Pick<MailEvent, 'type'> & { event?: unknown }
): RefreshPlan | null {
  if (event.type === 'op-event') return { delayMs: OP_REFRESH_MS, keys: [UNREAD_BADGE_KEY] }
  if (event.type === 'sync-event' && syncChanged(event.event))
    return { delayMs: SYNC_REFRESH_MS, keys: [UNREAD_BADGE_KEY] }
  return null
}
