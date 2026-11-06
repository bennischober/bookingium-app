// #65: the main process's INBOX watcher (new-mail notification, tray counts) and the tray's texts
import { describe, expect, it } from 'vitest'
import { inboxUnreadOf, inboxWatch, type InboxWatchDeps } from '../src/main/mailclient/inboxWatch'
import {
  TRAY_TOOLTIP_MAX,
  newMailChannel,
  newMailNotice,
  trayTooltip,
  withUnreadDot
} from '../src/main/mailclient/trayText'
import type { FolderNode } from '../src/main/mailclient/core/types'

const folder = (path: string, unreadCount: number): FolderNode =>
  ({ path, unreadCount }) as unknown as FolderNode

const synced = (accountId: string, newCount: number, path = 'INBOX') => ({
  type: 'sync-event',
  accountId,
  event: { type: 'folder-done', path, newCount, flagChanges: 0, expunged: 0, moved: 0 }
})
const op = (accountId: string) => ({ type: 'op-event', accountId, opId: 'op', kind: 'flag' })

function setUp(accounts = ['a']) {
  const unread = new Map<string, number | undefined>()
  const ids = [...accounts]
  const notified: [string, number][] = []
  const counts: Record<string, number>[] = []
  const errors: unknown[] = []
  let fail = false
  const deps: InboxWatchDeps = {
    accountIds: () => ids,
    inboxUnread: async (id) => {
      if (fail) throw new Error('worker gone')
      return unread.get(id)
    },
    onCounts: (c) => counts.push(c),
    onNewMail: (id, n) => notified.push([id, n]),
    log: (error) => errors.push(error)
  }
  const watch = inboxWatch(deps)
  return {
    watch,
    unread,
    ids,
    notified,
    counts,
    errors,
    failing: (v: boolean) => (fail = v)
  }
}

describe('inboxUnreadOf', () => {
  it('reads the INBOX whatever its case, undefined without one', () => {
    expect(inboxUnreadOf([folder('Sent', 3), folder('Inbox', 4)])).toBe(4)
    expect(inboxUnreadOf([folder('Sent', 3)])).toBeUndefined()
    expect(inboxUnreadOf([])).toBeUndefined()
  })
})

describe('inboxWatch', () => {
  it('takes the first count as the baseline and announces the rise after a sync', async () => {
    const t = setUp()
    t.unread.set('a', 5)
    t.watch.onRunning()
    await t.watch.idle()
    expect(t.notified).toEqual([])
    expect(t.watch.counts()).toEqual({ a: 5 })

    t.unread.set('a', 7)
    t.watch.onEvent(synced('a', 2))
    await t.watch.idle()
    expect(t.notified).toEqual([['a', 2]])
    expect(t.counts.at(-1)).toEqual({ a: 7 })
  })

  it('announces nothing for the first download or a store without an INBOX yet', async () => {
    const t = setUp()
    t.watch.onRunning()
    await t.watch.idle()
    expect(t.watch.counts()).toEqual({})
    // First download: the INBOX appears with 300 stored, 40 unread
    t.unread.set('a', 40)
    t.watch.onEvent(synced('a', 300))
    await t.watch.idle()
    expect(t.notified).toEqual([])
    expect(t.watch.counts()).toEqual({ a: 40 })
  })

  it('caps the announcement at what the sync stored', async () => {
    const t = setUp()
    t.unread.set('a', 1)
    t.watch.onRunning()
    await t.watch.idle()
    // Marked unread on the phone meanwhile: +3 unread, but only 1 new mail
    t.unread.set('a', 4)
    t.watch.onEvent(synced('a', 1))
    await t.watch.idle()
    expect(t.notified).toEqual([['a', 1]])
  })

  it('says nothing for read mail, other folders or a sync that stored nothing', async () => {
    const t = setUp()
    t.unread.set('a', 3)
    t.watch.onRunning()
    await t.watch.idle()
    t.unread.set('a', 1)
    t.watch.onEvent(synced('a', 0))
    t.watch.onEvent(synced('a', 4, 'Archiv'))
    await t.watch.idle()
    t.unread.set('a', 2)
    t.watch.onEvent(synced('a', 0))
    await t.watch.idle()
    expect(t.notified).toEqual([])
    expect(t.watch.counts()).toEqual({ a: 2 })
  })

  it('takes an own write as the new baseline, so later mail is still announced', async () => {
    const t = setUp()
    t.unread.set('a', 5)
    t.watch.onRunning()
    await t.watch.idle()
    t.unread.set('a', 0)
    t.watch.onEvent(op('a'))
    await t.watch.idle()
    t.unread.set('a', 1)
    t.watch.onEvent(synced('a', 1))
    await t.watch.idle()
    expect(t.notified).toEqual([['a', 1]])
  })

  it('announces nothing for a UIDVALIDITY rebuild that stores the whole INBOX again', async () => {
    const t = setUp()
    t.unread.set('a', 12)
    t.watch.onRunning()
    await t.watch.idle()
    t.watch.onEvent(synced('a', 2000))
    await t.watch.idle()
    expect(t.notified).toEqual([])
  })

  it('merges events that arrive while a refresh is waiting', async () => {
    const t = setUp()
    t.unread.set('a', 0)
    t.watch.onRunning()
    t.watch.onEvent(synced('a', 1))
    t.watch.onEvent(synced('a', 1))
    await t.watch.idle()
    // The baseline read already saw both mails: nothing to announce
    expect(t.notified).toEqual([])
    t.unread.set('a', 2)
    t.watch.onEvent(synced('a', 1))
    t.watch.onEvent(synced('a', 1))
    t.watch.onEvent(synced('a', 1))
    await t.watch.idle()
    // one refresh runs at once; the other two merged into one read: 2 announced in all
    expect(t.notified.reduce((sum, [, n]) => sum + n, 0)).toBe(2)
  })

  it('keeps its counts when the worker cannot answer, and logs it', async () => {
    const t = setUp()
    t.unread.set('a', 2)
    t.watch.onRunning()
    await t.watch.idle()
    t.failing(true)
    t.unread.set('a', 4)
    t.watch.onEvent(synced('a', 2))
    await t.watch.idle()
    expect(t.errors).toHaveLength(1)
    expect(t.watch.counts()).toEqual({ a: 2 })
    expect(t.notified).toEqual([])
  })

  it('forgets a removed account and keeps the others apart', async () => {
    const t = setUp(['a', 'b'])
    t.unread.set('a', 1)
    t.unread.set('b', 2)
    t.watch.onRunning()
    await t.watch.idle()
    t.unread.set('b', 3)
    t.watch.onEvent(synced('b', 1))
    await t.watch.idle()
    expect(t.notified).toEqual([['b', 1]])

    t.ids.splice(t.ids.indexOf('a'), 1)
    t.watch.onRunning()
    await t.watch.idle()
    expect(t.watch.counts()).toEqual({ b: 3 })
    // An event of the removed account counts nothing
    t.watch.onEvent(synced('a', 1))
    await t.watch.idle()
    expect(t.watch.counts()).toEqual({ b: 3 })
  })

  it('ignores events without an account and other event types', async () => {
    const t = setUp()
    t.watch.onEvent({ type: 'sync-event', event: { type: 'folder-done', path: 'INBOX' } })
    t.watch.onEvent({ type: 'status', accountId: 'a' })
    t.watch.onEvent(null)
    await t.watch.idle()
    expect(t.counts).toEqual([])
  })
})

describe('tray texts', () => {
  it('sums the accounts and lists them when there are several', () => {
    expect(trayTooltip([{ email: 'a@example.test', unread: 1 }])).toBe(
      'Bookingium – 1 ungelesene E-Mail'
    )
    expect(
      trayTooltip([
        { email: 'a@example.test', unread: 2 },
        { email: 'b@example.test', unread: 0 }
      ])
    ).toBe('Bookingium – 2 ungelesene E-Mails\na@example.test: 2\nb@example.test: 0')
  })

  it('stays within what Windows shows', () => {
    const accounts = Array.from({ length: 10 }, (_, i) => ({
      email: `konto-${i}@example.test`,
      unread: i
    }))
    const text = trayTooltip(accounts)
    expect(text.length).toBe(TRAY_TOOLTIP_MAX)
    expect(text.endsWith('…')).toBe(true)
  })

  it('names the count and the account, nothing of the mail', () => {
    expect(newMailNotice(1, 'a@example.test')).toEqual({
      title: 'Neue E-Mail',
      body: 'Im Posteingang von a@example.test'
    })
    expect(newMailNotice(3, '')).toEqual({ title: '3 neue E-Mails', body: 'Im Posteingang' })
  })

  // #133
  it('announces new mail only where its switch is on', () => {
    const off = { desktop: false, inApp: false }
    const on = { desktop: true, inApp: true }
    // Both off, the default: nowhere
    expect(newMailChannel('none', off)).toBeNull()
    expect(newMailChannel('main', off)).toBeNull()
    // In the background Windows, with the main window in front the app, each on its own switch
    expect(newMailChannel('none', on)).toBe('desktop')
    expect(newMailChannel('main', on)).toBe('app')
    expect(newMailChannel('none', { desktop: false, inApp: true })).toBeNull()
    expect(newMailChannel('main', { desktop: true, inApp: false })).toBeNull()
    // In a mail window the user is reading mail already
    expect(newMailChannel('other', on)).toBeNull()
  })

  it('paints the dot in the lower right corner of a copy', () => {
    const size = 32
    const bitmap = new Uint8Array(size * size * 4)
    const dotted = withUnreadDot(bitmap, size, size)
    expect(bitmap.every((byte) => byte === 0)).toBe(true)
    const pixel = (x: number, y: number) => [
      ...dotted.slice((y * size + x) * 4, (y * size + x) * 4 + 4)
    ]
    expect(pixel(0, 0)).toEqual([0, 0, 0, 0])
    // the dot's centre is red (BGRA), its edge a light ring
    expect(pixel(size - 8, size - 8)).toEqual([0x2b, 0x2b, 0xdc, 0xff])
    expect(pixel(size - 1, size - 8)).toEqual([0xff, 0xff, 0xff, 0xff])
  })
})
