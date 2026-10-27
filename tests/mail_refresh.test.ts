// I18: which cached queries a mail-client event makes stale on the mail page. Events of another
// account used to be dropped, and a sync never refreshed `search`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OP_REFRESH_MS,
  refreshBatcher,
  refreshPlan,
  SYNC_REFRESH_MS,
  syncChanged,
  type MailQueryKey
} from '../src/renderer/src/components/mail/mailRefresh'
import type { MailEvent } from '../src/main/mailclient/protocol'

const SHOWN = 'a'
const OTHER = 'b'

const folderDone = (accountId: string, counts: Record<string, number> = { newCount: 1 }) =>
  ({
    type: 'sync-event',
    accountId,
    event: {
      type: 'folder-done',
      path: 'INBOX',
      newCount: 0,
      flagChanges: 0,
      expunged: 0,
      moved: 0,
      ...counts
    }
  }) as MailEvent

const opEvent = (accountId: string): MailEvent => ({
  type: 'op-event',
  accountId,
  opId: 'op-1',
  kind: 'move',
  outcome: 'done'
})

describe('refreshPlan (I18)', () => {
  it('refreshes search with the lists when a sync of the shown account changed something', () => {
    expect(refreshPlan(folderDone(SHOWN), SHOWN)).toEqual({
      delayMs: SYNC_REFRESH_MS,
      keys: [
        ['mail', SHOWN, 'folders'],
        ['mail', SHOWN, 'messages'],
        ['mail', SHOWN, 'search']
      ]
    })
  })

  it('marks another account stale instead of dropping its events', () => {
    expect(refreshPlan(folderDone(OTHER), SHOWN)).toEqual({
      delayMs: SYNC_REFRESH_MS,
      keys: [['mail', OTHER]]
    })
    expect(refreshPlan(opEvent(OTHER), SHOWN)?.keys).toEqual([['mail', OTHER]])
  })

  it('refreshes the open mail and the open ops after a write, quickly', () => {
    const plan = refreshPlan(opEvent(SHOWN), SHOWN)!
    expect(plan.delayMs).toBe(OP_REFRESH_MS)
    expect(plan.keys).toEqual([
      ['mail', SHOWN, 'folders'],
      ['mail', SHOWN, 'messages'],
      ['mail', SHOWN, 'search'],
      ['mail', SHOWN, 'message'],
      ['mail', SHOWN, 'open-ops']
    ])
  })

  it('ignores a sync that changed nothing, folder starts, errors and image progress', () => {
    expect(refreshPlan(folderDone(SHOWN, {}), SHOWN)).toBeNull()
    expect(refreshPlan(folderDone(OTHER, {}), SHOWN)).toBeNull()
    const start = {
      type: 'sync-event',
      accountId: SHOWN,
      event: { type: 'folder-start', path: 'INBOX', mode: 'full' }
    } as MailEvent
    expect(refreshPlan(start, SHOWN)).toBeNull()
    const error = {
      type: 'sync-event',
      accountId: SHOWN,
      event: { type: 'error', path: null, message: 'x' }
    } as MailEvent
    expect(refreshPlan(error, SHOWN)).toBeNull()
    const images: MailEvent = {
      type: 'image-progress',
      accountId: SHOWN,
      messageId: 1,
      done: 1,
      total: 2
    }
    expect(refreshPlan(images, SHOWN)).toBeNull()
  })

  it('counts every kind of change, and a new folder list', () => {
    for (const counts of [{ newCount: 2 }, { flagChanges: 1 }, { expunged: 3 }, { moved: 1 }])
      expect(syncChanged({ type: 'folder-done', ...counts })).toBe(true)
    expect(syncChanged({ type: 'folder-list', folders: [] })).toBe(true)
    expect(syncChanged({ type: 'folder-done', newCount: 0 })).toBe(false)
    expect(syncChanged(null)).toBe(false)
  })
})

describe('refreshBatcher (I18)', () => {
  afterEach(() => vi.useRealTimers())

  function batcher() {
    vi.useFakeTimers()
    const invalidated: MailQueryKey[] = []
    return { invalidated, refresher: refreshBatcher((key) => invalidated.push(key)) }
  }

  it('invalidates once after a burst of sync events, each key once', () => {
    const { invalidated, refresher } = batcher()
    for (let i = 0; i < 5; i++) {
      refresher.add(refreshPlan(folderDone(SHOWN), SHOWN)!)
      vi.advanceTimersByTime(SYNC_REFRESH_MS - 1)
    }
    expect(invalidated).toEqual([])
    vi.advanceTimersByTime(1)
    expect(invalidated).toEqual([
      ['mail', SHOWN, 'folders'],
      ['mail', SHOWN, 'messages'],
      ['mail', SHOWN, 'search']
    ])
  })

  it('keeps a write’s keys when a sync event follows before the timer fires', () => {
    const { invalidated, refresher } = batcher()
    refresher.add(refreshPlan(opEvent(SHOWN), SHOWN)!)
    vi.advanceTimersByTime(OP_REFRESH_MS - 1)
    refresher.add(refreshPlan(folderDone(SHOWN), SHOWN)!)
    vi.advanceTimersByTime(SYNC_REFRESH_MS)
    expect(invalidated).toContainEqual(['mail', SHOWN, 'message'])
    expect(invalidated).toContainEqual(['mail', SHOWN, 'open-ops'])
    expect(invalidated).toHaveLength(5)
  })

  it('keeps both accounts when their events interleave', () => {
    const { invalidated, refresher } = batcher()
    refresher.add(refreshPlan(folderDone(SHOWN), SHOWN)!)
    refresher.add(refreshPlan(folderDone(OTHER), SHOWN)!)
    vi.advanceTimersByTime(SYNC_REFRESH_MS)
    expect(invalidated).toContainEqual(['mail', SHOWN, 'search'])
    expect(invalidated).toContainEqual(['mail', OTHER])
  })

  it('invalidates nothing after dispose', () => {
    const { invalidated, refresher } = batcher()
    refresher.add(refreshPlan(folderDone(SHOWN), SHOWN)!)
    refresher.dispose()
    vi.advanceTimersByTime(SYNC_REFRESH_MS * 2)
    expect(invalidated).toEqual([])
  })
})
