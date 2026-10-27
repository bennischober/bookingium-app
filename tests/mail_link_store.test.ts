// MR-28: the store side of mail linking. A cursor over row ids is only sound when the
// ids are never handed out twice and the cursor knows which store it belongs to; main
// finds Sent by its special-use, which only the store knows. Invented data only.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store } from '../src/main/mailclient/core/store'
import {
  createMailCore,
  type MailCore,
  type MailCoreEvent
} from '../src/main/mailclient/core/index'

const ACCOUNT = 'links'
const cleanups: (() => unknown)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-links-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function addMail(store: Store, folderId: string, n: number): number {
  return store.insertMessage({
    account_id: ACCOUNT,
    folder_id: folderId,
    uid: n,
    message_key: `links-${n}`,
    file_path: `links-${n}.eml`,
    message_id: `<links-${n}@example.test>`,
    in_reply_to: null,
    references_json: '[]',
    thread_id: null,
    date: '2026-10-01T12:00:00.000Z',
    internal_date: '2026-10-01T12:00:00.000Z',
    subject: `mail ${n}`,
    from_name: 'Sender',
    from_email: 'sender@example.test',
    to_json: '[]',
    cc_json: '[]',
    bcc_json: '[]',
    flags_json: '{"seen":true,"flagged":false,"draft":false,"deleted":false,"answered":false}',
    modseq: null,
    has_attachments: 0,
    attachments_json: '[]',
    size_bytes: 1000 + n,
    body_text: 'plain',
    body_html: null,
    snippet: '',
    parsed_ok: 1,
    parse_error: null
  })
}

describe('store generation and row ids (MR-28)', () => {
  it('keeps its generation across a reopen and gives a new store a new one', () => {
    const dir = tempDir()
    const first = new Store(dir, ACCOUNT)
    const generation = first.generation()
    expect(generation).toMatch(/\S/)
    expect(first.generation()).toBe(generation)
    first.close()
    const reopened = new Store(dir, ACCOUNT)
    expect(reopened.generation()).toBe(generation)
    reopened.close()
    const other = new Store(tempDir(), ACCOUNT)
    expect(other.generation()).not.toBe(generation)
    other.close()
  })

  it('never hands out the id of a deleted newest mail again', () => {
    const store = new Store(tempDir(), ACCOUNT)
    cleanups.push(() => store.close())
    const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
    addMail(store, inbox.id, 1)
    const newest = addMail(store, inbox.id, 2)
    // The linker has seen the newest mail; the user deletes it; new mail arrives
    store.deleteMessages([newest])
    const next = addMail(store, inbox.id, 3)
    expect(next).toBeGreaterThan(newest)
  })

  it('keeps the id high-water mark across a reopen', () => {
    const dir = tempDir()
    const store = new Store(dir, ACCOUNT)
    const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
    const newest = addMail(store, inbox.id, 1)
    store.deleteMessages([newest])
    store.close()
    const reopened = new Store(dir, ACCOUNT)
    cleanups.push(() => reopened.close())
    expect(addMail(reopened, reopened.getFolderByPath('INBOX')!.id, 2)).toBeGreaterThan(newest)
  })
})

describe('the core names the store and the Sent folder (MR-28)', () => {
  function openCore(seed: (store: Store) => void): MailCore {
    const dir = tempDir()
    const storeDir = path.join(dir, ACCOUNT)
    fs.mkdirSync(storeDir, { recursive: true })
    const store = new Store(storeDir, ACCOUNT)
    seed(store)
    store.close()
    const api = createMailCore({
      dataDir: dir,
      accounts: [
        {
          id: ACCOUNT,
          kind: 'sandbox',
          readOnly: false,
          email: 'links@example.test',
          host: '127.0.0.1',
          port: 1,
          security: 'none',
          credentials: async () => ({ user: 'links@example.test', pass: 'x' })
        }
      ]
    }) as MailCore
    // Runs before the directory is removed (cleanups run last-in, first-out)
    cleanups.push(() => api.close())
    return api
  }

  it('returns the store generation with every page of headers', async () => {
    let generation = ''
    const api = openCore((store) => {
      const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
      for (let n = 1; n <= 3; n++) addMail(store, inbox.id, n)
      generation = store.generation()
    })
    const page = await api.listHeadersSince(0, 2, ACCOUNT)
    expect(page.generation).toBe(generation)
    expect(page.headers.map((h) => h.id)).toEqual([1, 2])
    const rest = await api.listHeadersSince(2, 2, ACCOUNT)
    expect(rest.generation).toBe(generation)
    expect(rest.headers.map((h) => h.id)).toEqual([3])
  })

  it('adds the special-use to a finished folder, so Sent is found by `\\Sent`', () => {
    const api = openCore((store) => {
      store.upsertFolder({ imapPath: 'Gesendete Objekte', delimiter: '/', specialUse: '\\Sent' })
      store.upsertFolder({ imapPath: 'Archiv', delimiter: '/' })
    })
    const seen: MailCoreEvent[] = []
    cleanups.push(api.on('sync-event', (e) => seen.push(e)))
    const engine = (
      api as unknown as {
        entries: Map<string, { engine: { onSyncEvent: (ev: unknown) => void } }>
      }
    ).entries.get(ACCOUNT)!.engine
    const done = { type: 'folder-done', newCount: 1, flagChanges: 0, expunged: 0, moved: 0 }
    engine.onSyncEvent({ ...done, path: 'Gesendete Objekte' })
    engine.onSyncEvent({ ...done, path: 'Archiv' })
    // Other events pass through unchanged
    engine.onSyncEvent({ type: 'folder-start', path: 'Archiv', mode: 'full' })
    expect(seen.map((e) => (e as { event: unknown }).event)).toEqual([
      { ...done, path: 'Gesendete Objekte', specialUse: '\\Sent' },
      { ...done, path: 'Archiv', specialUse: null },
      { type: 'folder-start', path: 'Archiv', mode: 'full' }
    ])
  })
})
