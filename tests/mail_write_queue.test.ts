// How write ops get at a folder while the sync engine works on it: a long download
// hands the folder mutex to a waiting write between batches, and an op that is
// already queued is not run a second time (the startup replay sees it as pending)
import { sandboxWriteAccount, sandboxCredentials } from './helpers/writeAccount'
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
    const writes = new WriteEngine(store, ACCOUNT, { writeAccount: sandboxWriteAccount(), credentials: sandboxCredentials })
    // No server in these two tests: the op itself fails, which is what they expect
    ;(writes as unknown as { writeClient: () => Promise<unknown> }).writeClient = async () => {
      throw new Error('no server in this test')
    }
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
    // The op itself fails on the stub client; what matters is that it ran only once
    await expect(first).rejects.toThrow()
    await expect(second).rejects.toThrow()
    expect(entered).toBe(1)
  })

  it('refuses a self-move without nesting the same folder mutex (A2c)', async () => {
    const { store, dir } = openStore()
    const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
    const file = 'key-1.eml'
    fs.writeFileSync(path.join(dir, file), 'Subject: x\r\n\r\nbody\r\n')
    store.insertMessage({
      account_id: ACCOUNT,
      folder_id: inbox.id,
      uid: 1,
      message_key: 'key-1',
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
      flags_json: '{}',
      modseq: null,
      has_attachments: 0,
      attachments_json: '[]',
      size_bytes: 30,
      snippet: 'x',
      parsed_ok: 1,
      parse_error: null,
      body_text: 'x',
      body_html: null
    })
    const selfMove = store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'move',
      folderPath: 'INBOX',
      folderUidValidity: '1',
      uid: 1,
      messageKey: 'key-1',
      messageId: '<1@example.test>',
      targetFolderPath: 'INBOX'
    })
    const next = store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'flag',
      folderPath: 'INBOX',
      uid: 1,
      payload: { flag: '\\Seen', set: true }
    })

    const writes = new WriteEngine(store, ACCOUNT, { writeAccount: sandboxWriteAccount(), credentials: sandboxCredentials })
    // No server in these two tests: the op itself fails, which is what they expect
    ;(writes as unknown as { writeClient: () => Promise<unknown> }).writeClient = async () => {
      throw new Error('no server in this test')
    }
    const locked: string[] = []
    writes.attachEngine({
      // A nested acquisition of the same folder would never return; record the order
      withFolderMutex: async (p, fn) => {
        locked.push(p)
        return fn()
      },
      triggerResync: () => {}
    })

    // The self-move is refused before any server contact (no sandbox configured, so any
    // attempt to reach one would throw instead of returning a conflict)
    const result = await writes.execute(store.journalGet(selfMove)!)
    expect(result).toMatchObject({ outcome: 'conflict' })
    expect(result).toHaveProperty('reason', expect.stringContaining('target equals source'))
    // The mutex was taken once for the op, never nested for the same folder
    expect(locked).toEqual(['INBOX'])

    // The queue keeps running: the next op is attempted (and fails on the stub client,
    // which proves it got past the wedged self-move)
    await expect(writes.execute(store.journalGet(next)!)).rejects.toThrow()
  })
})
