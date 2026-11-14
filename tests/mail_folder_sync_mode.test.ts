// #158: the per-folder sync setting. A folder syncs 'always' or only 'on_open'. A new folder's
// mode is seeded from the server's subscriptions (a safeguard keeps everything 'always' when no
// ordinary folder is subscribed); after that it is the user's local choice. An 'on_open' folder
// is left out of the first download, the deep check's syncs and the change pass, but still asked
// for STATUS, so the tree can show its counts. Opening it syncs it, switching it to 'always'
// downloads it.
//
// Every server here is tests/helpers/scriptedImap.ts on 127.0.0.1; the messages are synthetic.
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMailCore, type AccountEntry } from '../src/main/mailclient/core/index'
import { MIGRATIONS, runMigrations } from '../src/main/mailclient/core/migrations'
import { Store } from '../src/main/mailclient/core/store'
import { makeSandboxAccount, seedSyncModes, SyncEngine } from '../src/main/mailclient/core/sync'
import type { FolderNode } from '../src/main/mailclient/core/types'
import { notDownloadedNote } from '@/components/mail/format'
import { syncModeRows } from '@/components/settings/mailFolderSync'
import { connectionTestMessage } from '@/lib/mailConnection'
import { scriptedImap, type FakeFolder, type ScriptedImap } from './helpers/scriptedImap'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

const scratch = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-158-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const source = (tag: string): string =>
  `Message-ID: <${tag}@example.test>\r\nFrom: a@example.test\r\nTo: b@example.test\r\n` +
  `Subject: synthetic\r\nDate: Thu, 01 Jan 2026 09:00:00 +0000\r\n\r\nbody ${tag}\r\n`

const folder = (uidValidity: number, tag: string, subscribed?: boolean): FakeFolder => ({
  uidValidity,
  uidNext: 3,
  messages: [
    { uid: 1, flags: ['\\Seen'], source: source(`${tag}-1`) },
    { uid: 2, flags: [], source: source(`${tag}-2`) }
  ],
  ...(subscribed === undefined ? {} : { subscribed })
})

/** INBOX, Sent and A subscribed, B not */
async function server(subscribedB = false): Promise<ScriptedImap> {
  const imap = await scriptedImap({
    INBOX: folder(1, 'inbox'),
    Sent: folder(2, 'sent', false),
    A: folder(3, 'a'),
    B: folder(4, 'b', subscribedB)
  })
  imap.capabilities = ['LIST-STATUS']
  cleanups.push(() => imap.close())
  return imap
}

function engineFor(port: number): { engine: SyncEngine; store: Store } {
  const dataDir = scratch()
  const store = new Store(dataDir, 'c158')
  const engine = new SyncEngine(
    makeSandboxAccount({
      id: 'c158',
      host: '127.0.0.1',
      port,
      security: 'none',
      user: 'u',
      pass: 'p',
      dataDir
    }),
    store
  )
  cleanups.push(async () => {
    engine.stopPolling()
    await engine.close()
    store.close()
  })
  return { engine, store }
}

type Core = ReturnType<typeof createMailCore>
const entryOf = (core: Core): AccountEntry =>
  (core as unknown as { entries: Map<string, AccountEntry> }).entries.get('c158')!

function coreFor(port: number): Core {
  const core = createMailCore({
    dataDir: scratch(),
    accounts: [
      {
        id: 'c158',
        readOnly: false,
        email: 'c158@example.test',
        host: '127.0.0.1',
        port,
        security: 'none' as const,
        credentials: async () => ({ user: 'c158@example.test', pass: 'x' })
      }
    ]
  })
  cleanups.push(() => core.close())
  return core
}

const flat = (nodes: FolderNode[]): FolderNode[] => nodes.flatMap((n) => [n, ...flat(n.children)])
const nodeOf = async (core: Core, p: string): Promise<FolderNode> =>
  flat(await core.getFolders('c158')).find((f) => f.path === p)!

const countIn = (store: Store, p: string): number =>
  (
    store.db
      .prepare(
        'SELECT COUNT(*) c FROM messages m JOIN folders f ON f.id = m.folder_id WHERE f.imap_path = ?'
      )
      .get(p) as { c: number }
  ).c
const modeOf = (store: Store, p: string): string | undefined => store.getFolderByPath(p)?.sync_mode

describe('#158: seedSyncModes', () => {
  const listed = (p: string, subscribed?: boolean, specialUse?: string) => ({
    path: p,
    specialUse,
    subscribed,
    flags: new Set<string>()
  })

  it('an unsubscribed ordinary folder syncs on open, the rest always', () => {
    const list = [
      listed('INBOX', true, '\\Inbox'),
      listed('Sent', undefined, '\\Sent'),
      listed('A', true),
      listed('B')
    ]
    const seed = seedSyncModes(list)
    expect(list.map(seed)).toEqual(['always', 'always', 'always', 'on_open'])
  })

  it('safeguard: no ordinary folder subscribed, everything syncs always', () => {
    const list = [
      listed('INBOX', true, '\\Inbox'),
      listed('A'),
      listed('B'),
      // a \Noselect parent does not count as a used subscription
      { ...listed('P', true), flags: new Set(['\\Noselect']) }
    ]
    expect(list.map(seedSyncModes(list))).toEqual(['always', 'always', 'always', 'always'])
  })
})

describe('#158: the engine and on_open folders', () => {
  it('seeds from LSUB, leaves B out of the first download and keeps its counts', async () => {
    const imap = await server()
    const { engine, store } = engineFor(imap.port)
    await engine.syncAll()

    expect(modeOf(store, 'INBOX')).toBe('always')
    // special-use by name: protected, so always although LSUB leaves it out
    expect(modeOf(store, 'Sent')).toBe('always')
    expect(modeOf(store, 'A')).toBe('always')
    expect(modeOf(store, 'B')).toBe('on_open')
    expect(store.getFolderByPath('A')!.subscribed).toBe(1)
    expect(store.getFolderByPath('B')!.subscribed).toBe(0)

    expect(countIn(store, 'A')).toBe(2)
    expect(countIn(store, 'B')).toBe(0)
    expect(imap.log).not.toContain('EXAMINE B')
    expect(imap.log).not.toContain('SELECT B')
    const b = store.getFolderByPath('B')!
    expect(b.uid_validity).toBeNull()
    expect([b.status_messages, b.status_unseen]).toEqual([2, 1])
  })

  it('the deep check and the change pass do not sync B; opening it does', async () => {
    const imap = await server()
    const { engine, store } = engineFor(imap.port)
    await engine.syncAll()
    imap.folders.get('B')!.messages.push({ uid: 3, source: source('b-3') })
    imap.folders.get('B')!.uidNext = 4
    imap.log.length = 0

    await engine.syncAll({ full: true })
    await engine.syncChanges()
    expect(imap.log.filter((l) => / B$/.test(l) && !l.startsWith('STATUS'))).toEqual([])
    expect(store.getFolderByPath('B')!.status_messages).toBe(3)

    expect(await engine.syncOpened(store.getFolderByPath('B')!.id)).toBe('synced')
    expect(countIn(store, 'B')).toBe(3)
    // its own rows count now; the STATUS counts are cleared
    const b = store.getFolderByPath('B')!
    expect(b.uid_validity).not.toBeNull()
    expect(b.status_messages).toBeNull()
    // still on_open: the next change pass leaves it alone
    expect(b.sync_mode).toBe('on_open')
  })

  it('a later folder list keeps the user choice and refreshes the subscription', async () => {
    const imap = await server()
    const { engine, store } = engineFor(imap.port)
    await engine.syncAll()
    store.setFolderSyncMode([store.getFolderByPath('A')!.id], 'on_open')
    imap.folders.get('B')!.subscribed = true
    await engine.syncFolderList()
    expect(modeOf(store, 'A')).toBe('on_open')
    expect(modeOf(store, 'B')).toBe('on_open')
    expect(store.getFolderByPath('B')!.subscribed).toBe(1)
  })

  it('a folder renamed on the server keeps its mode under the new path', async () => {
    const imap = await server()
    const { engine, store } = engineFor(imap.port)
    await engine.syncAll()
    expect(store.rekeyFolder('B', 'B2', true)).toBe(1)
    expect(store.getFolderByPath('B2')!.sync_mode).toBe('on_open')
  })

  it('a store from before #158 keeps every folder always', () => {
    const dir = scratch()
    const db = new Database(path.join(dir, 'c158.db'))
    runMigrations(
      db,
      MIGRATIONS.filter((m) => m.version < 7)
    )
    db.prepare(
      `INSERT INTO folders (id, account_id, imap_path, delimiter) VALUES ('f1', 'c158', 'A', '/')`
    ).run()
    db.close()
    const store = new Store(dir, 'c158')
    cleanups.push(() => store.close())
    expect(store.getFolderByPath('A')).toMatchObject({
      sync_mode: 'always',
      subscribed: null,
      status_messages: null
    })
  })
})

describe('#158: the core API', () => {
  it('lists B as not downloaded with the server counts; search notes it', async () => {
    const imap = await server()
    const core = coreFor(imap.port)
    await core.triggerSync(false, 'c158')

    expect(await nodeOf(core, 'B')).toMatchObject({
      syncMode: 'on_open',
      subscribed: false,
      notDownloaded: true,
      totalCount: 2,
      unreadCount: 1
    })
    expect(await nodeOf(core, 'A')).toMatchObject({ syncMode: 'always', notDownloaded: false })

    const all = await core.search({ query: 'synthetic' }, 'c158')
    expect(all.notDownloadedFolders).toBe(1)
    const inA = await core.search(
      { query: 'synthetic', folderId: (await nodeOf(core, 'A')).id },
      'c158'
    )
    expect(inA.notDownloadedFolders).toBe(0)
  })

  it('switching B to always downloads it; protected folders are refused', async () => {
    const imap = await server()
    const core = coreFor(imap.port)
    await core.triggerSync(false, 'c158')
    const e = entryOf(core)

    const inbox = await nodeOf(core, 'INBOX')
    expect(await core.setFolderSyncMode([inbox.id], 'on_open', 'c158')).toBe(0)
    expect(modeOf(e.store, 'INBOX')).toBe('always')

    const b = await nodeOf(core, 'B')
    expect(await core.setFolderSyncMode([b.id], 'always', 'c158')).toBe(1)
    await vi.waitFor(() => expect(countIn(e.store, 'B')).toBe(2), { timeout: 10_000 })
    expect(await nodeOf(core, 'B')).toMatchObject({ syncMode: 'always', notDownloaded: false })

    await expect(core.setFolderSyncMode([b.id], 'sometimes' as never, 'c158')).rejects.toThrow()
  })

  it('adoptSubscriptions applies the server subscriptions to existing folders', async () => {
    // all subscribed at first: B is seeded always
    const imap = await server(true)
    const core = coreFor(imap.port)
    await core.triggerSync(false, 'c158')
    const e = entryOf(core)
    expect(modeOf(e.store, 'B')).toBe('always')

    imap.folders.get('B')!.subscribed = false
    imap.folders.get('A')!.subscribed = false
    // the folder list refreshes `subscribed` only; the modes change when the user adopts them
    await e.engine.syncFolderList()
    expect(modeOf(e.store, 'A')).toBe('always')
    expect(await core.adoptSubscriptions('c158')).toBe(2)
    expect([modeOf(e.store, 'A'), modeOf(e.store, 'B'), modeOf(e.store, 'INBOX')]).toEqual([
      'on_open',
      'on_open',
      'always'
    ])
    // nothing left to change
    expect(await core.adoptSubscriptions('c158')).toBe(0)
  })
})

describe('#158: the renderer helpers', () => {
  const node = (p: string, over: Partial<FolderNode> = {}): FolderNode => ({
    id: p,
    path: p,
    name: p.split('/').pop()!,
    delimiter: '/',
    specialUse: null,
    unreadCount: 0,
    totalCount: 0,
    syncMode: 'always',
    subscribed: true,
    notDownloaded: false,
    children: [],
    ...over
  })

  it('syncModeRows: fixed folders first, then by path, filtered by name', () => {
    const rows = syncModeRows(
      [
        node('Projekte/Zwei'),
        node('INBOX'),
        node('Projekte/Eins'),
        node('Sent', { specialUse: '\\Sent' })
      ],
      ''
    )
    expect(rows.map((r) => [r.path, r.fixed])).toEqual([
      ['INBOX', true],
      ['Sent', true],
      ['Projekte / Eins', false],
      ['Projekte / Zwei', false]
    ])
    expect(
      syncModeRows([node('Projekte/Eins'), node('Archivkiste')], 'EINS').map((r) => r.path)
    ).toEqual(['Projekte / Eins'])
  })

  it('notDownloadedNote and the connection test text', () => {
    expect(notDownloadedNote(3)).toBe('Nicht geöffnete Ordner werden nicht durchsucht (3 Ordner).')
    const ok = { ok: true as const, folderCount: 12, ms: 1500, capabilities: [] }
    expect(connectionTestMessage({ ...ok, subscribedCount: 12 })).not.toContain('abonniert')
    expect(connectionTestMessage({ ...ok, subscribedCount: 4 })).toContain(', davon 4 abonniert')
  })
})
