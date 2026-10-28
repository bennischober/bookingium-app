// Sleep and resume.
//
// - A socket that died while the machine slept still looks usable: on resume the engine closes
//   the sync and the IDLE connection itself, without counting a disconnect, and IDLE comes back
//   dirty so it syncs what arrived meanwhile.
// - The write engine drops only an idle write connection, never one an op is using.
// - MailCore runs one catch-up per account however many wake signals arrive, after a pass that
//   is already running, and leaves a rejected login alone.
// - The host's wake watcher: resume event or a late clock tick, coalesced, waiting for the network.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sandboxCredentials, sandboxWriteAccount } from './helpers/writeAccount'
import { ConnectionBudget } from '../src/main/mailclient/core/connection_budget'
import { WriteEngine } from '../src/main/mailclient/core/write_engine'
import { Store } from '../src/main/mailclient/core/store'
import { makeSandboxAccount, SyncEngine } from '../src/main/mailclient/core/sync'
import { createMailCore, type MailCore } from '../src/main/mailclient/core/index'
import {
  WAKE_CHECK_MS,
  WAKE_COALESCE_MS,
  WAKE_ONLINE_POLL_MS,
  WAKE_ONLINE_WAIT_MS,
  watchSystemWake
} from '../src/main/mailclient/systemWake'

const ACCOUNT = 'resume'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  while (cleanups.length) await cleanups.pop()!()
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-resume-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not reached in time')
    await tick(10)
  }
}

/**
 * A connection whose socket died during sleep: it never answers and never closes by itself,
 * and imapflow keeps reporting it usable. Only close() ends it (emitting 'close' once).
 */
class DeadSocketImap extends EventEmitter {
  usable = true
  connected = false
  closeCalls = 0
  logouts = 0
  mailbox: unknown = null
  constructor() {
    super()
    this.on('error', () => undefined)
  }
  async connect(): Promise<void> {
    this.connected = true
  }
  async mailboxOpen(): Promise<unknown> {
    this.mailbox = { uidValidity: 1n, uidNext: 10, highestModseq: undefined }
    return this.mailbox
  }
  async noop(): Promise<void> {
    if (!this.usable) throw new Error('closed')
    return new Promise(() => undefined)
  }
  async logout(): Promise<void> {
    this.logouts += 1
    this.close()
  }
  close(): void {
    this.closeCalls += 1
    if (!this.usable) return
    this.usable = false
    this.emit('close')
  }
}

describe('resume: the sync engine drops its connections', () => {
  function idleEngine() {
    const dir = tempDir()
    const store = new Store(dir, ACCOUNT)
    cleanups.push(() => store.close())
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
    const clients: DeadSocketImap[] = []
    const internals = engine as unknown as {
      newClient: () => DeadSocketImap
      progress: { connection: string }
      fullSyncFolder: () => Promise<void>
      conn: { client: DeadSocketImap | null; noteDisconnect: () => boolean }
    }
    internals.newClient = () => {
      const c = new DeadSocketImap()
      clients.push(c)
      return c
    }
    internals.progress.connection = 'online'
    const synced = { count: 0 }
    internals.fullSyncFolder = async () => {
      synced.count += 1
    }
    const disconnects = vi.spyOn(internals.conn, 'noteDisconnect')
    cleanups.push(async () => {
      engine.stopIdle()
      await engine.close()
    })
    return { engine, budget, clients, internals, synced, errors, disconnects }
  }

  it('replaces a dead IDLE connection and syncs what it missed', async () => {
    const { engine, budget, clients, synced, errors, disconnects } = idleEngine()
    void engine.startIdle('INBOX')
    await until(() => clients.length === 1 && clients[0].connected)
    expect(budget.used).toBe(1)

    engine.dropConnections()

    await until(() => clients.length === 2 && clients[1].usable && synced.count === 1)
    expect(clients[0].usable).toBe(false)
    // closed without a LOGOUT: a dead socket would never answer one
    expect(clients[0].logouts).toBe(0)
    expect(budget.used).toBe(1)
    expect(disconnects).not.toHaveBeenCalled()
    expect(errors).toEqual([])
    expect(engine.getStatus().connection).toBe('online')
  })

  it('closes a dead sync connection so the next pass connects afresh', async () => {
    const { engine, internals, disconnects } = idleEngine()
    const dead = new DeadSocketImap()
    internals.conn.client = dead

    engine.dropConnections()

    expect(dead.closeCalls).toBe(1)
    expect(dead.usable).toBe(false)
    expect(internals.conn.client).toBeNull()
    expect(disconnects).not.toHaveBeenCalled()
  })

  it('opens no circuit however often the machine wakes', async () => {
    const { engine, clients, synced, errors } = idleEngine()
    void engine.startIdle('INBOX')
    for (let wake = 1; wake <= 10; wake++) {
      await until(() => clients.length === wake && clients[wake - 1].connected)
      engine.dropConnections()
    }
    await until(() => clients.length === 11 && synced.count === 10)
    expect(errors).toEqual([])
    expect(engine.getStatus().connection).toBe('online')
  })
})

describe('resume: the write engine', () => {
  function writeEngine() {
    const dir = tempDir()
    const store = new Store(dir, ACCOUNT)
    cleanups.push(() => store.close())
    const engine = new WriteEngine(store, ACCOUNT, {
      writeAccount: sandboxWriteAccount(),
      credentials: sandboxCredentials
    })
    const made: DeadSocketImap[] = []
    vi.spyOn(
      engine as unknown as { connectCounted: () => Promise<unknown> },
      'connectCounted'
    ).mockImplementation(async () => {
      const client = new DeadSocketImap()
      made.push(client)
      return client
    })
    const internals = engine as unknown as {
      pool: { get: () => Promise<DeadSocketImap>; idle: () => void; held: boolean }
      bodies: Set<Promise<unknown>>
    }
    return { engine, internals, made }
  }

  it('closes an idle write connection without a LOGOUT', async () => {
    const { engine, internals, made } = writeEngine()
    await internals.pool.get()
    internals.pool.idle()

    engine.dropIdleConnection()

    expect(internals.pool.held).toBe(false)
    expect(made[0].closeCalls).toBe(1)
    expect(made[0].logouts).toBe(0)
  })

  it('leaves the connection of an op in flight alone', async () => {
    const { engine, internals, made } = writeEngine()
    await internals.pool.get()
    // an op body that has not ended yet; its watchdog owns the connection
    internals.bodies.add(new Promise(() => undefined))

    engine.dropIdleConnection()

    expect(internals.pool.held).toBe(true)
    expect(made[0].closeCalls).toBe(0)
    internals.bodies.clear()
    engine.dropIdleConnection()
  })
})

describe('resume: one catch-up per account', () => {
  type Entry = { engine: SyncEngine; writes: WriteEngine }

  function core(accounts = [ACCOUNT, 'second']) {
    const dataDir = tempDir()
    const mail = createMailCore({
      dataDir,
      accounts: accounts.map((id, i) => ({
        id,
        readOnly: i > 0,
        email: `${id}@example.test`,
        host: '127.0.0.1',
        port: 1,
        security: 'none' as const,
        credentials: async () => ({ user: `${id}@example.test`, pass: 'x' })
      }))
    })
    cleanups.push(() => mail.close())
    const internals = mail as unknown as { started: boolean; entries: Map<string, Entry> }
    const spies = new Map(
      [...internals.entries].map(([id, e]) => {
        let finish: () => void = () => undefined
        const syncAll = vi.spyOn(e.engine, 'syncAll').mockImplementation(
          () =>
            new Promise((resolve) => {
              finish = () => resolve(e.engine.getStatus())
            })
        )
        return [
          id,
          {
            syncAll,
            finish: () => finish(),
            drop: vi.spyOn(e.engine, 'dropConnections').mockImplementation(() => undefined),
            dropWrite: vi.spyOn(e.writes, 'dropIdleConnection')
          }
        ]
      })
    )
    return { mail, internals, spies }
  }

  const finishAll = (spies: Map<string, { finish: () => void }>): void => {
    for (const s of spies.values()) s.finish()
  }

  it('does nothing before start', async () => {
    const { mail, spies } = core()
    await mail.afterSystemResume()
    for (const s of spies.values()) {
      expect(s.drop).not.toHaveBeenCalled()
      expect(s.syncAll).not.toHaveBeenCalled()
    }
  })

  it('drops the connections of every account and syncs each once, however often it wakes', async () => {
    const { mail, internals, spies } = core()
    internals.started = true

    const first = mail.afterSystemResume()
    const second = mail.afterSystemResume()
    const third = mail.afterSystemResume()
    await tick(10)
    for (const s of spies.values()) {
      expect(s.drop).toHaveBeenCalledTimes(1)
      expect(s.dropWrite).toHaveBeenCalledTimes(1)
      expect(s.syncAll).toHaveBeenCalledTimes(1)
    }
    finishAll(spies)
    await Promise.all([first, second, third])

    // a later wake is a new one
    const later = mail.afterSystemResume()
    await tick(10)
    finishAll(spies)
    await later
    for (const s of spies.values()) expect(s.syncAll).toHaveBeenCalledTimes(2)
  })

  it('catches up after a pass that is already running, not alongside it', async () => {
    const { mail, internals, spies } = core([ACCOUNT])
    internals.started = true
    const engine = internals.entries.get(ACCOUNT)!.engine
    let passDone: () => void = () => undefined
    vi.spyOn(engine, 'isSyncing').mockReturnValue(true)
    vi.spyOn(engine, 'waitForSync').mockImplementation(
      () => new Promise<void>((resolve) => (passDone = resolve))
    )
    const s = spies.get(ACCOUNT)!

    const run = mail.afterSystemResume()
    await tick(10)
    expect(s.drop).toHaveBeenCalledTimes(1)
    expect(s.syncAll).not.toHaveBeenCalled()
    passDone()
    await tick(10)
    expect(s.syncAll).toHaveBeenCalledTimes(1)
    s.finish()
    await run
  })

  it('leaves an account with a rejected login alone', async () => {
    const { mail, internals, spies } = core()
    internals.started = true
    const engine = internals.entries.get(ACCOUNT)!.engine
    const status = engine.getStatus()
    vi.spyOn(engine, 'getStatus').mockReturnValue({ ...status, connection: 'auth-failed' })

    const run = mail.afterSystemResume()
    await tick(10)
    finishAll(spies)
    await run
    expect(spies.get(ACCOUNT)!.drop).not.toHaveBeenCalled()
    expect(spies.get(ACCOUNT)!.syncAll).not.toHaveBeenCalled()
    expect(spies.get('second')!.syncAll).toHaveBeenCalledTimes(1)
  })

  it('does nothing once closed', async () => {
    const { mail, internals, spies } = core()
    internals.started = true
    await (mail as MailCore).close()
    await mail.afterSystemResume()
    for (const s of spies.values()) expect(s.syncAll).not.toHaveBeenCalled()
  })
})

describe('resume: the wake watcher', () => {
  function watch(online = true) {
    vi.useFakeTimers()
    const state = { online }
    let resume: () => void = () => undefined
    const onWake = vi.fn()
    const stop = watchSystemWake(onWake, {
      onResume: (listener) => (resume = listener),
      isOnline: () => state.online
    })
    cleanups.push(stop)
    /** The machine sleeps for `ms`: the clock jumps, no timer fires meanwhile */
    const sleep = (ms: number): void => vi.setSystemTime(Date.now() + ms)
    return { state, onWake, stop, resume: () => resume(), sleep }
  }

  it('reports a resume once', () => {
    const { onWake, resume } = watch()
    resume()
    expect(onWake).toHaveBeenCalledTimes(1)
  })

  it('reports a sleep the power monitor missed by the late clock tick', () => {
    const { onWake, sleep } = watch()
    vi.advanceTimersByTime(WAKE_CHECK_MS * 3)
    expect(onWake).not.toHaveBeenCalled()
    sleep(10 * 60_000)
    vi.advanceTimersByTime(WAKE_CHECK_MS)
    expect(onWake).toHaveBeenCalledTimes(1)
  })

  it('counts a resume and the late clock tick after it as one wake', () => {
    const { onWake, resume, sleep } = watch()
    sleep(10 * 60_000)
    resume()
    resume()
    vi.advanceTimersByTime(WAKE_CHECK_MS)
    expect(onWake).toHaveBeenCalledTimes(1)
    // the next sleep is a new wake
    vi.advanceTimersByTime(WAKE_COALESCE_MS)
    resume()
    expect(onWake).toHaveBeenCalledTimes(2)
  })

  it('waits for the network after a wake', () => {
    const { state, onWake, resume } = watch(false)
    resume()
    vi.advanceTimersByTime(WAKE_ONLINE_POLL_MS * 5)
    expect(onWake).not.toHaveBeenCalled()
    // another signal while waiting adds nothing
    resume()
    state.online = true
    vi.advanceTimersByTime(WAKE_ONLINE_POLL_MS)
    expect(onWake).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(WAKE_ONLINE_WAIT_MS)
    expect(onWake).toHaveBeenCalledTimes(1)
  })

  it('reports the wake anyway when the network stays away', () => {
    const { onWake, resume } = watch(false)
    resume()
    vi.advanceTimersByTime(WAKE_ONLINE_WAIT_MS - WAKE_ONLINE_POLL_MS)
    expect(onWake).not.toHaveBeenCalled()
    vi.advanceTimersByTime(WAKE_ONLINE_POLL_MS * 2)
    expect(onWake).toHaveBeenCalledTimes(1)
  })

  it('leaves no timers behind once stopped', () => {
    const { stop, resume } = watch(false)
    resume()
    expect(vi.getTimerCount()).toBe(2)
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
