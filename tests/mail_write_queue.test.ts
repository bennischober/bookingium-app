// How write ops get at a folder while the sync engine works on it: a long download
// hands the folder mutex to a waiting write between batches, and an op that is
// already queued is not run a second time (the startup replay sees it as pending)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store } from '../src/main/mailclient/core/store'
import { SyncEngine } from '../src/main/mailclient/core/sync'
import { WriteEngine } from '../src/main/mailclient/core/write_engine'

const ACCOUNT = 'acc'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function openStore(): { store: Store; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-writes-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { store, dir }
}

// The private parts a folder download uses
type Internals = {
  withFolderMutex: <T>(path: string, fn: () => Promise<T>) => Promise<T>
  yieldFolderToWrites: (path: string) => Promise<void>
}

function engine(): SyncEngine {
  const { store, dir } = openStore()
  return new SyncEngine(
    {
      id: ACCOUNT,
      host: '127.0.0.1',
      port: 10143,
      security: 'none',
      user: 'u',
      pass: 'p',
      readOnly: false,
      dataDir: dir
    },
    store
  )
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('folder mutex between sync and writes', () => {
  it('lets a waiting write in between download batches', async () => {
    const sync = engine()
    const internals = sync as unknown as Internals
    const log: string[] = []

    const download = internals.withFolderMutex('Projekte', async () => {
      for (let batch = 1; batch <= 4; batch++) {
        await internals.yieldFolderToWrites('Projekte')
        log.push(`batch ${batch} start`)
        await sleep(50)
        log.push(`batch ${batch} end`)
      }
    })
    await sleep(20)
    const write = sync.withFolderMutexPublic('Projekte', async () => {
      log.push('write')
    })

    await Promise.all([download, write])
    // The write ran right after the batch it arrived in, not after the whole download,
    // and never inside a batch
    expect(log.indexOf('write')).toBe(log.indexOf('batch 1 end') + 1)
    expect(log.at(-1)).toBe('batch 4 end')
  })

  it('does not hand over a folder nobody is waiting for', async () => {
    const sync = engine()
    const internals = sync as unknown as Internals
    const log: string[] = []
    const other = sync.withFolderMutexPublic('Archiv', async () => {
      await sleep(30)
      log.push('write elsewhere')
    })
    await internals.withFolderMutex('Projekte', async () => {
      await internals.yieldFolderToWrites('Projekte')
      log.push('batch')
    })
    await other
    expect(log).toEqual(['batch', 'write elsewhere'])
  })
})

describe('write engine queue', () => {
  it('shares an op that is still queued instead of running it twice', async () => {
    const { store } = openStore()
    const writes = new WriteEngine(store, ACCOUNT)
    let entered = 0
    let release!: () => void
    const blocked = new Promise<void>((r) => (release = r))
    writes.attachEngine({
      // The first lock is held until released, like a folder still downloading
      withFolderMutex: async (_path, fn) => {
        entered++
        await blocked
        return fn()
      },
      triggerResync: () => {}
    })
    const id = store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'flag',
      folderPath: 'INBOX',
      uid: 1,
      payload: { flag: '\\Seen', set: true }
    })
    const op = store.journalGet(id)!

    const first = writes.execute(op)
    const second = writes.execute(op)
    release()
    // No sandbox is configured here, so the op itself fails; it ran only once
    await expect(first).rejects.toThrow()
    await expect(second).rejects.toThrow()
    expect(entered).toBe(1)
  })
})
