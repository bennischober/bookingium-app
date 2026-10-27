// I12: store robustness beyond a corrupt first page (MR-26, MR-41, MR-42).
//
// Measured on better-sqlite3 13: a damaged data page OPENS FINE, and only the first query that
// reads it throws SQLITE_CORRUPT. So the store checks itself at open after an unclean shutdown
// (a -wal left behind) or once a query has hit corruption (a `.check` marker), and a rebuild
// adopts the .eml files that are still on disk instead of downloading the mailbox again.
//
// The sync half: an empty or truncated `UID FETCH 1:*` looks exactly like a mass expunge, so a
// large one needs EXAMINE's EXISTS to agree; a UIDVALIDITY swap resumes instead of starting over,
// and its staged rows stay out of every view until they are swapped in.
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { STAGING_PREFIX, Store } from '../src/main/mailclient/core/store'
import { SyncEngine, type AccountConfig } from '../src/main/mailclient/core/sync'
import { createMailCore } from '../src/main/mailclient/core/index'
import {
  CHECK_MARKER,
  isCorruptStoreError,
  salvageRelinks
} from '../src/main/mailclient/core/store_recovery'

const ACCOUNT = 'acc'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) {
    const fn = cleanups.pop()!
    try {
      fn()
    } catch {
      /* best effort */
    }
  }
})

function scratchDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-store-integrity-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function openStore(dir: string, warnings: string[] = []): Store {
  const store = new Store(dir, ACCOUNT, Date.now, { warn: (m) => warnings.push(m) })
  cleanups.push(() => store.close())
  return store
}

const quarantined = (dir: string): string[] =>
  fs.readdirSync(dir).filter((f) => /\.corrupt-[^.]*$/.test(f) || /\.corrupt-.*Z$/.test(f))

function source(uid: number): Buffer {
  return Buffer.from(
    `From: Absender <absender@example.test>\r\nTo: empfang@example.test\r\n` +
      `Subject: mail ${uid}\r\nMessage-ID: <${uid}@example.test>\r\n` +
      `Date: Thu, 01 Jan 2026 09:00:00 +0000\r\n\r\nbody ${uid} ${'x'.repeat(200)}\r\n`
  )
}

/** One stored message with its .eml file, the way the sync engine writes it */
function addMessage(
  store: Store,
  dir: string,
  folderId: string,
  uid: number,
  validity = '7'
): string {
  const file = `m-${folderId}-${uid}.eml`
  const body = source(uid)
  fs.writeFileSync(path.join(dir, file), body)
  store.insertMessage({
    account_id: ACCOUNT,
    folder_id: folderId,
    uid,
    message_key: store.messageKey(ACCOUNT, folderId, validity, uid),
    file_path: file,
    message_id: `<${uid}@example.test>`,
    in_reply_to: null,
    references_json: '[]',
    thread_id: `t-${uid}`,
    date: '2026-01-01T09:00:00.000Z',
    internal_date: '2026-01-01T09:00:00.000Z',
    subject: `mail ${uid}`,
    from_name: 'Absender',
    from_email: 'absender@example.test',
    to_json: '[]',
    cc_json: '[]',
    bcc_json: '[]',
    flags_json: '{"seen":false,"flagged":false,"draft":false,"deleted":false,"answered":false}',
    modseq: null,
    has_attachments: 0,
    attachments_json: '[]',
    size_bytes: body.length,
    snippet: `mail ${uid}`,
    parsed_ok: 1,
    parse_error: null,
    body_text: `body ${uid} ${'x'.repeat(400)}`,
    body_html: null
  })
  return file
}

/** A closed store file with `count` messages in INBOX (UIDVALIDITY 7). */
function seedStore(dir: string, count: number): string {
  const store = new Store(dir, ACCOUNT)
  const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '7' })
  for (let uid = 1; uid <= count; uid++) addMessage(store, dir, inbox.id, uid)
  store.close()
  return path.join(dir, `${ACCOUNT}.db`)
}

/** Overwrite one leaf page of `table` (found through dbstat), leaving page 1 and the schema intact. */
function damagePage(dbPath: string, table: string): void {
  const db = new Database(dbPath)
  const pageSize = db.pragma('page_size', { simple: true }) as number
  const row = db
    .prepare(
      `SELECT pageno FROM dbstat WHERE name = ? AND pagetype = 'leaf' ORDER BY pageno LIMIT 1`
    )
    .get(table) as { pageno: number }
  db.close()
  const buf = fs.readFileSync(dbPath)
  buf.fill(0xff, (row.pageno - 1) * pageSize, row.pageno * pageSize)
  fs.writeFileSync(dbPath, buf)
}

describe('I12: what counts as corruption', () => {
  it('matches the extended codes and a code wrapped in a cause chain', () => {
    for (const code of [
      'SQLITE_CORRUPT_VTAB',
      'SQLITE_CORRUPT_INDEX',
      'SQLITE_CORRUPT_SEQUENCE',
      'SQLITE_IOERR_SHORT_READ'
    ]) {
      expect(isCorruptStoreError(Object.assign(new Error(code), { code }))).toBe(true)
    }
    // runMigrations wraps the driver's error; the code sits on the cause
    const wrapped = new Error('migration 3 failed', {
      cause: new Error('outer', {
        cause: Object.assign(new Error('x'), { code: 'SQLITE_CORRUPT' })
      })
    })
    expect(isCorruptStoreError(wrapped)).toBe(true)
    // transient failures still never count
    for (const code of ['SQLITE_IOERR', 'SQLITE_IOERR_WRITE', 'SQLITE_BUSY', 'SQLITE_CANTOPEN']) {
      expect(
        isCorruptStoreError(new Error('x', { cause: Object.assign(new Error(code), { code }) }))
      ).toBe(false)
    }
  })
})

describe('I12: damage that opening does not see (MR-26)', () => {
  it('a clean start does not check; a query that hits the damage marks the store, and the next start sets it aside', () => {
    const dir = scratchDir()
    const dbPath = seedStore(dir, 40)
    damagePage(dbPath, 'messages')

    // no -wal, no marker: the open does not read the damaged page, so it succeeds as before
    const warnings: string[] = []
    const store = new Store(dir, ACCOUNT, Date.now, { warn: (m) => warnings.push(m) })
    expect(quarantined(dir)).toEqual([])
    expect(fs.existsSync(`${dbPath}${CHECK_MARKER}`)).toBe(false)

    // the first query over the page fails with the driver's own error, unchanged...
    let error: unknown
    try {
      store.db.prepare('SELECT * FROM messages').all()
    } catch (e) {
      error = e
    }
    expect((error as { code?: string }).code).toMatch(/^SQLITE_CORRUPT/)
    // ...and it left the marker and said so once, however often it is hit
    expect(() => store.db.prepare('SELECT * FROM messages').all()).toThrow()
    expect(fs.existsSync(`${dbPath}${CHECK_MARKER}`)).toBe(true)
    expect(warnings.filter((w) => w.includes('hit corruption'))).toHaveLength(1)
    store.close()

    // next start: the marker makes the open check the file, and the check sets it aside
    const reopened = openStore(dir)
    expect(quarantined(dir)).toHaveLength(1)
    expect(fs.existsSync(`${dbPath}${CHECK_MARKER}`)).toBe(false)
    expect(reopened.db.prepare('SELECT COUNT(*) c FROM messages').get()).toEqual({ c: 0 })
  })

  it('checks the file after an unclean shutdown (a -wal left behind)', () => {
    const dir = scratchDir()
    const dbPath = seedStore(dir, 40)
    damagePage(dbPath, 'messages')
    fs.writeFileSync(`${dbPath}-wal`, '')

    openStore(dir)
    expect(quarantined(dir)).toHaveLength(1)
  })

  it('clears the marker once the check passes, so the next start is a normal one', () => {
    const dir = scratchDir()
    const dbPath = seedStore(dir, 3)
    fs.writeFileSync(`${dbPath}${CHECK_MARKER}`, '')

    const store = openStore(dir)
    expect(quarantined(dir)).toEqual([])
    expect(fs.existsSync(`${dbPath}${CHECK_MARKER}`)).toBe(false)
    expect(store.db.prepare('SELECT COUNT(*) c FROM messages').get()).toEqual({ c: 3 })
  })
})

describe('I12: a rebuild re-links the files that survived (MR-26)', () => {
  it('keeps every intact entry whose file has the recorded size, and nothing else', () => {
    const dir = scratchDir()
    const dbPath = seedStore(dir, 5)
    // file gone, file of another size, and a path that is not a bare file name
    fs.rmSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('-2.eml'))!))
    fs.appendFileSync(
      path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('-3.eml'))!),
      'more'
    )
    // a file that exists with the right size, but not as a bare name in the account dir
    const fourth = fs.readdirSync(dir).find((f) => f.endsWith('-4.eml'))!
    fs.mkdirSync(path.join(dir, 'sub'))
    fs.renameSync(path.join(dir, fourth), path.join(dir, 'sub', fourth))
    const db = new Database(dbPath)
    db.prepare(`UPDATE messages SET file_path = ? WHERE uid = 4`).run(`sub/${fourth}`)
    db.close()
    // damage elsewhere: the bodies, which the file map does not need
    damagePage(dbPath, 'message_bodies')
    fs.writeFileSync(`${dbPath}${CHECK_MARKER}`, '')

    const warnings: string[] = []
    const store = openStore(dir, warnings)
    expect(quarantined(dir)).toHaveLength(1)
    const links = store.relinksFor('INBOX', '7')
    expect([...links.keys()].sort()).toEqual([1, 5])
    expect(links.get(1)!.filePath).toMatch(/-1\.eml$/)
    expect(warnings.some((w) => w.includes('2 message file(s) kept for re-linking'))).toBe(true)
    // another UIDVALIDITY is another set of messages
    expect(store.relinksFor('INBOX', '8').size).toBe(0)
  })

  it('reads nothing out of a file that is no database, and leaves no sidecars behind', () => {
    const dir = scratchDir()
    const garbage = path.join(dir, 'acc.db.corrupt-x')
    fs.writeFileSync(garbage, Buffer.from('not a sqlite database at all, just some padding text'))
    expect(salvageRelinks(garbage, dir)).toEqual([])
    expect(fs.readdirSync(dir)).toEqual(['acc.db.corrupt-x'])
  })
})

// ----- the sync engine against a scripted server -------------------------------------------

type ServerOpts = { exists?: number; failAfter?: number; sizeOf?: (uid: number) => number }

function uidsIn(range: string, all: number[]): number[] {
  const sorted = [...all].sort((a, b) => a - b)
  if (range === '1:*') return sorted
  const want = new Set<number>()
  for (const part of range.split(',')) {
    const [a, b] = part.split(':').map(Number)
    for (let u = a; u <= (b ?? a); u++) want.add(u)
  }
  return sorted.filter((u) => want.has(u))
}

/** A client whose mailbox holds `uids`; it counts which UIDs had their source fetched. */
function fakeClient(uids: number[], opts: ServerOpts = {}) {
  const sourceFetched: number[] = []
  const client = {
    mailbox: opts.exists === undefined ? false : { exists: opts.exists },
    async *fetch(range: string, query: { source?: boolean }) {
      for (const uid of uidsIn(range, uids)) {
        if (query.source) {
          if (opts.failAfter !== undefined && sourceFetched.length >= opts.failAfter) {
            throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
          }
          sourceFetched.push(uid)
        }
        yield {
          uid,
          flags: new Set<string>(['\\Seen']),
          internalDate: new Date('2026-01-01T09:00:00Z'),
          size: opts.sizeOf?.(uid) ?? source(uid).length,
          ...(query.source ? { source: source(uid) } : {})
        }
      }
    }
  }
  return { client, sourceFetched }
}

type Client = ReturnType<typeof fakeClient>['client']
type Internals = {
  downloadMessages(
    client: Client,
    uids: number[],
    imapPath: string,
    folderId: string,
    uidValidity: string
  ): Promise<number>
  fullSyncFolder(
    client: Client,
    imapPath: string,
    uidValidity: string,
    highestModseq: string | null
  ): Promise<void>
  incrementalSyncFolder(
    client: Client,
    imapPath: string,
    uidValidity: string,
    changedSince: bigint,
    highestModseq: string | null
  ): Promise<void>
  resyncAfterValidityChange(
    client: Client,
    imapPath: string,
    folderId: string,
    uidValidity: string,
    highestModseq: string | null,
    uidNext?: number
  ): Promise<void>
  storeMessage(
    folderId: string,
    uidValidity: string,
    msg: { uid: number; source: Buffer }
  ): Promise<void>
  syncFolderList(): Promise<string[]>
  connect: () => Promise<unknown>
}

function engineFor(store: Store, dir: string, warnings: string[] = []): Internals {
  const config: AccountConfig = {
    id: ACCOUNT,
    host: '127.0.0.1',
    port: 10199,
    security: 'none',
    user: 'u',
    pass: 'p',
    readOnly: false,
    dataDir: dir
  }
  return new SyncEngine(config, store, {
    log: { warn: (m) => warnings.push(m) }
  }) as unknown as Internals
}

const uidsOf = (store: Store, folderId: string): number[] =>
  (
    store.db.prepare('SELECT uid FROM messages WHERE folder_id = ? ORDER BY uid').all(folderId) as {
      uid: number
    }[]
  ).map((r) => r.uid)

describe('I12: re-linked files are adopted, not downloaded (MR-26)', () => {
  it('stores a re-linked UID from its file and fetches the source only for the rest', async () => {
    const dir = scratchDir()
    const dbPath = seedStore(dir, 4)
    damagePage(dbPath, 'message_bodies')
    fs.writeFileSync(`${dbPath}${CHECK_MARKER}`, '')
    const store = openStore(dir)
    const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '7' })
    const before = store.relinksFor('INBOX', '7')
    expect(before.size).toBe(4)

    // the server reports another size for UID 2: that one is downloaded after all
    const { client, sourceFetched } = fakeClient([1, 2, 3, 4, 5], {
      sizeOf: (uid) => (uid === 2 ? 1 : source(uid).length)
    })
    const stored = await engineFor(store, dir).downloadMessages(
      client,
      [1, 2, 3, 4, 5],
      'INBOX',
      inbox.id,
      '7'
    )

    expect(stored).toBe(5)
    expect(sourceFetched).toEqual([2, 5])
    expect(uidsOf(store, inbox.id)).toEqual([1, 2, 3, 4, 5])
    const row = store.getByKey(store.messageKey(ACCOUNT, inbox.id, '7', 3))!
    expect(row.file_path).toBe(before.get(3)!.filePath)
    expect(JSON.parse(row.flags_json).seen).toBe(true)
    // adopted entries are done; the refused one stays until the TTL takes it
    expect([...store.relinksFor('INBOX', '7').keys()]).toEqual([2])
  })

  it('the orphan sweep leaves a re-linked file alone until the entry expires', () => {
    const dir = scratchDir()
    const accountDir = path.join(dir, ACCOUNT)
    fs.mkdirSync(accountDir, { recursive: true })
    const dbPath = seedStore(accountDir, 2)
    damagePage(dbPath, 'message_bodies')
    fs.writeFileSync(`${dbPath}${CHECK_MARKER}`, '')
    const old = new Date(Date.now() - 60 * 60 * 1000)
    for (const f of fs.readdirSync(accountDir))
      if (f.endsWith('.eml')) fs.utimesSync(path.join(accountDir, f), old, old)

    let now = Date.now()
    const api = createMailCore({
      dataDir: dir,
      clock: () => now,
      accounts: [
        {
          id: ACCOUNT,
          kind: 'sandbox',
          host: '127.0.0.1',
          port: 10199,
          security: 'none',
          user: 'u',
          pass: 'p'
        }
      ]
    } as Parameters<typeof createMailCore>[0])
    try {
      expect(quarantined(accountDir)).toHaveLength(1)
      expect(api.sweepOrphans()).toBe(0)
      // eight days later the entries have expired and the files are ordinary orphans
      now += 8 * 24 * 60 * 60 * 1000
      expect(api.sweepOrphans()).toBe(2)
    } finally {
      api.close()
    }
  }, 30_000)
})

describe('I12: one account that cannot be opened is skipped (MR-26)', () => {
  const account = (id: string) => ({
    id,
    kind: 'sandbox' as const,
    host: '127.0.0.1',
    port: 10199,
    security: 'none' as const,
    user: 'u',
    pass: 'p'
  })

  it('loads the other accounts and makes the first loaded one active', async () => {
    const dir = scratchDir()
    // a directory where the store file belongs: SQLITE_CANTOPEN, not corruption
    fs.mkdirSync(path.join(dir, 'bad', 'bad.db'), { recursive: true })
    const warnings: string[] = []
    const api = createMailCore({
      dataDir: dir,
      log: { warn: (m: string) => warnings.push(m) },
      accounts: [account('bad'), account('good')]
    } as Parameters<typeof createMailCore>[0])
    try {
      const accounts = await api.listAccounts()
      expect(accounts.map((a) => [a.id, a.active])).toEqual([['good', true]])
      expect(warnings.some((w) => w.startsWith('mail account bad could not be opened'))).toBe(true)
    } finally {
      api.close()
    }
  }, 30_000)

  it('throws when no account loads, and releases the data dir', () => {
    const dir = scratchDir()
    fs.mkdirSync(path.join(dir, 'bad', 'bad.db'), { recursive: true })
    const options = { dataDir: dir, accounts: [account('bad')] } as Parameters<
      typeof createMailCore
    >[0]
    expect(() => createMailCore(options)).toThrow(/no mail account could be opened/)
    // the lock went with it: a good account in the same data dir opens now
    const api = createMailCore({ dataDir: dir, accounts: [account('good')] } as Parameters<
      typeof createMailCore
    >[0])
    api.close()
  }, 30_000)

  it('rebuilds a store whose damage the contacts backfill finds, instead of dropping the account', async () => {
    const dir = scratchDir()
    const accountDir = path.join(dir, ACCOUNT)
    fs.mkdirSync(accountDir, { recursive: true })
    damagePage(seedStore(accountDir, 40), 'messages')

    const api = createMailCore({ dataDir: dir, accounts: [account(ACCOUNT)] } as Parameters<
      typeof createMailCore
    >[0])
    try {
      expect((await api.listAccounts()).map((a) => a.id)).toEqual([ACCOUNT])
      expect(quarantined(accountDir)).toHaveLength(1)
    } finally {
      api.close()
    }
  }, 30_000)
})

describe('I12: a mass expunge needs EXISTS to agree (MR-41)', () => {
  function seeded(count: number) {
    const dir = scratchDir()
    const store = openStore(dir)
    const inbox = store.upsertFolder({
      imapPath: 'INBOX',
      delimiter: '/',
      uidValidity: '7',
      highestModseq: '1'
    })
    for (let uid = 1; uid <= count; uid++) addMessage(store, dir, inbox.id, uid)
    return { dir, store, inbox }
  }
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i)

  for (const mode of ['full', 'incremental'] as const) {
    const run = (engine: Internals, client: Client) =>
      mode === 'full'
        ? engine.fullSyncFolder(client, 'INBOX', '7', null)
        : engine.incrementalSyncFolder(client, 'INBOX', '7', 1n, null)

    it(`${mode}: a short UID list that EXISTS contradicts deletes nothing`, async () => {
      const { dir, store, inbox } = seeded(30)
      const warnings: string[] = []
      await run(engineFor(store, dir, warnings), fakeClient(range(1, 5), { exists: 30 }).client)
      expect(uidsOf(store, inbox.id)).toHaveLength(30)
      expect(warnings.some((w) => w.includes('not removing 25 of 30'))).toBe(true)
      // and without any EXISTS there is nothing to confirm it either
      await run(engineFor(store, dir), fakeClient(range(1, 5)).client)
      expect(uidsOf(store, inbox.id)).toHaveLength(30)
    })

    it(`${mode}: the same expunge goes through when EXISTS confirms it`, async () => {
      const { dir, store, inbox } = seeded(30)
      await run(engineFor(store, dir), fakeClient(range(1, 5), { exists: 5 }).client)
      expect(uidsOf(store, inbox.id)).toEqual(range(1, 5))
    })

    it(`${mode}: a small expunge needs no confirmation`, async () => {
      const { dir, store, inbox } = seeded(30)
      // 19 of 30 is above the share but below the count; 5 of 30 is below both
      await run(engineFor(store, dir), fakeClient(range(1, 11)).client)
      expect(uidsOf(store, inbox.id)).toEqual(range(1, 11))
      const big = seeded(200)
      await run(engineFor(big.store, big.dir), fakeClient(range(1, 160)).client)
      expect(uidsOf(big.store, big.inbox.id)).toHaveLength(160)
    })
  }
})

describe('I12: the UIDVALIDITY swap resumes and stays hidden until it is done (MR-41)', () => {
  function seededSwap() {
    const dir = scratchDir()
    const store = openStore(dir)
    const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
    const oldFiles = [1, 2, 3].map((uid) => addMessage(store, dir, inbox.id, uid, '1'))
    return { dir, store, inbox, oldFiles }
  }
  const staging = (store: Store) => store.getFolderByPath(`${STAGING_PREFIX}INBOX`)

  it('keeps what was staged when the download breaks, hides it, and fetches only the rest next time', async () => {
    const { dir, store, inbox, oldFiles } = seededSwap()
    const server = [10, 11, 12]

    const broken = fakeClient(server, { exists: 3, failAfter: 1 })
    await expect(
      engineFor(store, dir).resyncAfterValidityChange(
        broken.client,
        'INBOX',
        inbox.id,
        '2',
        null,
        13
      )
    ).rejects.toThrow('connection reset')
    const staged = staging(store)!
    // one message made it before the connection broke
    const first = uidsOf(store, staged.id)
    expect(first).toHaveLength(1)
    // the real folder is untouched, and nothing that spans folders shows the staged row
    expect(uidsOf(store, inbox.id)).toEqual([1, 2, 3])
    expect(store.search({ matchExpr: null, limit: 50, offset: 0 }).total).toBe(3)
    expect(store.listThreads(null, 0, 50)).toHaveLength(3)
    expect(store.searchFacets({ matchExpr: null }).map((f) => f.folderId)).toEqual([inbox.id])

    const second = fakeClient(server, { exists: 3 })
    await engineFor(store, dir).resyncAfterValidityChange(
      second.client,
      'INBOX',
      inbox.id,
      '2',
      null,
      13
    )
    expect(second.sourceFetched.sort()).toEqual(server.filter((u) => !first.includes(u)))
    expect(uidsOf(store, inbox.id)).toEqual(server)
    expect(staging(store)).toBeUndefined()
    // keyed by the REAL folder, so the next sync recognises every row
    for (const uid of server)
      expect(store.getByKey(store.messageKey(ACCOUNT, inbox.id, '2', uid))).toBeTruthy()
    for (const f of oldFiles) expect(fs.existsSync(path.join(dir, f))).toBe(false)
  })

  it('does not swap while EXISTS says the new UID list is short', async () => {
    const { dir, store, inbox } = seededSwap()
    // 25 old rows make the swap a mass removal
    for (let uid = 4; uid <= 25; uid++) addMessage(store, dir, inbox.id, uid, '1')
    const { client } = fakeClient([10, 11, 12], { exists: 40 })
    await engineFor(store, dir).resyncAfterValidityChange(client, 'INBOX', inbox.id, '2', null, 13)
    expect(uidsOf(store, inbox.id)).toHaveLength(25)
    expect(store.getFolderByPath('INBOX')!.uid_validity).toBe('1')
    expect(uidsOf(store, staging(store)!.id)).toEqual([10, 11, 12])
  })

  it('drops staging of an older UIDVALIDITY before it starts, and staged rows the server expunged since', async () => {
    const { dir, store, inbox } = seededSwap()
    const stale = store.upsertFolder({
      imapPath: `${STAGING_PREFIX}INBOX`,
      delimiter: '/',
      uidValidity: '9'
    })
    const staleFile = addMessage(store, dir, stale.id, 10, '9')

    // first pass under validity 2 stages 10 and 11, then breaks
    await expect(
      engineFor(store, dir).resyncAfterValidityChange(
        fakeClient([10, 11, 12], { exists: 3, failAfter: 2 }).client,
        'INBOX',
        inbox.id,
        '2',
        null,
        13
      )
    ).rejects.toThrow()
    expect(fs.existsSync(path.join(dir, staleFile))).toBe(false)
    // 10 and 11 were staged, 12 was not; then 11 is expunged on the server
    const stagedId = staging(store)!.id
    expect(uidsOf(store, stagedId)).toEqual([10, 11])
    const gone = store.getByKey(store.messageKey(ACCOUNT, inbox.id, '2', 11))!.file_path
    const second = fakeClient([10, 12], { exists: 2 })
    await engineFor(store, dir).resyncAfterValidityChange(
      second.client,
      'INBOX',
      inbox.id,
      '2',
      null,
      13
    )
    expect(second.sourceFetched).toEqual([12])
    expect(uidsOf(store, inbox.id)).toEqual([10, 12])
    expect(fs.existsSync(path.join(dir, gone))).toBe(false)
  })

  it('drops staging once its real folder has been pruned', async () => {
    const dir = scratchDir()
    const store = openStore(dir)
    store.upsertFolder({ imapPath: 'INBOX', delimiter: '/' })
    const orphanStaging = store.upsertFolder({
      imapPath: `${STAGING_PREFIX}Weg`,
      delimiter: '/',
      uidValidity: '2'
    })
    addMessage(store, dir, orphanStaging.id, 1, '2')
    const kept = store.upsertFolder({
      imapPath: `${STAGING_PREFIX}INBOX`,
      delimiter: '/',
      uidValidity: '2'
    })

    const engine = engineFor(store, dir)
    engine.connect = async () => ({
      list: async () => [{ path: 'INBOX', delimiter: '/', specialUse: '\\Inbox', flags: new Set() }]
    })
    await engine.syncFolderList()
    expect(store.getFolderByPath(`${STAGING_PREFIX}Weg`)).toBeUndefined()
    expect(store.getFolderByPath(`${STAGING_PREFIX}INBOX`)?.id).toBe(kept.id)
  })

  it('getFolders does not list a staging folder', async () => {
    const dir = scratchDir()
    const accountDir = path.join(dir, ACCOUNT)
    fs.mkdirSync(accountDir, { recursive: true })
    const seed = new Store(accountDir, ACCOUNT)
    seed.upsertFolder({ imapPath: 'INBOX', delimiter: '/' })
    seed.upsertFolder({ imapPath: `${STAGING_PREFIX}INBOX`, delimiter: '/', uidValidity: '2' })
    seed.close()
    const api = createMailCore({
      dataDir: dir,
      accounts: [
        {
          id: ACCOUNT,
          kind: 'sandbox',
          host: '127.0.0.1',
          port: 10199,
          security: 'none',
          user: 'u',
          pass: 'p'
        }
      ]
    } as Parameters<typeof createMailCore>[0])
    try {
      const folders = await api.getFolders(ACCOUNT)
      expect(folders.map((f) => f.path)).toEqual(['INBOX'])
    } finally {
      api.close()
    }
  }, 30_000)
})

describe('I12: a failed contacts upsert keeps the stored mail (MR-42)', () => {
  it('leaves the row and its file in place and only warns', async () => {
    const dir = scratchDir()
    const store = openStore(dir)
    const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '7' })
    store.rememberContactsOf = () => {
      throw new Error('contacts table locked')
    }
    const warnings: string[] = []
    await engineFor(store, dir, warnings).storeMessage(inbox.id, '7', { uid: 1, source: source(1) })

    const row = store.getByKey(store.messageKey(ACCOUNT, inbox.id, '7', 1))!
    expect(row).toBeTruthy()
    expect(fs.existsSync(store.filePath(row.file_path))).toBe(true)
    expect(warnings).toEqual(['contacts upsert failed: contacts table locked'])
  })
})
