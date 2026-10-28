// I4: every server read runs on the folder it is about, and the sync stops cleanly.
//
// MR-09: the flag sweep and the file repair fetched UIDs on whatever folder the sync
// connection had selected last. Two folders sharing UID 1 then traded flags (sweep) or file
// contents (repair). Both now go through SyncEngine.withSelected, which EXAMINEs the folder
// and checks its UIDVALIDITY first.
// MR-10: the maintenance gate resolved "idle" on timeout and the repair ran mid-download.
// MR-31: a folder rename raced the sync (LIST created the target row, the re-key then failed on
// the primary key) and the write engine locked only the renamed folder, not its subfolders.
// Also here: UIDNEXT is stored as the server reported it, a full disk stops poll, IDLE and
// syncAll alike, and a poll in which no folder answered is not server contact (L3).
//
// Every server here is tests/helpers/scriptedImap.ts on 127.0.0.1; the messages are synthetic.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMailCore } from '../src/main/mailclient/core/index'
import type { AccountEntry } from '../src/main/mailclient/core/index'
import { Store } from '../src/main/mailclient/core/store'
import { makeSandboxAccount, SyncEngine } from '../src/main/mailclient/core/sync'
import { WriteEngine } from '../src/main/mailclient/core/write_engine'
import { scriptedImap, type FakeFolder, type ScriptedImap } from './helpers/scriptedImap'
import { sandboxCredentials, sandboxWriteAccount } from './helpers/writeAccount'

// The repair writes through writeMessageFile itself, not through the engine's fault seam, so a
// full disk is simulated here; off unless a test sets `writeFault.code`.
const writeFault = vi.hoisted(() => ({ code: null as string | null }))
vi.mock('../src/main/mailclient/core/files', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/mailclient/core/files')>()
  return {
    ...real,
    writeMessageFile: (...args: Parameters<typeof real.writeMessageFile>): string => {
      if (writeFault.code)
        throw Object.assign(new Error('injected write failure'), { code: writeFault.code })
      return real.writeMessageFile(...args)
    }
  }
})

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  writeFault.code = null
  while (cleanups.length) await cleanups.pop()!()
})

/** A synthetic message; `tag` makes each source distinct */
const source = (tag: string): string =>
  `Message-ID: <${tag}@example.test>\r\nFrom: a@example.test\r\nTo: b@example.test\r\n` +
  `Subject: synthetic\r\nDate: Thu, 01 Jan 2026 09:00:00 +0000\r\n\r\nbody ${tag}\r\n`

const folder = (
  uidValidity: number,
  uidNext: number,
  messages: FakeFolder['messages']
): FakeFolder => ({
  uidValidity,
  uidNext,
  messages
})

async function server(folders: Record<string, FakeFolder>): Promise<ScriptedImap> {
  const imap = await scriptedImap(folders)
  cleanups.push(() => imap.close())
  return imap
}

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-i4-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function engineFor(
  port: number,
  options?: ConstructorParameters<typeof SyncEngine>[2]
): { engine: SyncEngine; store: Store } {
  const dataDir = scratch()
  const store = new Store(dataDir, 'i4')
  const engine = new SyncEngine(
    makeSandboxAccount({
      id: 'i4',
      host: '127.0.0.1',
      port,
      security: 'none',
      user: 'u',
      pass: 'p',
      dataDir
    }),
    store,
    options
  )
  cleanups.push(async () => {
    engine.stopPolling()
    await engine.close()
    store.close()
  })
  return { engine, store }
}

const flagsOf = (store: Store, imapPath: string): { seen: boolean; flagged: boolean } =>
  JSON.parse(
    (
      store.db
        .prepare(
          'SELECT m.flags_json f FROM messages m JOIN folders f ON f.id = m.folder_id WHERE f.imap_path = ?'
        )
        .get(imapPath) as { f: string }
    ).f
  )

describe('I4 (MR-09): the flag sweep reads the folder it sweeps', () => {
  it('takes A flags from A, not from the folder selected before', async () => {
    const imap = await server({
      INBOX: folder(1, 2, [{ uid: 1, flags: [], source: source('inbox-1') }]),
      A: folder(2, 2, [{ uid: 1, flags: [], source: source('a-1') }])
    })
    const { engine, store } = engineFor(imap.port)
    await engine.syncAll()
    expect(flagsOf(store, 'A').flagged).toBe(false)

    // A's message is flagged on the server; INBOX's (same UID) is not
    imap.folders.get('A')!.messages[0].flags = ['\\Flagged']
    store.db.prepare('UPDATE folders SET last_flag_sweep = NULL').run()
    // leaves INBOX selected on the sync connection - the folder the old sweep fetched from
    await engine.syncFolder('INBOX')
    imap.log.length = 0

    await engine.pollOnce()

    expect(flagsOf(store, 'A').flagged).toBe(true)
    expect(flagsOf(store, 'INBOX').flagged).toBe(false)
    expect(imap.log).toContain('EXAMINE A')
    expect(imap.log).toContain('FETCH A')
  }, 30_000)

  it('skips a folder whose UIDVALIDITY changed since the last sync', async () => {
    const imap = await server({
      INBOX: folder(1, 2, [{ uid: 1, flags: [], source: source('inbox-1') }]),
      A: folder(2, 2, [{ uid: 1, flags: [], source: source('a-1') }])
    })
    const { engine, store } = engineFor(imap.port)
    await engine.syncAll()

    // rebuilt on the server: UID 1 is another message now
    const a = imap.folders.get('A')!
    a.uidValidity = 99
    a.messages[0].flags = ['\\Flagged']
    store.db.prepare('UPDATE folders SET last_flag_sweep = NULL').run()
    imap.log.length = 0

    await engine.pollOnce()

    expect(flagsOf(store, 'A').flagged).toBe(false)
    expect(imap.log).toContain('EXAMINE A')
    expect(imap.log).not.toContain('FETCH A')
  }, 30_000)
})

describe('I4 (MR-09): the file repair reads the folder of the row', () => {
  type Core = ReturnType<typeof createMailCore>
  const entriesOf = (core: Core): Map<string, AccountEntry> =>
    (core as unknown as { entries: Map<string, AccountEntry> }).entries

  function coreFor(port: number, ids: string[]): { core: Core; dataDir: string } {
    const dataDir = scratch()
    const core = createMailCore({
      dataDir,
      accounts: ids.map((id) => ({
        id,
        readOnly: false,
        email: `${id}@example.test`,
        host: '127.0.0.1',
        port,
        security: 'none' as const,
        credentials: async () => ({ user: `${id}@example.test`, pass: 'x' })
      }))
    })
    cleanups.push(() => core.close())
    return { core, dataDir }
  }

  /** Delete the file of the row in `imapPath`; returns the file's path */
  function dropFile(e: AccountEntry, imapPath: string): string {
    const row = e.store.db
      .prepare(
        'SELECT m.file_path p FROM messages m JOIN folders f ON f.id = m.folder_id WHERE f.imap_path = ?'
      )
      .get(imapPath) as { p: string }
    const file = e.store.filePath(row.p)
    fs.rmSync(file)
    return file
  }

  const fileOf = (e: AccountEntry, imapPath: string): string => {
    const row = e.store.db
      .prepare(
        'SELECT m.file_path p FROM messages m JOIN folders f ON f.id = m.folder_id WHERE f.imap_path = ?'
      )
      .get(imapPath) as { p: string }
    return fs.readFileSync(e.store.filePath(row.p), 'utf8')
  }

  it('restores the file from its own folder, read-only', async () => {
    const imap = await server({
      INBOX: folder(1, 2, [{ uid: 1, source: source('inbox-1') }]),
      A: folder(2, 2, [{ uid: 1, source: source('a-1') }])
    })
    const { core } = coreFor(imap.port, ['r1'])
    await core.triggerSync(true, 'r1')
    const e = entriesOf(core).get('r1')!
    dropFile(e, 'A')
    await e.engine.syncFolder('INBOX')
    imap.log.length = 0

    const result = await core.repairMissingFiles()

    expect(result).toEqual({ repaired: 1, left: 0 })
    expect(fileOf(e, 'A')).toBe(source('a-1'))
    expect(imap.log).toContain('EXAMINE A')
    expect(imap.log).not.toContain('SELECT A')
  }, 30_000)

  it('leaves the row alone when the folder UIDVALIDITY changed', async () => {
    const imap = await server({
      INBOX: folder(1, 2, [{ uid: 1, source: source('inbox-1') }]),
      A: folder(2, 2, [{ uid: 1, source: source('a-1') }])
    })
    const { core } = coreFor(imap.port, ['r1'])
    await core.triggerSync(true, 'r1')
    const e = entriesOf(core).get('r1')!
    const file = dropFile(e, 'A')
    imap.folders.get('A')!.uidValidity = 99
    imap.log.length = 0

    expect(await core.repairMissingFiles()).toEqual({ repaired: 0, left: 1 })
    expect(fs.existsSync(file)).toBe(false)
    expect(imap.log).not.toContain('FETCH A')
  }, 30_000)

  it('repairs every account, not only the first', async () => {
    const imap = await server({ INBOX: folder(1, 2, [{ uid: 1, source: source('inbox-1') }]) })
    const { core } = coreFor(imap.port, ['r1', 'r2'])
    await core.triggerSync(true, 'r1')
    await core.triggerSync(true, 'r2')
    for (const e of entriesOf(core).values()) dropFile(e, 'INBOX')

    expect(await core.repairMissingFiles()).toEqual({ repaired: 2, left: 0 })
    for (const e of entriesOf(core).values()) expect(fileOf(e, 'INBOX')).toBe(source('inbox-1'))
  }, 30_000)

  it('stops at a full disk and does not contact the server again (MR-25)', async () => {
    const imap = await server({
      INBOX: folder(1, 2, [{ uid: 1, source: source('inbox-1') }]),
      A: folder(2, 2, [{ uid: 1, source: source('a-1') }])
    })
    const { core } = coreFor(imap.port, ['r1'])
    await core.triggerSync(true, 'r1')
    const e = entriesOf(core).get('r1')!
    dropFile(e, 'INBOX')
    dropFile(e, 'A')
    writeFault.code = 'ENOSPC'
    imap.log.length = 0

    // the first folder fails to write; the second is not even fetched
    expect(await core.repairMissingFiles()).toEqual({ repaired: 0, left: 2 })
    expect(e.engine.isDiskFull).toBe(true)
    expect(imap.log.filter((l) => l.startsWith('FETCH'))).toHaveLength(1)

    // the next round sees the full disk before it connects
    imap.log.length = 0
    expect(await core.repairMissingFiles()).toEqual({ repaired: 0, left: 2 })
    expect(imap.log).toEqual([])
  }, 30_000)

  it('the maintenance gate reports a timeout instead of resolving as idle (MR-10)', async () => {
    const { core } = coreFor(1, ['r1'])
    const engine = entriesOf(core).get('r1')!.engine
    vi.spyOn(engine, 'isSyncing').mockReturnValue(true)
    vi.spyOn(engine, 'getStatus').mockReturnValue({ ...engine.getStatus(), phase: 'initial' })
    expect(await core.whenIdleForMaintenance(10)).toBe(false)
    vi.restoreAllMocks()
    expect(await core.whenIdleForMaintenance(10)).toBe(true)
  }, 30_000)
})

describe('I4: UIDNEXT is the server value', () => {
  const uidNextOf = (store: Store, imapPath: string): number | null =>
    store.getFolderByPath(imapPath)!.uid_next

  it('is stored from SELECT on a full and on an incremental sync', async () => {
    // the newest messages (UID 3..9) were expunged: max+1 would say 3
    const imap = await server({
      INBOX: folder(1, 10, [
        { uid: 1, source: source('i1') },
        { uid: 2, source: source('i2') }
      ])
    })
    const { engine, store } = engineFor(imap.port)
    await engine.syncAll()
    expect(uidNextOf(store, 'INBOX')).toBe(10)

    // incremental: the folder has a modseq, and the server's UIDNEXT moved on
    store.db.prepare("UPDATE folders SET highest_modseq = '5' WHERE imap_path = 'INBOX'").run()
    imap.folders.get('INBOX')!.uidNext = 12
    await engine.syncFolder('INBOX')
    expect(uidNextOf(store, 'INBOX')).toBe(12)
  }, 30_000)
})

describe('I4: a full disk stops every path that downloads', () => {
  it('poll, syncFolder, syncAll and IDLE make no further server contact', async () => {
    const imap = await server({ INBOX: folder(1, 2, [{ uid: 1, source: source('d1') }]) })
    const { engine } = engineFor(imap.port, { faultWriteCode: 'ENOSPC' })
    await engine.syncAll()
    expect(engine.isDiskFull).toBe(true)
    expect(engine.getStatus().phase).toBe('disk-full')

    const connections = imap.connections()
    imap.log.length = 0
    expect(await engine.pollOnce()).toBe(false)
    await expect(engine.syncFolder('INBOX')).rejects.toMatchObject({ code: 'ENOSPC' })
    await engine.syncAll()
    void engine.startIdle('INBOX')
    await new Promise((r) => setTimeout(r, 1500))
    engine.stopIdle()

    expect(imap.log).toEqual([])
    expect(imap.connections()).toBe(connections)
  }, 30_000)
})

describe('I4 (MR-31): a folder rename and the sync', () => {
  it('the sync leaves the subtree of a pending rename to the rename op', async () => {
    const imap = await server({
      INBOX: folder(1, 2, [{ uid: 1, source: source('n1') }]),
      A: folder(2, 2, [{ uid: 1, source: source('a1') }])
    })
    const { engine, store } = engineFor(imap.port)
    await engine.syncAll()

    // the server RENAME went through, the re-key did not run yet
    imap.folders.set('Z', imap.folders.get('A')!)
    imap.folders.delete('A')
    store.journalEnqueue({
      accountId: 'i4',
      kind: 'folder_rename',
      folderPath: 'A',
      payload: { from: 'A', to: 'Z', delimiter: '/' }
    })
    imap.log.length = 0

    await engine.syncAll()
    await engine.syncFolder('A')
    await engine.syncFolder('Z')

    expect(store.getFolderByPath('Z')).toBeFalsy()
    expect(store.getFolderByPath('A')!.list_absent_since).toBeNull()
    expect(imap.log.filter((l) => /^(SELECT|EXAMINE) (A|Z)$/.test(l))).toEqual([])
  }, 30_000)

  it('the write engine holds the mutex of every folder in both subtrees', async () => {
    const dir = scratch()
    const store = new Store(dir, 'i4')
    cleanups.push(() => store.close())
    for (const p of ['A', 'A/B', 'A/B/C', 'AB', 'X'])
      store.upsertFolder({ imapPath: p, delimiter: '/' })
    const writes = new WriteEngine(store, 'i4', {
      writeAccount: sandboxWriteAccount(),
      credentials: sandboxCredentials
    })
    cleanups.push(() => writes.close())

    const held = new Set<string>()
    let heldDuringOp: string[] = []
    writes.attachEngine({
      withFolderMutex: async (p, fn) => {
        held.add(p)
        try {
          // like the sync engine's mutex: the op's result passes through
          return await fn()
        } finally {
          held.delete(p)
        }
      },
      triggerResync: () => undefined
    })
    // the op body itself never reaches a server here
    vi.spyOn(
      writes as unknown as { executeOne: () => Promise<unknown> },
      'executeOne'
    ).mockImplementation(async () => {
      heldDuringOp = [...held].sort()
      return { outcome: 'done' }
    })
    const id = store.journalEnqueue({
      accountId: 'i4',
      kind: 'folder_rename',
      folderPath: 'A',
      payload: { from: 'A', to: 'Z', delimiter: '/' }
    })

    const result = await writes.execute(store.journalGet(id)!)

    expect(result).toEqual({ outcome: 'done' })
    expect(heldDuringOp).toEqual(['A', 'A/B', 'A/B/C', 'Z'])
    vi.restoreAllMocks()
  }, 30_000)
})

describe('I4 (MR-31): the re-key merges into a target row that exists already', () => {
  function addRow(store: Store, folderId: string, uid: number, key: string): number {
    return store.insertMessage({
      account_id: 'i4',
      folder_id: folderId,
      uid,
      message_key: key,
      file_path: `${key}.eml`,
      message_id: `<${key}@example.test>`,
      in_reply_to: null,
      references_json: '[]',
      thread_id: null,
      date: '2026-01-01T09:00:00.000Z',
      internal_date: '2026-01-01T09:00:00.000Z',
      subject: key,
      from_name: '',
      from_email: 'a@example.test',
      to_json: '[]',
      cc_json: '[]',
      bcc_json: '[]',
      flags_json: '{"seen":false,"flagged":false,"draft":false,"deleted":false,"answered":false}',
      modseq: null,
      has_attachments: 0,
      attachments_json: '[]',
      size_bytes: 10,
      snippet: key,
      parsed_ok: 1,
      parse_error: null,
      body_text: key,
      body_html: null
    })
  }

  function setup(): { store: Store; moved: number; copy: number } {
    const store = new Store(scratch(), 'i4')
    cleanups.push(() => store.close())
    const a = store.upsertFolder({ imapPath: 'A', delimiter: '/', uidValidity: '7' })
    // a LIST after the server RENAME created the target, and a sync filled it
    const z = store.upsertFolder({ imapPath: 'Z', delimiter: '/', uidValidity: '7' })
    return {
      store,
      moved: addRow(store, a.id, 1, 'moved-1'),
      copy: addRow(store, z.id, 1, 'copy-1')
    }
  }

  const rowsIn = (store: Store, imapPath: string): number[] =>
    (
      store.db
        .prepare(
          'SELECT m.id FROM messages m JOIN folders f ON f.id = m.folder_id WHERE f.imap_path = ?'
        )
        .all(imapPath) as { id: number }[]
    ).map((r) => r.id)

  it('keeps the moved rows when the UIDs stay valid', () => {
    const { store, moved } = setup()
    store.rekeyFolder('A', 'Z', true)
    expect(store.getFolderByPath('A')).toBeFalsy()
    expect(rowsIn(store, 'Z')).toEqual([moved])
  })

  it('keeps the target as the server view when the UIDs do not', () => {
    const { store, copy } = setup()
    store.rekeyFolder('A', 'Z', false)
    expect(store.getFolderByPath('A')).toBeFalsy()
    expect(rowsIn(store, 'Z')).toEqual([copy])
  })
})
