/**
 * The unread count on the "E-Mail" menu entry: every account's INBOX added up, so new mail in an
 * account the mail page is not showing still shows. It follows the mail client's own events (a
 * sync that stored or changed mail, a write op such as marking read), never a timer.
 */
import type { MailEvent } from '../../../../main/mailclient/protocol'
import { OP_REFRESH_MS, SYNC_REFRESH_MS, syncChanged, type RefreshPlan } from './mailRefresh'

/** Outside the `['mail', accountId]` keys, so the mail page's per-account refreshes leave it alone */
export const UNREAD_BADGE_KEY = ['mail-badge', 'inbox-unread'] as const

/** The badge's number: the INBOX unread of every account, by account id, added up */
export function inboxUnreadTotal(counts: Record<string, number> | undefined): number {
  if (!counts) return 0
  return Object.values(counts).reduce((sum, n) => sum + (Number.isFinite(n) && n > 0 ? n : 0), 0)
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
