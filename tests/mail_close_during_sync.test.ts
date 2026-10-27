// I17 (test gap): MailCore.close() must not close an account's store while the account is still
// syncing. It used to wait only for a full pass (`isSyncing()`); a folder sync a poll or a write's
// resync started, or a poll itself, kept writing into a closed database.
//
// The server is unreachable and the sync work is stubbed to block, so nothing here talks to the
// sandbox.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMailCore } from '../src/main/mailclient/core/index'
import { Store } from '../src/main/mailclient/core/store'
import type { SyncEngine } from '../src/main/mailclient/core/sync'

const ACCOUNT = 'acc'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  while (cleanups.length) await cleanups.pop()!()
})

function account() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-close-'))
  cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const dir = path.join(dataDir, ACCOUNT)
  fs.mkdirSync(dir, { recursive: true })
  const seed = new Store(dir, ACCOUNT)
  seed.upsertFolder({ imapPath: 'INBOX', delimiter: '/', specialUse: null, uidValidity: '1' })
  seed.close()
  const api = createMailCore({
    dataDir,
    accounts: [
      {
        id: ACCOUNT,
        kind: 'sandbox' as const,
        readOnly: true,
        email: 'a@example.test',
        host: '127.0.0.1',
        port: 1,
        security: 'none' as const,
        credentials: async () => ({ user: 'a@example.test', pass: 'x' })
      }
    ]
  })
  cleanups.push(() => api.close())
  const entry = (
    api as unknown as { entries: Map<string, { engine: SyncEngine; store: Store }> }
  ).entries.get(ACCOUNT)!
  return { api, engine: entry.engine, store: entry.store }
}

/** A promise the test resolves when it lets the stubbed work finish */
function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => (open = resolve))
  return { open, opened }
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('MailCore.close() during a sync outside a full pass (I17)', () => {
  it('waits for a folder sync a poll or a resync started', async () => {
    const { api, engine, store } = account()
    const work = gate()
    let storeOpen: boolean | undefined
    vi.spyOn(
      engine as unknown as { syncFolderInner: () => Promise<void> },
      'syncFolderInner'
    ).mockImplementation(async () => {
      await work.opened
      storeOpen = store.db.open
    })

    const sync = engine.syncFolder('INBOX')
    let closed = false
    const closing = api.close().then(() => (closed = true))
    await tick(400)
    expect(engine.isSyncing()).toBe(false)
    expect(closed).toBe(false)

    work.open()
    await sync
    await closing
    expect(storeOpen).toBe(true)
    expect(store.db.open).toBe(false)
  })

  it('waits for a folder sync that lent its mutex to a write', async () => {
    const { api, engine, store } = account()
    const work = gate()
    let storeOpen: boolean | undefined
    const folders = (engine as unknown as { syncingFolders: Map<string, symbol> }).syncingFolders
    vi.spyOn(
      engine as unknown as { syncFolderInner: () => Promise<void> },
      'syncFolderInner'
    ).mockImplementation(async () => {
      // what yieldFolderToWrites does between download batches: the folder is free meanwhile
      folders.delete('INBOX')
      await work.opened
      storeOpen = store.db.open
    })

    const sync = engine.syncFolder('INBOX')
    let closed = false
    const closing = api.close().then(() => (closed = true))
    await tick(400)
    expect(folders.size).toBe(0)
    expect(closed).toBe(false)

    work.open()
    await sync
    await closing
    expect(storeOpen).toBe(true)
  })

  it('waits for a poll in flight', async () => {
    const { api, engine, store } = account()
    const work = gate()
    let storeOpen: boolean | undefined
    const client = {
      status: async () => {
        await work.opened
        storeOpen = store.db.open
        return false
      }
    }
    vi.spyOn(engine as unknown as { connect: () => Promise<unknown> }, 'connect').mockResolvedValue(
      client
    )

    const poll = engine.pollOnce()
    let closed = false
    const closing = api.close().then(() => (closed = true))
    await tick(400)
    expect(closed).toBe(false)

    work.open()
    await poll
    await closing
    expect(storeOpen).toBe(true)
  })

  it('still closes when the work outlasts the wait', async () => {
    const { api, engine, store } = account()
    const work = gate()
    vi.spyOn(
      engine as unknown as { syncFolderInner: () => Promise<void> },
      'syncFolderInner'
    ).mockImplementation(() => work.opened)

    const sync = engine.syncFolder('INBOX')
    await api.close({ syncWaitMs: 300 })
    expect(store.db.open).toBe(false)
    work.open()
    await sync
  })
})
