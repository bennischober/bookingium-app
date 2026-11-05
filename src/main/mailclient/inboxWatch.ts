// #65: follows each account's INBOX unread in the main process, for the tray icon and the
// desktop notification on new mail. Counts only: main never sees a subject or a sender here.
//
// New mail is an INBOX sync that stored mail AND raised the unread count. The sync's own
// `newCount` alone is not enough: the first download of an account, a UIDVALIDITY rebuild and
// mail already read on the phone all store "new" rows. So each refresh reads the count again and
// compares it with the last one; the first count of an account (or one taken while it has no
// INBOX yet, as during its first download) is the baseline and announces nothing.
// A user's own write (marking read, moving) is an op-event: it refreshes the baseline, or the
// next mail after reading five would stay below the old count and go unannounced.
// Kept free of Electron (index.ts passes the calls in), so it is testable on plain promises.

import type { FolderNode } from './core/types'

export interface InboxWatchDeps {
  /** The configured accounts' ids */
  accountIds: () => string[]
  /** One account's INBOX unread; undefined while it has no INBOX yet */
  inboxUnread: (accountId: string) => Promise<number | undefined>
  /** The counts changed (the tray); every known account, in no particular order */
  onCounts: (unread: Record<string, number>) => void
  /** Mail arrived that raised an INBOX's unread count by `count` */
  onNewMail: (accountId: string, count: number) => void
  /** A count could not be read; it stays as it was */
  log: (error: unknown) => void
}

export interface InboxWatch {
  /** A MailEvent from the worker */
  onEvent: (event: unknown) => void
  /** The worker is running (again): read every account's count, forget removed accounts */
  onRunning: () => void
  /** The counts as they are now */
  counts: () => Record<string, number>
  /** Resolves once every queued refresh is done (tests) */
  idle: () => Promise<void>
}

/** The unread count of a store's INBOX, undefined while it has none */
export function inboxUnreadOf(folders: FolderNode[]): number | undefined {
  const inbox = folders.find((folder) => folder.path.toUpperCase() === 'INBOX')
  return inbox ? inbox.unreadCount : undefined
}

type WatchEvent = {
  type?: string
  accountId?: string
  event?: { type?: string; path?: string; newCount?: number }
}

export function inboxWatch(deps: InboxWatchDeps): InboxWatch {
  const unread = new Map<string, number>()
  // One refresh per account at a time, in event order; a refresh that has not started yet takes
  // the later events' new mail along instead of queueing another call
  const chains = new Map<string, Promise<void>>()
  const queued = new Map<string, number>()

  const counts = (): Record<string, number> => Object.fromEntries(unread)

  const refresh = async (accountId: string): Promise<void> => {
    const stored = queued.get(accountId) ?? 0
    queued.delete(accountId)
    let current: number | undefined
    try {
      current = await deps.inboxUnread(accountId)
    } catch (error) {
      deps.log(error)
      return
    }
    // Removed meanwhile (onRunning forgot it): not counted again
    if (!deps.accountIds().includes(accountId)) return
    const before = unread.get(accountId)
    if (current === undefined) unread.delete(accountId)
    else unread.set(accountId, current)
    if (before !== current) deps.onCounts(counts())
    if (before === undefined || current === undefined || stored === 0) return
    const added = Math.min(current - before, stored)
    if (added > 0) deps.onNewMail(accountId, added)
  }

  const queue = (accountId: string, newMail: number): void => {
    if (queued.has(accountId)) {
      queued.set(accountId, (queued.get(accountId) ?? 0) + newMail)
      return
    }
    queued.set(accountId, newMail)
    const next = (chains.get(accountId) ?? Promise.resolve()).then(() => refresh(accountId))
    chains.set(accountId, next)
    void next.finally(() => {
      if (chains.get(accountId) === next) chains.delete(accountId)
    })
  }

  return {
    onEvent: (raw) => {
      const event = raw as WatchEvent | null
      const accountId = event?.accountId
      if (!event || !accountId) return
      if (event.type === 'op-event') queue(accountId, 0)
      else if (
        event.type === 'sync-event' &&
        event.event?.type === 'folder-done' &&
        event.event.path?.toUpperCase() === 'INBOX'
      ) {
        const stored = event.event.newCount
        queue(accountId, typeof stored === 'number' && stored > 0 ? stored : 0)
      }
    },
    onRunning: () => {
      const ids = deps.accountIds()
      let removed = false
      for (const id of [...unread.keys()]) {
        if (!ids.includes(id)) removed = unread.delete(id) || removed
      }
      if (removed) deps.onCounts(counts())
      for (const id of ids) queue(id, 0)
    },
    counts,
    idle: async () => {
      while (chains.size > 0) await Promise.all([...chains.values()])
    }
  }
}
