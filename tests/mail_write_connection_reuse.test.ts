// G2/L3c: the write connection is reused across ops, and a dead one is replaced.
//
// Before this, every op opened its own connection and logged out again. On the local sandbox that
// costs connect+LOGIN 73 ms and SELECT 31 ms per op with zero network latency; over TLS to IONOS
// it is several hundred milliseconds per click - the lag the user reported.
//
// The pool is tested directly (no server): the three failure modes are all silent otherwise.
import { describe, expect, it } from 'vitest'
import {
  WriteConnectionPool,
  type PooledConnection
} from '../src/main/mailclient/core/write_connection'

type Fake = PooledConnection & { id: number; closed: boolean }

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
        }
      }
    })
    await expect(pool.drop()).resolves.toBeUndefined()
    await expect(pool.get()).resolves.toBeTruthy()
    expect(made).toBe(1)
  })
})
