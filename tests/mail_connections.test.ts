// I15a: connections and errors.
//
// - MR-19: sync, IDLE and the write connection share one budget per account; a write is urgent
//   and makes IDLE give its slot back. The write connection closes after an idle while, is
//   NOOP-checked before reuse, and is closed when the watchdog abandons an op.
// - MR-30: a missing folder is a conflict, a dropped connection a failure that drops the client.
// - MR-32: a move that crashed resumes only on a message that arrived at or above the target's
//   recorded UIDNEXT, exactly once.
// - MR-39: the IDLE wait leaves no timers behind.
// - MR-40: each core event reaches each listener once, by name.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sandboxCredentials, sandboxWriteAccount } from './helpers/writeAccount'
import { ConnectionBudget } from '../src/main/mailclient/core/connection_budget'
import { WRITE_IDLE_MS, WriteConnectionPool } from '../src/main/mailclient/core/write_connection'
import { folderMissing, WriteEngine } from '../src/main/mailclient/core/write_engine'
import { Store, type JournalRow } from '../src/main/mailclient/core/store'
import { idleWait, makeSandboxAccount, SyncEngine } from '../src/main/mailclient/core/sync'
import { createMailCore, type MailCoreEvent } from '../src/main/mailclient/core/index'

const ACCOUNT = 'conn'

// connectCounted() runs for real in the tests that set this; only the network call is replaced
const writeConnect = vi.hoisted(() => ({ next: null as (() => unknown) | null }))
vi.mock('../src/main/mailclient/core/write_guard', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/mailclient/core/write_guard')>()
  return {
    ...real,
    connectWriteImap: (...args: Parameters<typeof real.connectWriteImap>) =>
      writeConnect.next ? Promise.resolve(writeConnect.next()) : real.connectWriteImap(...args)
  }
})

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  writeConnect.next = null
  while (cleanups.length) await cleanups.pop()!()
})

function openStore(): { store: Store; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-conn-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { store, dir }
}

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Resolves when `check` is true, polling; fails the test after `ms` */
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not reached in time')
    await tick(10)
  }
}

/** Whether a promise has settled, without waiting for it */
async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false
  void p.then(
    () => (done = true),
    () => (done = true)
  )
  await tick(20)
  return done
}

describe('MR-19: one connection budget per account', () => {
  it('holds no more connections than the cap', async () => {
    const budget = new ConnectionBudget(2)
    await budget.acquire()
    const second = await budget.acquire()
    const third = budget.acquire()
    expect(await settled(third)).toBe(false)
    expect(budget.used).toBe(2)
    second()
    await third
    expect(budget.used).toBe(2)
  })

  it('gives a freed slot to the write before a waiting sync', async () => {
    const budget = new ConnectionBudget(1)
    const held = await budget.acquire()
    const order: string[] = []
    const sync = budget.acquire().then((r) => (order.push('sync'), r))
    await tick(5)
    const write = budget.acquire({ urgent: true }).then((r) => (order.push('write'), r))
    await tick(5)
    held()
    const release = await write
    expect(order).toEqual(['write'])
    expect(await settled(sync)).toBe(false)
    release()
    await sync
    expect(order).toEqual(['write', 'sync'])
  })

  it('asks IDLE to give its slot back only for a write', async () => {
    const budget = new ConnectionBudget(1)
    const idle = await budget.acquire()
    const yielder = vi.fn(() => idle())
    budget.onYieldRequest(yielder)

    const sync = budget.acquire()
    expect(await settled(sync)).toBe(false)
    expect(yielder).not.toHaveBeenCalled()

    const release = await budget.acquire({ urgent: true })
    expect(yielder).toHaveBeenCalled()
    release()
    ;(await sync)()
  })

  it('counts a slot released twice (failed connect and close) once', async () => {
    const budget = new ConnectionBudget(2)
    const release = await budget.acquire()
    await budget.acquire()
    release()
    release()
    expect(budget.used).toBe(1)
  })

  it('stops waiting when the engine stops', async () => {
    const budget = new ConnectionBudget(1)
    await budget.acquire()
    let stopped = false
    const waiting = budget.acquire({ cancelled: () => stopped })
    stopped = true
    await expect(waiting).rejects.toThrow('stopped')
  })
})

type FakeConn = {
  id: number
  usable: boolean
  loggedOut: boolean
  closed: boolean
  logout: () => Promise<void>
  noop: () => Promise<void>
  close: () => void
}

function connections(noop: (c: FakeConn) => Promise<void> = async () => undefined) {
  const made: FakeConn[] = []
  const connect = async (): Promise<FakeConn> => {
    const conn: FakeConn = {
      id: made.length + 1,
      usable: true,
      loggedOut: false,
      closed: false,
      logout: async () => {
        conn.loggedOut = true
      },
      noop: () => noop(conn),
      close: () => {
        conn.closed = true
        conn.usable = false
      }
    }
    made.push(conn)
    return conn
  }
  return { made, connect }
}

describe('MR-19: the write connection', () => {
  it('closes after it was idle for a while, and gives the slot back', async () => {
    const c = connections()
    const pool = new WriteConnectionPool(c.connect, { idleMs: 30 })
    const first = await pool.get()
    pool.idle()
    await until(() => !pool.held)
    expect(first.loggedOut).toBe(true)
    expect(first.closed).toBe(true)
  })

  it('stays open when the next op comes before the idle timeout', async () => {
    const c = connections()
    const pool = new WriteConnectionPool(c.connect, { idleMs: 40 })
    const first = await pool.get()
    pool.idle()
    await tick(10)
    expect(await pool.get()).toBe(first)
    await tick(60)
    expect(pool.held).toBe(true)
    expect(first.closed).toBe(false)
  })

  it('reconnects when the NOOP before reuse fails', async () => {
    const c = connections(async (conn) => {
      if (conn.id === 1) throw new Error('socket gone')
    })
    const pool = new WriteConnectionPool(c.connect)
    const first = await pool.get()
    first.noop = async () => {
      throw new Error('socket gone')
    }
    const second = await pool.get()
    expect(second).not.toBe(first)
    expect(first.closed).toBe(true)
  })

  it('reconnects when the NOOP goes unanswered (a socket that died during sleep)', async () => {
    const c = connections((conn) =>
      conn.id === 1 ? new Promise<void>(() => undefined) : Promise.resolve()
    )
    const pool = new WriteConnectionPool(c.connect, { noopTimeoutMs: 30 })
    const first = await pool.get()
    const second = await pool.get()
    expect(second).not.toBe(first)
    expect(first.closed).toBe(true)
    expect(c.made).toHaveLength(2)
  })

  it('closes without a LOGOUT when the watchdog abandons an op', async () => {
    const c = connections()
    const pool = new WriteConnectionPool(c.connect)
    const first = await pool.get()
    pool.discard()
    expect(first.closed).toBe(true)
    expect(first.loggedOut).toBe(false)
    expect(pool.held).toBe(false)
  })
})

/** An imapflow stand-in for the write path: emits 'close' once, like imapflow 2.9 */
class FakeImap extends EventEmitter {
  usable = true
  closeCalls = 0
  logouts = 0
  mailbox: unknown = null
  constructor(readonly behaviour: Partial<Record<string, (...args: never[]) => unknown>> = {}) {
    super()
    this.on('error', () => undefined)
  }
  close(): void {
    this.closeCalls += 1
    if (!this.usable) return
    this.usable = false
    this.emit('close')
  }
  async logout(): Promise<void> {
    this.logouts += 1
    this.close()
  }
  async noop(): Promise<void> {
    if (!this.usable) throw new Error('closed')
  }
  async mailboxOpen(p: string): Promise<unknown> {
    const fn = this.behaviour.mailboxOpen as ((p: string, c: FakeImap) => unknown) | undefined
    return fn ? fn(p, this) : { uidValidity: 1n, exists: 1 }
  }
  fetch(): AsyncGenerator<unknown> {
    return (async function* () {
      yield {
        uid: 1,
        size: 30,
        internalDate: new Date('2026-01-01T09:00:00.000Z'),
        flags: new Set()
      }
    })()
  }
  async messageFlagsAdd(): Promise<boolean> {
    const fn = this.behaviour.messageFlagsAdd as ((c: FakeImap) => unknown) | undefined
    if (fn) await fn(this)
    return true
  }
}

function flagOp(store: Store): JournalRow {
  const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
  const file = 'k1.eml'
  store.insertMessage({
    account_id: ACCOUNT,
    folder_id: inbox.id,
    uid: 1,
    message_key: 'k1',
    file_path: file,
    message_id: '<1@example.test>',
    in_reply_to: null,
    references_json: '[]',
    thread_id: null,
    date: '2026-01-01T09:00:00.000Z',
    internal_date: '2026-01-01T09:00:00.000Z',
    subject: 'x',
    from_name: 'A',
    from_email: 'a@example.test',
    to_json: '[]',
    cc_json: '[]',
    bcc_json: '[]',
    flags_json: '{"seen":false,"flagged":false,"draft":false,"deleted":false,"answered":false}',
    modseq: null,
    has_attachments: 0,
    attachments_json: '[]',
    size_bytes: 30,
    snippet: 'x',
    parsed_ok: 1,
    parse_error: null,
    body_text: 'x',
    body_html: null
  } as never)
  const id = store.journalEnqueue({
    accountId: ACCOUNT,
    kind: 'flag',
    folderPath: 'INBOX',
    folderUidValidity: '1',
    uid: 1,
    messageKey: 'k1',
    payload: { add: ['\\Seen'], remove: [] }
  })
  return store.journalGet(id)!
}

/** A WriteEngine whose pool connects to the given fakes, counted against `budget` */
function engineOn(store: Store, clients: FakeImap[], budget?: ConnectionBudget) {
  const engine = new WriteEngine(store, ACCOUNT, {
    writeAccount: sandboxWriteAccount(),
    credentials: sandboxCredentials,
    budget
  })
  const made: FakeImap[] = []
  const internals = engine as unknown as {
    credentials: () => Promise<unknown>
    execute: (op: JournalRow) => Promise<{ outcome: string; reason?: string }>
    watchdogMs: (op: JournalRow) => number
    pool: WriteConnectionPool<never>
  }
  // connectCounted() is the code under test; only the network call itself is replaced
  vi.spyOn(
    engine as unknown as { connectCounted: () => Promise<unknown> },
    'connectCounted'
  ).mockImplementation(async () => {
    const release = budget ? await budget.acquire({ urgent: true }) : () => undefined
    const client = clients[made.length]
    made.push(client)
    client.once('close', release)
    return client
  })
  return { engine, internals, made }
}

describe('MR-19: the write engine on the budget', () => {
  it('holds a slot while connected and gives it back when the watchdog closes the client', async () => {
    const { store } = openStore()
    const budget = new ConnectionBudget(2)
    // the op hangs on a dead socket until the client is closed
    const hung = new FakeImap({
      messageFlagsAdd: (c: FakeImap) =>
        new Promise((_, reject) => c.once('close', () => reject(new Error('Connection closed'))))
    })
    const { internals } = engineOn(store, [hung], budget)
    internals.watchdogMs = () => 50

    const started = Date.now()
    const result = await internals.execute(flagOp(store))
    // the body ended when the client closed, not after the 15 s grace period
    expect(Date.now() - started).toBeLessThan(5000)
    expect(result.outcome).toBe('failed')
    expect(hung.closeCalls).toBeGreaterThan(0)
    expect(hung.logouts).toBe(0)
    expect(budget.used).toBe(0)
  })
})

describe('MR-19: the write connection takes its slot from the budget', () => {
  /** A WriteEngine whose real connectCounted() gets `client` from the mocked connect */
  function realEngine(store: Store, client: FakeImap, budget: ConnectionBudget) {
    writeConnect.next = () => client
    const engine = new WriteEngine(store, ACCOUNT, {
      writeAccount: sandboxWriteAccount(),
      credentials: sandboxCredentials,
      budget
    })
    return engine as unknown as {
      execute: (op: JournalRow) => Promise<{ outcome: string; reason?: string }>
    }
  }

  it('makes IDLE give its slot back when the budget is full', async () => {
    const { store } = openStore()
    const budget = new ConnectionBudget(1)
    const idleRelease = await budget.acquire()
    let yielded = 0
    cleanups.push(
      budget.onYieldRequest(() => {
        yielded += 1
        idleRelease()
      })
    )
    const client = new FakeImap()
    const run = realEngine(store, client, budget).execute(flagOp(store))
    const result = await Promise.race([run, tick(2000).then(() => ({ outcome: 'still waiting' }))])
    expect(result.outcome).toBe('done')
    expect(yielded).toBe(1)
    expect(budget.used).toBe(1)
  })

  it('gives the slot back when the connection closes', async () => {
    const { store } = openStore()
    const budget = new ConnectionBudget(2)
    const client = new FakeImap()
    expect((await realEngine(store, client, budget).execute(flagOp(store))).outcome).toBe('done')
    expect(budget.used).toBe(1)
    client.close()
    expect(budget.used).toBe(0)
  })

  it('logs out once it has been idle after an op', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { store } = openStore()
    const budget = new ConnectionBudget(2)
    const client = new FakeImap()
    expect((await realEngine(store, client, budget).execute(flagOp(store))).outcome).toBe('done')
    await vi.advanceTimersByTimeAsync(WRITE_IDLE_MS - 1000)
    expect(client.logouts).toBe(0)
    await vi.advanceTimersByTimeAsync(2000)
    await until(() => client.logouts === 1)
    expect(budget.used).toBe(0)
  })
})

describe('MR-30: a missing folder is not a dropped connection', () => {
  it('classifies the server answers', () => {
    expect(folderMissing({ responseStatus: 'NO', serverResponseCode: 'NONEXISTENT' })).toBe(true)
    expect(folderMissing({ responseStatus: 'NO', serverResponseCode: 'TRYCREATE' })).toBe(true)
    expect(folderMissing({ responseStatus: 'NO' })).toBe(true)
    expect(folderMissing({ responseStatus: 'NO', serverResponseCode: 'UNAVAILABLE' })).toBe(false)
    expect(folderMissing({ responseStatus: 'NO', serverResponseCode: 'INUSE' })).toBe(false)
    expect(folderMissing({ responseStatus: 'BAD' })).toBe(false)
    expect(folderMissing({ code: 'NoConnection' })).toBe(false)
    expect(folderMissing(new Error('read ECONNRESET'))).toBe(false)
    expect(folderMissing(undefined)).toBe(false)
  })

  it('a SELECT on a dropped socket fails the op and drops the client', async () => {
    const { store } = openStore()
    const dropped = new FakeImap({
      mailboxOpen: () => {
        throw Object.assign(new Error('Connection not available'), { code: 'NoConnection' })
      }
    })
    const { internals } = engineOn(store, [dropped, new FakeImap()])
    const result = await internals.execute(flagOp(store))
    expect(result.outcome).toBe('failed')
    expect(result.reason).toMatch(/select failed/)
    expect(dropped.usable).toBe(false)
  })

  it('a SELECT the server answers NONEXISTENT is a conflict and keeps the client', async () => {
    const { store } = openStore()
    const client = new FakeImap({
      mailboxOpen: () => {
        throw Object.assign(new Error('Command failed'), {
          responseStatus: 'NO',
          serverResponseCode: 'NONEXISTENT'
        })
      }
    })
    const { internals } = engineOn(store, [client])
    const result = await internals.execute(flagOp(store))
    expect(result.outcome).toBe('conflict')
    expect(result.reason).toMatch(/folder gone/)
    expect(client.usable).toBe(true)
  })
})

describe('MR-32: a single move resumes only on a message that arrived', () => {
  function moveOp(store: Store, targetUidNext?: number): JournalRow {
    const op = flagOp(store)
    store.upsertFolder({ imapPath: 'Archiv', delimiter: '/', uidValidity: '7' })
    const id = store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'move',
      folderPath: 'INBOX',
      folderUidValidity: '1',
      uid: 1,
      messageKey: 'k1',
      messageId: '<1@example.test>',
      targetFolderPath: 'Archiv',
      payload: targetUidNext === undefined ? {} : { targetUidNext }
    })
    store.journalUpdate(op.id, { state: 'done' })
    return store.journalGet(id)!
  }

  /** The source no longer has uid 1; the target answers the search with `found` */
  function crashedClient(found: number[]): FakeImap {
    const client = new FakeImap({ mailboxOpen: () => ({ uidValidity: 1n, exists: 0 }) })
    client.fetch = () =>
      (async function* () {
        /* uid 1 is gone from the source */
      })()
    ;(client as unknown as { search: () => Promise<number[]> }).search = async () => found
    return client
  }

  const rowUid = (store: Store): number =>
    (store.db.prepare('SELECT uid FROM messages').get() as { uid: number }).uid

  it('takes the one copy at or above the recorded UIDNEXT', async () => {
    const { store } = openStore()
    const op = moveOp(store, 500)
    const { internals } = engineOn(store, [crashedClient([12, 501])])
    const result = await internals.execute(op)
    expect(result.outcome).toBe('done')
    expect(rowUid(store)).toBe(501)
  })

  it('does not take a copy that was there before the move', async () => {
    const { store } = openStore()
    const op = moveOp(store, 500)
    const { internals } = engineOn(store, [crashedClient([12])])
    const result = await internals.execute(op)
    expect(result.outcome).toBe('conflict')
    expect(rowUid(store)).toBe(1)
  })

  it('does not guess between two arrivals', async () => {
    const { store } = openStore()
    const op = moveOp(store, 500)
    const { internals } = engineOn(store, [crashedClient([500, 503])])
    expect((await internals.execute(op)).outcome).toBe('conflict')
    expect(rowUid(store)).toBe(1)
  })

  it('records the target UIDNEXT before the MOVE', async () => {
    const { store } = openStore()
    const op = moveOp(store)
    const order: string[] = []
    const client = new FakeImap()
    ;(client as unknown as { capabilities: Set<string> }).capabilities = new Set([
      'IMAP4rev1',
      'MOVE',
      'UIDPLUS'
    ])
    Object.assign(client, {
      status: async () => {
        order.push('status')
        return { path: 'Archiv', uidNext: 700 }
      },
      // the connection dies during the MOVE: the crash case the UIDNEXT is recorded for
      messageMove: async () => {
        order.push('move')
        throw new Error('Connection closed')
      }
    })
    const { internals } = engineOn(store, [client])
    expect((await internals.execute(op)).outcome).toBe('failed')
    expect(order).toEqual(['status', 'move'])
    const payload = JSON.parse(store.journalGet(op.id)!.payload || '{}') as {
      targetUidNext?: number
    }
    expect(payload.targetUidNext).toBe(700)
  })

  it('does not resume an op that recorded no UIDNEXT', async () => {
    const { store } = openStore()
    const op = moveOp(store)
    const { internals } = engineOn(store, [crashedClient([501])])
    expect((await internals.execute(op)).outcome).toBe('conflict')
    expect(rowUid(store)).toBe(1)
  })
})

describe('MR-39: the IDLE wait', () => {
  it('clears both timers on a wakeup', async () => {
    vi.useFakeTimers()
    let dirty = false
    const waiting = idleWait(() => dirty)
    expect(vi.getTimerCount()).toBe(2)
    dirty = true
    await vi.advanceTimersByTimeAsync(100)
    await waiting
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears both timers when the cap runs out', async () => {
    vi.useFakeTimers()
    const waiting = idleWait(() => false, 1000)
    await vi.advanceTimersByTimeAsync(1000)
    await waiting
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves nothing behind after many wakeups', async () => {
    vi.useFakeTimers()
    for (let i = 0; i < 50; i++) {
      let dirty = false
      const waiting = idleWait(() => dirty)
      dirty = true
      await vi.advanceTimersByTimeAsync(100)
      await waiting
    }
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('MR-40: core events by name', () => {
  it('delivers each event once, only to listeners of its name', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-events-'))
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }))
    const core = createMailCore({
      dataDir,
      accounts: [
        {
          id: ACCOUNT,
          kind: 'sandbox',
          readOnly: false,
          email: 'a@example.test',
          host: '127.0.0.1',
          port: 1,
          security: 'none' as const,
          credentials: async () => ({ user: 'a@example.test', pass: 'x' })
        }
      ]
    })
    cleanups.push(() => core.close())
    const got: Record<string, MailCoreEvent[]> = { sync: [], op: [], image: [] }
    core.on('sync-event', (e) => got.sync.push(e))
    core.on('op-event', (e) => got.op.push(e))
    const off = core.on('image-progress', (e) => got.image.push(e))

    const emit = (e: MailCoreEvent): void =>
      (core as unknown as { emitEvent: (e: MailCoreEvent) => void }).emitEvent(e)
    emit({ type: 'op-event', accountId: ACCOUNT, opId: '1', kind: 'move', outcome: 'done' })
    emit({ type: 'sync-event', accountId: ACCOUNT, event: { type: 'folder-list', folders: [] } })
    emit({ type: 'image-progress', accountId: ACCOUNT, messageId: 1, done: 1, total: 2 })
    off()
    emit({ type: 'image-progress', accountId: ACCOUNT, messageId: 1, done: 2, total: 2 })

    expect(got.op.map((e) => e.type)).toEqual(['op-event'])
    expect(got.sync.map((e) => e.type)).toEqual(['sync-event'])
    expect(got.image.map((e) => e.type)).toEqual(['image-progress'])
  })
})

describe('MR-19 / sync L2: the IDLE connection', () => {
  /** An imapflow stand-in for IDLE: connects, opens INBOX, waits; emits 'close' once */
  class IdleImap extends FakeImap {
    connected = false
    async connect(): Promise<void> {
      this.connected = true
    }
    override async mailboxOpen(): Promise<unknown> {
      this.mailbox = { uidValidity: 1n, uidNext: 10, highestModseq: undefined }
      return this.mailbox
    }
  }

  it('counts against the budget and gives its slot to a write', async () => {
    const { store, dir } = openStore()
    store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
    const budget = new ConnectionBudget(2)
    const account = makeSandboxAccount({
      id: ACCOUNT,
      host: '127.0.0.1',
      port: 1,
      security: 'none',
      user: 'u',
      pass: 'p',
      dataDir: dir
    })
    const engine = new SyncEngine(account, store, { budget })
    const errors: unknown[] = []
    engine.onSyncEvent = (e) => {
      if (e.type === 'error') errors.push(e)
    }
    const idles: IdleImap[] = []
    const internals = engine as unknown as {
      newClient: () => IdleImap
      progress: { connection: string }
      fullSyncFolder: () => Promise<void>
    }
    internals.newClient = () => {
      const c = new IdleImap()
      idles.push(c)
      return c
    }
    internals.progress.connection = 'online'
    let catchUps = 0
    internals.fullSyncFolder = async () => {
      catchUps += 1
    }
    cleanups.push(async () => {
      engine.stopIdle()
      await engine.close()
    })

    // the sync connection holds one slot
    const sync = await budget.acquire()
    void engine.startIdle('INBOX')
    await until(() => idles.length === 1 && idles[0].connected)
    expect(budget.used).toBe(2)

    // a write needs a slot: IDLE closes and the write gets it
    const write = await budget.acquire({ urgent: true })
    expect(idles[0].usable).toBe(false)
    expect(budget.used).toBe(2)
    expect(errors).toEqual([])

    // IDLE waits for a slot instead of opening a third connection
    await tick(100)
    expect(idles.filter((c) => c.usable)).toHaveLength(0)

    // the write connection idles out: IDLE comes back and syncs what it missed
    write()
    await until(() => idles.length === 2 && idles[1].usable && catchUps === 1)
    expect(budget.used).toBe(2)
    expect(errors).toEqual([])
    sync()
  })

  it('does not report a slot given to a write in the middle of a sync as an error', async () => {
    const { store, dir } = openStore()
    // no folder row yet: IDLE runs the folder's first sync right after it connects
    const budget = new ConnectionBudget(2)
    const account = makeSandboxAccount({
      id: ACCOUNT,
      host: '127.0.0.1',
      port: 1,
      security: 'none',
      user: 'u',
      pass: 'p',
      dataDir: dir
    })
    const engine = new SyncEngine(account, store, { budget })
    const errors: unknown[] = []
    engine.onSyncEvent = (e) => {
      if (e.type === 'error') errors.push(e)
    }
    const idles: IdleImap[] = []
    const internals = engine as unknown as {
      newClient: () => IdleImap
      progress: { connection: string }
      fullSyncFolder: (client: IdleImap) => Promise<void>
    }
    internals.newClient = () => {
      const c = new IdleImap()
      idles.push(c)
      return c
    }
    internals.progress.connection = 'online'
    let syncs = 0
    let syncing = false
    // the first sync hangs until its connection closes, then fails like imapflow does
    internals.fullSyncFolder = async (client) => {
      syncs += 1
      if (syncs > 1) return
      syncing = true
      await new Promise<void>((_, reject) =>
        client.once('close', () => reject(new Error('Connection closed')))
      )
    }
    cleanups.push(async () => {
      engine.stopIdle()
      await engine.close()
    })

    const sync = await budget.acquire()
    void engine.startIdle('INBOX')
    await until(() => syncing)

    const write = await budget.acquire({ urgent: true })
    expect(idles[0].usable).toBe(false)
    await tick(100)
    expect(errors).toEqual([])

    write()
    await until(() => idles.length === 2 && syncs >= 2)
    expect(errors).toEqual([])
    sync()
  })
})
