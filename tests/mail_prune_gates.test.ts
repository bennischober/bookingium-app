// A2a: Gate 0 of the folder prune. A LIST response that is empty, or has no INBOX, is a
// broken/truncated view of the server, not a server without folders: such a pass must
// prune nothing. The three existing gates (debounce, blast radius, staging) stay as they
// are, and a normal list in which one folder is missing still prunes it.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store } from '../src/main/mailclient/core/store'
import { SyncEngine, type AccountConfig } from '../src/main/mailclient/core/sync'

const ACCOUNT = 'acc'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function openStore(): { store: Store; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-prune-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { store, dir }
}

type ListedFolder = {
  path: string
  delimiter: string
  specialUse: string | null
  flags: Set<string>
}

/**
 * A SyncEngine whose LIST comes from the scripted `listed` array instead of a server.
 * Only the folder-list step is exercised; no connection is opened.
 */
function engineWithList(store: Store, dir: string, listed: ListedFolder[]): SyncEngine {
  const config: AccountConfig = {
    id: ACCOUNT,
    host: '127.0.0.1',
    port: 10143,
    security: 'none',
    user: 'u',
    pass: 'p',
    readOnly: false,
    dataDir: dir
  }
  const engine = new SyncEngine(config, store)
  // The seam: syncFolderList() only uses `client.list()` from connect()
  const internals = engine as unknown as {
    connect: () => Promise<{ list: () => Promise<ListedFolder[]> }>
  }
  internals.connect = async () => ({ list: async () => listed })
  return engine
}

function listed(...paths: string[]): ListedFolder[] {
  return paths.map((p) => ({
    path: p,
    delimiter: '/',
    specialUse: p === 'INBOX' ? '\\Inbox' : null,
    flags: new Set<string>()
  }))
}

/** A store with three folders and one message each */
function seedFolders(store: Store, dir: string, paths: string[]): void {
  for (const [i, p] of paths.entries()) {
    const folder = store.upsertFolder({ imapPath: p, delimiter: '/' })
    const file = `key-${i}.eml`
    fs.writeFileSync(path.join(dir, file), 'Subject: x\r\n\r\nbody\r\n')
    store.insertMessage({
      account_id: ACCOUNT,
      folder_id: folder.id,
      uid: i + 1,
      message_key: `key-${i}`,
      file_path: file,
      message_id: `<${i}@example.test>`,
      in_reply_to: null,
      references_json: '[]',
      thread_id: null,
      date: '2026-01-01T09:00:00.000Z',
      internal_date: '2026-01-01T09:00:00.000Z',
      subject: `mail ${i}`,
      from_name: 'A',
      from_email: 'a@example.test',
      to_json: '[]',
      cc_json: '[]',
      bcc_json: '[]',
      flags_json: '{"seen":false,"flagged":false,"draft":false,"deleted":false,"answered":false}',
      modseq: null,
      has_attachments: 0,
      attachments_json: '[]',
      size_bytes: 30,
      snippet: 'body',
      parsed_ok: 1,
      parse_error: null,
      body_text: 'body',
      body_html: null
    })
  }
}

const folderCount = (store: Store): number => store.allFolders().length
const messageCount = (store: Store): number =>
  (store.db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c

const ALL_FOLDERS = [
  'INBOX',
  'Projekte',
  'Archiv',
  'Entwürfe',
  'Gesendet',
  'Papierkorb',
  'Rechnungen',
  'Bands'
]

describe('folder prune: Gate 0 (A2a)', () => {
  it('an empty LIST prunes nothing', async () => {
    const { store, dir } = openStore()
    // Enough folders that Gate 2 alone would let a pass prune some (floor(25%) = 2)
    seedFolders(store, dir, ALL_FOLDERS)
    const engine = engineWithList(store, dir, [])

    // Two passes: the debounce gate alone would prune on the second one
    await engine.syncFolderList()
    await engine.syncFolderList()

    expect(folderCount(store)).toBe(ALL_FOLDERS.length)
    expect(messageCount(store)).toBe(ALL_FOLDERS.length)
  })

  it('a LIST without INBOX prunes nothing', async () => {
    const { store, dir } = openStore()
    seedFolders(store, dir, ALL_FOLDERS)
    const engine = engineWithList(store, dir, listed(...ALL_FOLDERS.filter((p) => p !== 'INBOX')))

    await engine.syncFolderList()
    await engine.syncFolderList()

    expect(folderCount(store)).toBe(ALL_FOLDERS.length)
    expect(messageCount(store)).toBe(ALL_FOLDERS.length)
  })

  it('still prunes a folder that is genuinely gone, after the debounce pass', async () => {
    const { store, dir } = openStore()
    seedFolders(store, dir, ALL_FOLDERS)
    const engine = engineWithList(
      store,
      dir,
      listed(...ALL_FOLDERS.filter((p) => p !== 'Projekte'))
    )

    // First pass only observes the absence (Gate 1)
    await engine.syncFolderList()
    expect(folderCount(store)).toBe(ALL_FOLDERS.length)

    // Second pass prunes it (Gate 0 does not block a healthy list)
    await engine.syncFolderList()
    expect(store.getFolderByPath('Projekte')).toBeUndefined()
    expect(folderCount(store)).toBe(ALL_FOLDERS.length - 1)
    expect(messageCount(store)).toBe(ALL_FOLDERS.length - 1)
  })
})
