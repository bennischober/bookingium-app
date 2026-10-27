// I3: the op-journal panel (MR-03, MR-29). The panel lists the writes that need the user and
// offers only what the core accepts; the core retries failed ops by itself while online, lets
// the user discard one that is not running, and resyncs its folders so the optimistic effect
// gives way to the server.
//
// The core runs with the write engine stubbed: no server, no sandbox, no mail content.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMailCore } from '../src/main/mailclient/core/index'
import { autoRetryable, retryDelay } from '../src/main/mailclient/core/op_retry'
import { Store } from '../src/main/mailclient/core/store'
import type { OpResult, OpSummary } from '../src/main/mailclient/core/types'
import { MAIL_API_METHODS } from '../src/main/mailclient/protocol'
import {
  STUCK_MS,
  actionResult,
  discardConfirm,
  isUnclearSendOp,
  opActions,
  opAge,
  opAttention,
  opBadge,
  opEntries,
  opWhere
} from '../src/renderer/src/components/mail/opJournal'
import { refreshPlan } from '../src/renderer/src/components/mail/mailRefresh'

const ACCOUNT = 'acc'
const NOW = Date.parse('2026-10-26T12:00:00.000Z')

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

function summary(patch: Partial<OpSummary> = {}): OpSummary {
  const at = new Date(NOW - 10_000).toISOString()
  return {
    id: 'op-1',
    kind: 'flag',
    state: 'pending',
    folderPath: 'INBOX',
    targetFolderPath: null,
    uid: 1,
    messageId: null,
    attempts: 0,
    createdAt: at,
    updatedAt: at,
    error: null,
    ...patch
  }
}

const ago = (ms: number): string => new Date(NOW - ms).toISOString()

describe('which ops need the user', () => {
  it('leaves a fresh pending or running op alone, and done or cancelled ones', () => {
    expect(opAttention(summary(), NOW)).toBeNull()
    expect(opAttention(summary({ state: 'running' }), NOW)).toBeNull()
    expect(opAttention(summary({ state: 'done' }), NOW)).toBeNull()
    expect(opAttention(summary({ state: 'cancelled' }), NOW)).toBeNull()
  })

  it('calls an op stuck once it waited too long without an error', () => {
    expect(opAttention(summary({ updatedAt: ago(STUCK_MS) }), NOW)).toBe('stuck')
    expect(opAttention(summary({ state: 'running', updatedAt: ago(STUCK_MS + 1) }), NOW)).toBe(
      'stuck'
    )
    expect(opAttention(summary({ updatedAt: 'not a date' }), NOW)).toBeNull()
  })

  it('tells a failed op waiting for its retry from a rejected one', () => {
    expect(opAttention(summary({ error: 'timeout' }), NOW)).toBe('waiting')
    expect(opAttention(summary({ state: 'conflict', error: 'gone' }), NOW)).toBe('rejected')
    expect(opAttention(summary({ state: 'failed' }), NOW)).toBe('rejected')
  })

  it('marks a send the server may have as unclear, but not a refused filing', () => {
    const unknown = summary({ kind: 'send', state: 'unknown', sendPhase: 'smtp' })
    const smtpConflict = summary({ kind: 'send', state: 'conflict', sendPhase: 'smtp' })
    const filingConflict = summary({ kind: 'send', state: 'conflict', sendPhase: 'sent' })
    expect(isUnclearSendOp(unknown)).toBe(true)
    expect(isUnclearSendOp(smtpConflict)).toBe(true)
    expect(isUnclearSendOp(filingConflict)).toBe(false)
    expect(opAttention(unknown, NOW)).toBe('unclear')
    expect(opAttention(filingConflict, NOW)).toBe('rejected')
  })
})

describe('what the panel offers', () => {
  it('checks an unclear send in Sent and never offers to send it again', () => {
    const op = summary({ kind: 'send', state: 'unknown', sendPhase: 'smtp' })
    expect(opActions(op, 'unclear')).toEqual(['resolve', 'discard'])
  })

  it('retries a send only when filing into Sent is all that is left', () => {
    const filing = summary({ kind: 'send', state: 'pending', error: 'x', sendPhase: 'sent' })
    expect(opActions(filing, 'waiting')).toEqual(['retry', 'discard'])
    const notOut = summary({ kind: 'send', state: 'failed', sendPhase: null })
    expect(opActions(notOut, 'rejected')).toEqual(['discard'])
  })

  it('offers nothing for a running op, retry and discard for the rest', () => {
    expect(opActions(summary({ state: 'running' }), 'stuck')).toEqual([])
    expect(opActions(summary({ state: 'conflict' }), 'rejected')).toEqual(['retry', 'discard'])
  })

  it('sorts unclear sends first, then newest first, and counts the badge', () => {
    const entries = opEntries(
      [
        summary({ id: 'old-wait', error: 'x', updatedAt: ago(50_000) }),
        summary({ id: 'fresh' }),
        summary({ id: 'new-wait', error: 'x', updatedAt: ago(5_000) }),
        summary({ id: 'send', kind: 'send', state: 'unknown', sendPhase: 'smtp' }),
        summary({ id: 'stuck', updatedAt: ago(STUCK_MS * 2) }),
        summary({ id: 'conflict', state: 'conflict' })
      ],
      NOW
    )
    expect(entries.map((e) => e.op.id)).toEqual([
      'send',
      'conflict',
      'new-wait',
      'old-wait',
      'stuck'
    ])
    expect(opBadge(entries)).toEqual({ count: 5, urgent: true })
    expect(opBadge(entries.filter((e) => e.attention === 'waiting'))).toEqual({
      count: 2,
      urgent: false
    })
    expect(opBadge([])).toEqual({ count: 0, urgent: false })
  })

  it('words the age, the folders and the outcome of an action', () => {
    expect(opAge(ago(30_000), NOW)).toBe('gerade eben')
    expect(opAge(ago(5 * 60_000), NOW)).toBe('vor 5 Min.')
    expect(opAge(ago(3 * 3_600_000), NOW)).toBe('vor 3 Std.')
    expect(opAge(ago(26 * 3_600_000), NOW)).toBe('vor 1 Tag')
    expect(opAge(ago(72 * 3_600_000), NOW)).toBe('vor 3 Tagen')
    expect(opWhere(summary({ targetFolderPath: 'Archiv' }))).toBe('INBOX → Archiv')
    expect(opWhere(summary({ folderPath: null }))).toBeNull()

    expect(actionResult('resolve', 'done').ok).toBe(true)
    expect(actionResult('resolve', 'conflict')).toMatchObject({ ok: false })
    expect(actionResult('resolve', 'conflict').text).toMatch(/unklar/)
    expect(actionResult('retry', 'noop').ok).toBe(true)
    expect(actionResult('retry', 'failed').ok).toBe(false)
  })

  it('warns that a discarded unclear send may have arrived anyway', () => {
    const [unclear] = opEntries([summary({ kind: 'send', state: 'unknown' })], NOW)
    expect(discardConfirm(unclear).description).toMatch(/vielleicht trotzdem/)
    const [rejected] = opEntries([summary({ state: 'conflict' })], NOW)
    expect(discardConfirm(rejected).title).toContain('Markierung ändern')
  })
})

describe('the automatic retry rules (MR-29)', () => {
  const op = (patch: Partial<Parameters<typeof autoRetryable>[0]> = {}) => ({
    kind: 'flag',
    state: 'pending',
    error: 'connection reset',
    payload: null,
    ...patch
  })

  it('retries a failed write whose effect is on screen', () => {
    for (const kind of ['flag', 'move', 'move_batch', 'delete', 'expunge', 'draft_delete']) {
      expect(autoRetryable(op({ kind }))).toBe(true)
    }
  })

  it('leaves fresh ops, settled ops, drafts and folder ops alone', () => {
    expect(autoRetryable(op({ error: null }))).toBe(false)
    expect(autoRetryable(op({ state: 'conflict' }))).toBe(false)
    expect(autoRetryable(op({ kind: 'draft_save' }))).toBe(false)
    expect(autoRetryable(op({ kind: 'folder_rename' }))).toBe(false)
  })

  it('never retries after a refused login', () => {
    for (const error of [
      'Authentication failed',
      'LOGIN rejected',
      'invalid credentials',
      'wrong password',
      '535 5.7.8 nope'
    ]) {
      expect(autoRetryable(op({ error }))).toBe(false)
    }
  })

  it('retries a send only in phase sent', () => {
    const send = (phase?: string) =>
      op({ kind: 'send', payload: JSON.stringify(phase ? { phase } : {}) })
    expect(autoRetryable(send('sent'))).toBe(true)
    expect(autoRetryable(send('smtp'))).toBe(false)
    expect(autoRetryable(send())).toBe(false)
    expect(autoRetryable(op({ kind: 'send', payload: '{broken' }))).toBe(false)
  })

  it('waits a minute, then doubles, up to fifteen', () => {
    expect([0, 1, 2, 3, 4, 10].map(retryDelay)).toEqual([
      60_000, 120_000, 240_000, 480_000, 900_000, 900_000
    ])
    expect(retryDelay(-1)).toBe(60_000)
  })
})

describe('the core behind the panel', () => {
  type Entry = {
    store: Store
    engine: { getStatus: () => { connection: string } }
    writes: {
      execute: (op: { id: string }) => Promise<OpResult>
      isInFlight: (id: string) => boolean
      requestResync: (path: string) => void
    }
  }
  type Internals = {
    entries: Map<string, Entry>
    retryTimers: Map<string, unknown>
  }

  /** A writable account whose server is unreachable; the store is seeded first */
  function core(seed: (store: Store) => void) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-op-journal-'))
    const dir = path.join(dataDir, ACCOUNT)
    fs.mkdirSync(dir, { recursive: true })
    const store = new Store(dir, ACCOUNT)
    seed(store)
    store.close()
    const api = createMailCore({
      dataDir,
      accounts: [
        {
          id: ACCOUNT,
          kind: 'sandbox' as const,
          readOnly: false,
          email: 'a@example.test',
          host: '127.0.0.1',
          port: 1,
          security: 'none' as const,
          credentials: async () => ({ user: 'a@example.test', pass: 'x' })
        }
      ]
    })
    let closed: Promise<void> | undefined
    const close = () => (closed ??= api.close())
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }))
    cleanups.push(close)
    const internals = api as unknown as Internals
    const entry = internals.entries.get(ACCOUNT)!
    const execute = vi.fn<(op: { id: string }) => Promise<OpResult>>(async () => ({
      outcome: 'done'
    }))
    entry.writes.execute = execute
    const resync = vi.fn<(path: string) => void>()
    entry.writes.requestResync = resync
    let connection = 'offline'
    entry.engine.getStatus = () => ({ connection })
    return {
      api,
      entry,
      execute,
      resync,
      close,
      timers: internals.retryTimers,
      online: () => (connection = 'online')
    }
  }

  function enqueue(
    store: Store,
    kind: 'flag' | 'move' | 'draft_save' | 'send',
    state: string,
    extra: { error?: string; payload?: unknown; targetFolderPath?: string } = {}
  ): string {
    const id = store.journalEnqueue({
      accountId: ACCOUNT,
      kind,
      folderPath: 'INBOX',
      uid: 1,
      targetFolderPath: extra.targetFolderPath,
      payload: extra.payload ?? { add: ['\\Seen'], remove: [] }
    })
    store.journalUpdate(id, { state, ...(extra.error ? { error: extra.error } : {}) })
    return id
  }

  it('lists every open op with the phase of a send, not its payload', async () => {
    let send = ''
    let flag = ''
    const { api } = core((store) => {
      enqueue(store, 'flag', 'done')
      enqueue(store, 'flag', 'cancelled')
      flag = enqueue(store, 'flag', 'pending', { error: 'timeout' })
      send = enqueue(store, 'send', 'unknown', { payload: { phase: 'smtp', mime: 'x' } })
    })

    const open = await api.listOpenOps!(ACCOUNT)

    expect(open.map((op) => op.id).sort()).toEqual([flag, send].sort())
    const sendOp = open.find((op) => op.id === send)!
    expect(sendOp.sendPhase).toBe('smtp')
    expect(JSON.stringify(sendOp)).not.toContain('mime')
    expect(open.find((op) => op.id === flag)).not.toHaveProperty('sendPhase')
    expect(MAIL_API_METHODS).toContain('listOpenOps')
  }, 30_000)

  it('discards a rejected op and resyncs both its folders', async () => {
    let id = ''
    const { api, entry, resync } = core((store) => {
      id = enqueue(store, 'move', 'conflict', { targetFolderPath: 'Archiv', error: 'gone' })
    })

    await api.cancelOp(id, ACCOUNT)

    expect(entry.store.journalGet(id)!.state).toBe('cancelled')
    expect(resync.mock.calls.map(([p]) => p)).toEqual(['INBOX', 'Archiv'])
  }, 30_000)

  it('discards an unclear send, but never a running or settled op', async () => {
    const ids: Record<string, string> = {}
    const { api, entry } = core((store) => {
      ids.unknown = enqueue(store, 'send', 'unknown', { payload: { phase: 'smtp' } })
      ids.running = enqueue(store, 'flag', 'running')
      ids.done = enqueue(store, 'flag', 'done')
      ids.queued = enqueue(store, 'flag', 'pending')
    })

    await api.cancelOp(ids.unknown, ACCOUNT)
    expect(entry.store.journalGet(ids.unknown)!.state).toBe('cancelled')
    await expect(api.cancelOp(ids.running, ACCOUNT)).rejects.toThrow(/running/)
    await expect(api.cancelOp(ids.done, ACCOUNT)).rejects.toThrow(/done/)
    // pending in the journal, but already handed to the write engine
    entry.writes.isInFlight = (id) => id === ids.queued
    await expect(api.cancelOp(ids.queued, ACCOUNT)).rejects.toThrow(/settled/)
    expect(entry.store.journalGet(ids.queued)!.state).toBe('pending')
  }, 30_000)

  it('retries failed ops only while online, and only the ones it may', async () => {
    const ids: Record<string, string> = {}
    const { api, entry, execute, online } = core((store) => {
      ids.flag = enqueue(store, 'flag', 'pending', { error: 'connection reset' })
      ids.login = enqueue(store, 'flag', 'pending', { error: 'Authentication failed' })
      ids.draft = enqueue(store, 'draft_save', 'pending', { error: 'timeout' })
      ids.fresh = enqueue(store, 'flag', 'pending')
      ids.smtp = enqueue(store, 'send', 'pending', { error: 'x', payload: { phase: 'smtp' } })
    })

    expect(await api.retryFailedOps(ACCOUNT)).toBe(1)
    expect(execute).not.toHaveBeenCalled()

    online()
    expect(await api.retryFailedOps(ACCOUNT)).toBe(0)
    expect(execute.mock.calls.map(([op]) => op.id)).toEqual([ids.flag])
    expect(entry.store.journalGet(ids.flag)!.state).toBe('done')
    for (const id of [ids.login, ids.draft, ids.fresh, ids.smtp]) {
      expect(entry.store.journalGet(id)!.state).toBe('pending')
    }
  }, 30_000)

  it('schedules one retry when an op fails, and close() clears it', async () => {
    const ids: string[] = []
    const { api, execute, timers, close } = core((store) => {
      ids.push(enqueue(store, 'flag', 'pending'), enqueue(store, 'flag', 'pending'))
    })
    execute.mockResolvedValue({ outcome: 'failed', reason: 'connection reset' } as OpResult)

    for (const id of ids) await api.retryOp(id, ACCOUNT)
    expect(timers.size).toBe(1)

    await close()
    expect(timers.size).toBe(0)
  }, 30_000)

  it('does not schedule a retry after a refused login', async () => {
    let id = ''
    const { api, execute, timers } = core((store) => {
      id = enqueue(store, 'flag', 'pending')
    })
    execute.mockResolvedValue({ outcome: 'failed', reason: 'Authentication failed' } as OpResult)

    await api.retryOp(id, ACCOUNT)
    expect(timers.size).toBe(0)
  }, 30_000)
})

describe('the mail page shows the panel', () => {
  const page = fs.readFileSync(
    path.join(__dirname, '../src/renderer/src/pages/MailPage.tsx'),
    'utf8'
  )
  const fnBody = (name: string) => {
    const start = page.indexOf(`const ${name} = `)
    expect(start).toBeGreaterThan(-1)
    const end = page.indexOf('\n  const ', start + 1)
    return page.slice(start, end === -1 ? undefined : end)
  }

  it('fetches the open ops for a writable account and refreshes them on op events', () => {
    expect(page).toMatch(/queryKey: \['mail', accountId, 'open-ops'\]/)
    expect(page).toMatch(/listOpenOps\(accountId\)[\s\S]{0,40}enabled: ready && canWrite/)
    // I18: the events go through refreshPlan, which refreshes the open ops after every write
    expect(page).toMatch(/onData: \(event\) => \{[\s\S]*refreshPlan\(event, accountId\)/)
    const plan = refreshPlan(
      { type: 'op-event', accountId: ACCOUNT, opId: 'op-1', kind: 'move', outcome: 'done' },
      ACCOUNT
    )
    expect(plan?.keys).toContainEqual(['mail', ACCOUNT, 'open-ops'])
  })

  it('asks before discarding and refreshes after every action', () => {
    const body = fnBody('runOpAction')
    expect(body.indexOf('confirmAction(')).toBeGreaterThan(-1)
    expect(body.indexOf('confirmAction(')).toBeLessThan(body.indexOf('mailApi.cancelOp('))
    expect(body).toContain('mailApi.resolveOp(')
    expect(body).toContain('mailApi.retryOp(')
    expect(body).toMatch(/finally \{[\s\S]*openOps\.refetch\(\)[\s\S]*refreshLists\(\)/)
  })

  it('puts the badge in the header of a writable account only', () => {
    expect(page).toMatch(/\{canWrite && \(\s*<OpJournalPanel/)
  })
})
