// G2/L3c: the write connection is reused across ops, and a dead one is replaced.
//
// Before this, every op opened its own connection and logged out again. On the local sandbox that
// costs connect+LOGIN 73 ms and SELECT 31 ms per op with zero network latency; over TLS to IONOS
// it is several hundred milliseconds per click - the lag the user reported.
//
// The pool is tested directly (no server): the three failure modes are all silent otherwise.
import fs from 'node:fs'
import { sandboxCredentials, sandboxWriteAccount } from './helpers/writeAccount'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WriteConnectionPool,
  type PooledConnection
} from '../src/main/mailclient/core/write_connection'

type Fake = PooledConnection & { id: number; closed: boolean }

const ACCOUNT = 'reuse'
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

/** A connection factory that counts, so "reused" is observable rather than assumed */
function factory(usable = true): {
  connect: () => Promise<Fake>
  count: () => number
  last: () => Fake | null
  setUsable: (value: boolean) => void
} {
  let made = 0
  let latest: Fake | null = null
  let isUsable = usable
  return {
    connect: async () => {
      made += 1
      const conn: Fake = {
        id: made,
        closed: false,
        get usable() {
          return isUsable
        },
        logout: async () => {
          conn.closed = true
        },
        noop: async () => undefined,
        close: () => {
          conn.closed = true
        }
      }
      latest = conn
      return conn
    },
    count: () => made,
    last: () => latest,
    setUsable: (value: boolean) => {
      isUsable = value
    }
  }
}

describe('G2/L3c: one connection for many ops', () => {
  it('connects once and reuses it', async () => {
    const f = factory()
    const pool = new WriteConnectionPool(f.connect)
    const first = await pool.get()
    const second = await pool.get()
    expect(f.count()).toBe(1)
    expect(second).toBe(first)
  })

  it('reports that a connection is held', async () => {
    const f = factory()
    const pool = new WriteConnectionPool(f.connect)
    expect(pool.held).toBe(false)
    await pool.get()
    expect(pool.held).toBe(true)
  })
})

describe('G2/L3c: a dead connection is never reused', () => {
  it('replaces a connection that reports itself unusable', async () => {
    // imapflow loses a socket silently on a server timeout, so a client that looks alive can be
    // dead; handing it to the next op would turn one timeout into every later op failing
    const f = factory()
    const pool = new WriteConnectionPool(f.connect)
    const first = await pool.get()
    f.setUsable(false)
    const second = await pool.get()
    expect(f.count()).toBe(2)
    expect(second).not.toBe(first)
    // the dead one is closed, not leaked
    expect((first as Fake).closed).toBe(true)
  })

  it('drops the connection after a failed op', async () => {
    const f = factory()
    const pool = new WriteConnectionPool(f.connect)
    const first = await pool.get()
    await pool.drop()
    expect(pool.held).toBe(false)
    expect((first as Fake).closed).toBe(true)
    // the next op reconnects rather than reusing the discarded one
    await pool.get()
    expect(f.count()).toBe(2)
  })

  it('survives a logout that throws', async () => {
    // A socket that is already gone often throws on logout; that must not block the next op
    let made = 0
    const pool = new WriteConnectionPool(async () => {
      made += 1
      return {
        usable: false,
        logout: async () => {
          throw new Error('socket already closed')
        },
        noop: async () => undefined,
        close: () => {
          throw new Error('socket already closed')
        }
      }
    })
    await expect(pool.drop()).resolves.toBeUndefined()
    await expect(pool.get()).resolves.toBeTruthy()
    expect(made).toBe(1)
  })
})

// The pool's OTHER half: an op that fails must discard the connection, so the next op does not
// inherit a half-dead socket. The tests above stub the pool itself, which cannot see this; this one
// mocks the connection factory (connectWriteImap) so the REAL pool and the REAL execute() path run.

const connectCalls: number[] = []
vi.mock('../src/main/mailclient/core/write_guard', async () => {
  const actual = await vi.importActual<typeof import('../src/main/mailclient/core/write_guard')>(
    '../src/main/mailclient/core/write_guard'
  )
  return {
    ...actual,
    connectWriteImap: async () => {
      connectCalls.push(Date.now())
      const n = connectCalls.length
      return {
        usable: true,
        mailboxOpen: async () => ({ uidValidity: 1n, exists: 1 }),
        fetch: () => ({ next: async () => ({ done: true, value: undefined }) }),
        append: async () => {
          // the FIRST connection fails on append, the second works
          if (n === 1) throw new Error('socket closed')
          return { uid: 42 }
        },
        messageFlagsAdd: async () => true,
        messageDelete: async () => true,
        logout: async () => undefined,
        noop: async () => undefined,
        close: () => undefined,
        once: () => undefined,
        on: () => undefined
      }
    }
  }
})

describe('criterion 1: a failed op discards the shared connection', () => {
  it('reconnects for the op after one fails, instead of reusing a half-dead socket', async () => {
    const { Store } = await import('../src/main/mailclient/core/store')
    const { WriteEngine } = await import('../src/main/mailclient/core/write_engine')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-poolfail-'))
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
    const store = new Store(dir, ACCOUNT)
    cleanups.push(() => store.close())
    store.upsertFolder({ imapPath: 'Drafts', delimiter: '/', specialUse: '\\Drafts' })

    const engine = new WriteEngine(store, ACCOUNT, {
      writeAccount: sandboxWriteAccount(),
      credentials: sandboxCredentials
    })
    const mime = Buffer.from('From: a@example.test\r\nSubject: X\r\n\r\nbody\r\n')
    const enqueue = (): string =>
      store.journalEnqueue({
        accountId: ACCOUNT,
        kind: 'draft_save',
        folderPath: 'Drafts',
        folderUidValidity: '99',
        payload: { mime: mime.toString('base64') }
      })

    const first = await engine.execute(store.journalGet(enqueue()) as never)
    expect(first.outcome).toBe('failed')
    expect(connectCalls).toHaveLength(1)

    // the second op must NOT reuse the connection that just failed
    await engine.execute(store.journalGet(enqueue()) as never)
    expect(connectCalls).toHaveLength(2)
  })
})
