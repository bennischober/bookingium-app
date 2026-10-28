// A6: the stuck-op watchdog. It must never release a folder mutex it does not own, must
// start only after the op holds its mutexes, must treat a timeout after the SMTP phase as
// UNKNOWN (never failed), and must stop the queue rather than run two writers when the op
// body cannot be stopped at all.
import { sandboxWriteAccount, sandboxCredentials } from './helpers/writeAccount'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Store, type JournalRow } from '../src/main/mailclient/core/store'
import { WriteEngine } from '../src/main/mailclient/core/write_engine'
import { SyncEngine } from '../src/main/mailclient/core/sync'

const ACCOUNT = 'acc'

const cleanups: (() => void)[] = []
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  while (cleanups.length) cleanups.pop()!()
})

function openStore(): { store: Store; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-watchdog-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { store, dir }
}

type Internals = {
  writeClient: () => Promise<unknown>
  withWatchdog: (op: JournalRow, body: (s: AbortSignal) => Promise<unknown>) => Promise<unknown>
  executeOne: (op: JournalRow, s: AbortSignal) => Promise<unknown>
  watchdogMs: (op: JournalRow) => number
  queueStopped: boolean
}

function enqueueFlag(store: Store): JournalRow {
  store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
  const id = store.journalEnqueue({
    accountId: ACCOUNT,
    kind: 'flag',
    folderPath: 'INBOX',
    uid: 1,
    payload: { add: ['\\Seen'], remove: [] }
  })
  return store.journalGet(id)!
}

describe('watchdog limit (A6 step 3)', () => {
  it('is 120 s for ordinary ops and grows with a large draft', () => {
    const { store } = openStore()
    const flag = enqueueFlag(store)
    const writes = new WriteEngine(store, ACCOUNT, { writeAccount: sandboxWriteAccount(), credentials: sandboxCredentials }) as unknown as Internals
    expect(writes.watchdogMs(flag)).toBe(120_000)

    // 3.2 MB of base64 MIME ~= 2.4 MB raw; at 32 KB/s that is ~75 s, still under 120 s
    const small = Buffer.alloc(3_200_000, 0).toString('base64')
    const smallDraft = {
      ...flag,
      kind: 'draft_save',
      payload: JSON.stringify({ mime: small })
    } as JournalRow
    expect(writes.watchdogMs(smallDraft)).toBe(120_000)

    // 32 MB raw at 32 KB/s (32,000 B/s) = 1048.6 s, rounded to whole seconds
    const big = Buffer.alloc(32 * 1024 * 1024, 0).toString('base64')
    const bigDraft = {
      ...flag,
      kind: 'draft_save',
      payload: JSON.stringify({ mime: big })
    } as JournalRow
    expect(writes.watchdogMs(bigDraft)).toBe(1_049_000)
  })
})

describe('watchdog abandonment (A6 step 4)', () => {
  it('stops the queue and reports it when the op body cannot be stopped', async () => {
    vi.useFakeTimers()
    const { store } = openStore()
    const op = enqueueFlag(store)
    const writes = new WriteEngine(store, ACCOUNT, { writeAccount: sandboxWriteAccount(), credentials: sandboxCredentials })
    const stopped: string[] = []
    writes.onQueueStopped = (m) => stopped.push(m)

    // A body that ignores its abort signal forever
    const resultPromise = (writes as unknown as Internals).withWatchdog(
      op,
      () => new Promise(() => {})
    )
    await vi.advanceTimersByTimeAsync(120_000 + 1)
    await vi.advanceTimersByTimeAsync(15_000 + 1)
    const result = (await resultPromise) as { outcome: string; reason: string }

    expect(result.outcome).toBe('failed')
    expect(result.reason).toMatch(/restart required/)
    expect(stopped).toHaveLength(1)
    expect(stopped[0]).toContain('neu starten')
    expect((writes as unknown as Internals).queueStopped).toBe(true)
  })

  it('returns unknown when a timeout hits after the SMTP phase started', async () => {
    vi.useFakeTimers()
    const { store } = openStore()
    const op = enqueueFlag(store)
    const writes = new WriteEngine(store, ACCOUNT, { writeAccount: sandboxWriteAccount(), credentials: sandboxCredentials })
    // The send path recorded the SMTP phase in the journal
    store.journalUpdate(op.id, { payload: { phase: 'smtp' } })

    const resultPromise = (writes as unknown as Internals).withWatchdog(
      op,
      (signal) =>
        new Promise((resolve) => {
          // obeys the abort signal, like the real op body does
          signal.addEventListener('abort', () => resolve({ outcome: 'failed', reason: 'aborted' }))
        })
    )
    await vi.advanceTimersByTimeAsync(120_000 + 1)
    const result = (await resultPromise) as { outcome: string; reason: string }

    expect(result.outcome).toBe('unknown')
    expect(result.reason).toMatch(/probe required/)
  })

  it('records failed (not unknown) for an ordinary op that settles after the abort', async () => {
    vi.useFakeTimers()
    const { store } = openStore()
    const op = enqueueFlag(store)
    const writes = new WriteEngine(store, ACCOUNT, { writeAccount: sandboxWriteAccount(), credentials: sandboxCredentials })

    const resultPromise = (writes as unknown as Internals).withWatchdog(
      op,
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ outcome: 'failed', reason: 'aborted' }))
        })
    )
    await vi.advanceTimersByTimeAsync(120_000 + 1)
    const result = (await resultPromise) as { outcome: string }

    expect(result.outcome).toBe('failed')
    expect((writes as unknown as Internals).queueStopped).toBe(false)
  })
})

describe('mutex ownership (A6 step 1)', () => {
  it('releases only its own token, never a holder that replaced it', async () => {
    const { store } = openStore()
    const sync = new SyncEngine(
      {
        id: ACCOUNT,
        host: '127.0.0.1',
        port: 10143,
        security: 'none',
        user: 'u',
        pass: 'p',
        readOnly: false,
        dataDir: store.dataDirResolved
      },
      store
    )
    const locks = sync as unknown as {
      syncingFolders: Map<string, symbol>
      withFolderMutex: <T>(p: string, fn: () => Promise<T>, owner?: symbol) => Promise<T>
    }

    let bodyRan = false
    let innerHeld: symbol | undefined
    const outerOwner = Symbol('outer')

    // While the body runs, another holder takes the folder (the watchdog gave up and a
    // restart's recovery path took it). The outer finally must NOT delete that entry.
    await locks.withFolderMutex(
      'INBOX',
      async () => {
        bodyRan = true
        innerHeld = Symbol('replacement')
        locks.syncingFolders.set('INBOX', innerHeld)
      },
      outerOwner
    )

    expect(bodyRan).toBe(true)
    expect(locks.syncingFolders.get('INBOX')).toBe(innerHeld)
  })

  it('releases its own entry when nobody replaced it', async () => {
    const { store } = openStore()
    const sync = new SyncEngine(
      {
        id: ACCOUNT,
        host: '127.0.0.1',
        port: 10143,
        security: 'none',
        user: 'u',
        pass: 'p',
        readOnly: false,
        dataDir: store.dataDirResolved
      },
      store
    )
    const locks = sync as unknown as {
      syncingFolders: Map<string, symbol>
      withFolderMutex: <T>(p: string, fn: () => Promise<T>) => Promise<T>
    }

    await locks.withFolderMutex('INBOX', async () => {
      expect(locks.syncingFolders.has('INBOX')).toBe(true)
    })

    expect(locks.syncingFolders.has('INBOX')).toBe(false)
  })
})
