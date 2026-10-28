/**
 * I18: which cached mail queries an event from the mail client makes stale.
 *
 * The page shows one account, but the query cache keeps every account the user has looked at
 * (`['mail', accountId, ...]`). Events of another account used to be dropped, so switching to it
 * showed its old lists until the cache went stale by itself. And a sync refreshed folders and
 * lists but not `search`, so an open search never showed the mail that had just arrived.
 *
 * Kept pure, with the batching testable on fake timers, because both mistakes are silent: the
 * page just shows old data.
 */
import type { MailEvent } from '../../../../main/mailclient/protocol'

export type MailQueryKey = readonly unknown[]
export type RefreshPlan = { delayMs: number; keys: MailQueryKey[] }
/** What the plan reads of a `MailEvent`; the subscription's inferred type has `event` optional */
type RefreshEvent = Pick<MailEvent, 'type' | 'accountId'> & { event?: unknown }

/** After a write: soon, so a move or a delete shows at once */
export const OP_REFRESH_MS = 300
/** After a sync: batched, because the initial download reports every folder */
export const SYNC_REFRESH_MS = 1000

/** Did a sync event list folders, or store, change or remove mails? */
export function syncChanged(event: unknown): boolean {
  const sync = event as {
    type?: string
    newCount?: number
    flagChanges?: number
    expunged?: number
    moved?: number
  } | null
  if (sync?.type === 'folder-list') return true
  return (
    sync?.type === 'folder-done' &&
    Boolean(sync.newCount || sync.flagChanges || sync.expunged || sync.moved)
  )
}

/** The queries an event makes stale, and how long to wait for more events; null for none */
export function refreshPlan(event: RefreshEvent, shownAccountId: string): RefreshPlan | null {
  const relevant =
    event.type === 'op-event' || (event.type === 'sync-event' && syncChanged(event.event))
  if (!relevant) return null
  const id = event.accountId
  // Another account: mark all of it stale. Its queries are not on screen, so nothing is
  // fetched now; they reload when the user switches to that account.
  if (id !== shownAccountId) return { delayMs: SYNC_REFRESH_MS, keys: [['mail', id]] }
  const lists: MailQueryKey[] = [
    ['mail', id, 'folders'],
    ['mail', id, 'messages'],
    ['mail', id, 'search']
  ]
  if (event.type === 'op-event') {
    return {
      delayMs: OP_REFRESH_MS,
      keys: [...lists, ['mail', id, 'message'], ['mail', id, 'open-ops']]
    }
  }
  return { delayMs: SYNC_REFRESH_MS, keys: lists }
}

/**
 * Invalidates the keys of several events together, once no event has come for the latest plan's
 * delay. Keys add up: a sync event right after a write used to replace the write's timer, and the
 * write's refresh of the open mail and the open ops was lost.
 */
export function refreshBatcher(invalidate: (key: MailQueryKey) => void): {
  add: (plan: RefreshPlan) => void
  dispose: () => void
} {
  const pending = new Map<string, MailQueryKey>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = (): void => {
    const keys = [...pending.values()]
    pending.clear()
    for (const key of keys) invalidate(key)
  }
  return {
    add: (plan) => {
      for (const key of plan.keys) pending.set(JSON.stringify(key), key)
      clearTimeout(timer)
      timer = setTimeout(flush, plan.delayMs)
    },
    dispose: () => {
      clearTimeout(timer)
      pending.clear()
    }
  }
}
