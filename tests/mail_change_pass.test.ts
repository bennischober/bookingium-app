// #156: the sync button's change pass. Without CONDSTORE every folder sync is a SELECT, a UID
// list and a flag sweep, so the button used to take minutes on a large mailbox even when
// nothing changed. It now syncs the priority folders (open folder, INBOX, Sent, Drafts, Trash)
// and asks every other folder for STATUS, syncing only the ones whose MESSAGES, UIDNEXT or
// UNSEEN moved. LIST-STATUS makes that round one command where the server has it. The deep
// check (syncAll) still opens every folder.
//
// Every server here is tests/helpers/scriptedImap.ts on 127.0.0.1; the messages are synthetic.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMailCore } from '../src/main/mailclient/core/index'
import type { AccountEntry } from '../src/main/mailclient/core/index'
import { Store } from '../src/main/mailclient/core/store'
import { makeSandboxAccount, SyncEngine } from '../src/main/mailclient/core/sync'
import { scriptedImap, type FakeFolder, type ScriptedImap } from './helpers/scriptedImap'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

/** A synthetic message; `tag` makes each source distinct */
const source = (tag: string): string =>
  `Message-ID: <${tag}@example.test>\r\nFrom: a@example.test\r\nTo: b@example.test\r\n` +
  `Subject: synthetic\r\nDate: Thu, 01 Jan 2026 09:00:00 +0000\r\n\r\nbody ${tag}\r\n`

/** Two messages, the first read, the second unread */
const folder = (uidValidity: number, tag: string): FakeFolder => ({
  uidValidity,
  uidNext: 3,
  messages: [
    { uid: 1, flags: ['\\Seen'], source: source(`${tag}-1`) },
    { uid: 2, flags: [], source: source(`${tag}-2`) }
  ]
})

const PRIORITY = ['INBOX', 'Sent', 'Drafts', 'Trash']
const OTHERS = ['A', 'B', 'C']

/** INBOX, the three special-use folders (recognised by name) and three ordinary folders */
async function server(capabilities: string[] = []): Promise<ScriptedImap> {
  const folders: Record<string, FakeFolder> = {}
  ;[...PRIORITY, ...OTHERS].forEach((p, i) => (folders[p] = folder(i + 1, p.toLowerCase())))
  const imap = await scriptedImap(folders)
  imap.capabilities = capabilities
  cleanups.push(() => imap.close())
  return imap
}

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-156-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function engineFor(port: number): { engine: SyncEngine; store: Store } {
  const dataDir = scratch()
  const store = new Store(dataDir, 'c156')
  const engine = new SyncEngine(
    makeSandboxAccount({
      id: 'c156',
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

/** The folders a log line opened (SELECT or EXAMINE), in order, each once */
const opened = (log: string[]): string[] => [
  ...new Set(
    log
      .filter((l) => l.startsWith('SELECT ') || l.startsWith('EXAMINE '))
      .map((l) => l.slice(l.indexOf(' ') + 1))
  )
]

const unseenOf = (store: Store, imapPath: string): number | null =>
  store.getFolderByPath(imapPath)!.unseen

const seenOf = (store: Store, imapPath: string, uid: number): boolean =>
  (
    JSON.parse(
      (
        store.db
          .prepare(
            'SELECT m.flags_json f FROM messages m JOIN folders f ON f.id = m.folder_id WHERE f.imap_path = ? AND m.uid = ?'
          )
          .get(imapPath, uid) as { f: string }
      ).f
    ) as { seen: boolean }
  ).seen

describe('#156: the change pass', () => {
  it('opens only the priority folders when nothing changed', async () => {
    const imap = await server()
    const { engine, store } = engineFor(imap.port)
    await engine.syncAll()
    expect(store.getFolderByPath('Sent')!.special_use).toBe('\\Sent')
    // the first pass leaves every folder's UNSEEN as the baseline
    for (const p of [...PRIORITY, ...OTHERS]) expect(unseenOf(store, p)).toBe(1)
    imap.log.length = 0

    const status = await engine.syncChanges()

    expect(status.phase).toBe('idle')
    expect(opened(imap.log)).toEqual(PRIORITY)
    for (const p of OTHERS) {
      expect(imap.log).toContain(`STATUS ${p}`)
      expect(imap.log).not.toContain(`FETCH ${p}`)
    }
    expect(status.changePass).toBeNull()
  }, 30_000)

  it('syncs a folder whose UNSEEN changed, and only that one', async () => {
    const imap = await server()
    const { engine, store } = engineFor(imap.port)
    await engine.syncAll()
    expect(seenOf(store, 'B', 2)).toBe(false)
    // read in another client: MESSAGES and UIDNEXT stay, only UNSEEN moves
    imap.folders.get('B')!.messages[1].flags = ['\\Seen']
    imap.log.length = 0

    await engine.syncChanges()

    expect(opened(imap.log)).toEqual([...PRIORITY, 'B'])
    expect(seenOf(store, 'B', 2)).toBe(true)
    expect(unseenOf(store, 'B')).toBe(0)
    expect(unseenOf(store, 'A')).toBe(1)
  }, 30_000)

  it('also syncs folders with new mail', async () => {
    const imap = await server()
    const { engine, store } = engineFor(imap.port)
    await engine.syncAll()
    const c = imap.folders.get('C')!
    c.messages.push({ uid: 3, flags: [], source: source('c-3') })
    c.uidNext = 4
    imap.log.length = 0

    await engine.syncChanges()

    expect(opened(imap.log)).toEqual([...PRIORITY, 'C'])
    expect(store.countByFolder(store.getFolderByPath('C')!.id).unread).toBe(2)
  }, 30_000)

  it('takes the open folder first, then INBOX, Sent, Drafts and Trash, before the check', async () => {
    const imap = await server()
    const { engine, store } = engineFor(imap.port)
    await engine.syncAll()
    imap.log.length = 0

    await engine.syncChanges({ openFolder: store.getFolderByPath('C')!.id })

    expect(opened(imap.log)).toEqual(['C', ...PRIORITY])
    // the STATUS check of the others starts after the last priority folder was synced
    const lastPriority = imap.log.lastIndexOf('FETCH Trash')
    expect(lastPriority).toBeGreaterThan(-1)
    for (const p of ['A', 'B'])
      expect(imap.log.indexOf(`STATUS ${p}`)).toBeGreaterThan(lastPriority)
    // C was asked once, as a priority folder, and not again in the check
    expect(imap.log.filter((l) => l === 'STATUS C')).toHaveLength(1)
  }, 30_000)

  it('asks one LIST-STATUS instead of a STATUS per folder when the server has it', async () => {
    const imap = await server(['LIST-STATUS'])
    const { engine, store } = engineFor(imap.port)
    await engine.syncAll()
    imap.folders.get('A')!.messages[1].flags = ['\\Seen']
    imap.log.length = 0

    await engine.syncChanges()

    expect(imap.log.filter((l) => l === 'LIST-STATUS')).toHaveLength(1)
    for (const p of OTHERS) expect(imap.log).not.toContain(`STATUS ${p}`)
    expect(opened(imap.log)).toEqual([...PRIORITY, 'A'])
    expect(unseenOf(store, 'A')).toBe(0)
    expect(engine.statusCheck.rounds).toEqual({ listStatus: 1, perFolder: 0 })
  }, 30_000)

  it('falls back to a STATUS per folder when LIST-STATUS is not advertised', async () => {
    const imap = await server()
    const { engine } = engineFor(imap.port)
    await engine.syncAll()
    imap.log.length = 0

    await engine.syncChanges()

    expect(imap.log).not.toContain('LIST-STATUS')
    for (const p of OTHERS) expect(imap.log).toContain(`STATUS ${p}`)
    expect(engine.statusCheck.rounds).toEqual({ listStatus: 0, perFolder: 1 })
  }, 30_000)

  it('is the full pass while the store is not complete yet', async () => {
    const imap = await server()
    const { engine } = engineFor(imap.port)

    await engine.syncChanges()

    expect(opened(imap.log)).toEqual(expect.arrayContaining([...PRIORITY, ...OTHERS]))
    expect(engine.statusCheck.rounds).toEqual({ listStatus: 0, perFolder: 0 })
  }, 30_000)
})

describe('#156: the background poll compares UNSEEN too', () => {
  it('syncs a folder whose read state changed elsewhere', async () => {
    const imap = await server()
    const { engine, store } = engineFor(imap.port)
    await engine.syncAll()
    imap.folders.get('C')!.messages[1].flags = ['\\Seen']

    await engine.pollOnce()

    expect(seenOf(store, 'C', 2)).toBe(true)
    expect(unseenOf(store, 'C')).toBe(0)
  }, 30_000)
})

describe('#156: the deep check', () => {
  it('still opens every folder', async () => {
    const imap = await server()
    const { engine } = engineFor(imap.port)
    await engine.syncAll()
    await engine.syncChanges()
    imap.log.length = 0

    await engine.syncAll({ full: true })

    expect(opened(imap.log).sort()).toEqual([...PRIORITY, ...OTHERS].sort())
  }, 30_000)
})

describe('#156: the sync button through the core', () => {
  type Core = ReturnType<typeof createMailCore>
  const entriesOf = (core: Core): Map<string, AccountEntry> =>
    (core as unknown as { entries: Map<string, AccountEntry> }).entries

  it('passes the open folder to the change pass, and `full` to the deep check', async () => {
    const imap = await server()
    const dataDir = scratch()
    const core = createMailCore({
      dataDir,
      accounts: [
        {
          id: 'r1',
          readOnly: true,
          email: 'r1@example.test',
          host: '127.0.0.1',
          port: imap.port,
          security: 'none' as const,
          credentials: async () => ({ user: 'r1@example.test', pass: 'x' })
        }
      ]
    })
    cleanups.push(() => core.close())
    await core.triggerSync(true, 'r1')
    const e = entriesOf(core).get('r1')!
    const b = e.store.getFolderByPath('B')!
    imap.log.length = 0

    await core.triggerSync(false, 'r1', b.id)
    expect(opened(imap.log)).toEqual(['B', ...PRIORITY])

    imap.log.length = 0
    await core.triggerSync(true, 'r1')
    expect(opened(imap.log).sort()).toEqual([...PRIORITY, ...OTHERS].sort())
  }, 60_000)
})
