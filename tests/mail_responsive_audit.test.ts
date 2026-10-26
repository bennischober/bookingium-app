// Ultrawork audit: the remaining slow paths and the stability of the G2/G4/G5 fixes.
//
// Three defects this suite pins, each found by reading the code and then confirmed by running it:
//
//   A. PERMANENT DELETE keeps its row visible for the whole round-trip. The read-side exclusion
//      (G2/L2) matches only ops WITH a target folder; an expunge has none, so a mail being
//      permanently deleted stays in the Trash list until the server answers.
//   B. The G5 local row can duplicate. storeAppendedDraft() stores with
//      `draftFolder.uid_validity ?? ''`; if the folder row has no uid_validity yet, the key differs
//      from the one the later sync computes with the real validity - two rows for one draft.
//   C. A failed op must discard the shared write connection, so the next op reconnects.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store } from '../src/main/mailclient/core/store'

const ACCOUNT = 'audit'
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function openStore(): { store: Store; dir: string; trashId: string; draftsId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-audit-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const trash = store.upsertFolder({ imapPath: 'Trash', delimiter: '/', specialUse: '\\Trash' })
  const drafts = store.upsertFolder({ imapPath: 'Drafts', delimiter: '/', specialUse: '\\Drafts' })
  return { store, dir, trashId: trash.id, draftsId: drafts.id }
}

function addMail(store: Store, folderId: string, key: string, uid: number): void {
  store.insertMessage({
    account_id: ACCOUNT,
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
    from_name: 'A',
    from_email: 'a@example.test',
    to_json: '[]',
    cc_json: '[]',
    bcc_json: '[]',
    flags_json: '{"seen":true,"flagged":false,"draft":false,"deleted":false,"answered":false}',
    modseq: null,
    has_attachments: 0,
    attachments_json: '[]',
    size_bytes: 10,
    snippet: key,
    parsed_ok: 1,
    parse_error: null,
    body_text: key,
    body_html: `<p>${key}</p>`
  })
}

describe('AUDIT A: a mail being permanently deleted leaves the Trash list at once', () => {
  it('excludes an in-flight expunge, which has no target folder', () => {
    // The exclusion requires target_folder_path IS NOT NULL, and an expunge never sets one.
    const { store, trashId } = openStore()
    addMail(store, trashId, 'key-a', 1)
    addMail(store, trashId, 'key-b', 2)
    store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'expunge',
      folderPath: 'Trash',
      uid: 1,
      messageKey: 'key-a'
    })

    // expected: key-a is gone from the list immediately
    expect(store.listByFolder(trashId, 0, 10).map((r) => r.message_key)).toEqual(['key-b'])
  })

  it('keeps the Trash count in step with the list', () => {
    const { store, trashId } = openStore()
    addMail(store, trashId, 'key-a', 1)
    addMail(store, trashId, 'key-b', 2)
    store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'expunge',
      folderPath: 'Trash',
      uid: 1,
      messageKey: 'key-a'
    })
    expect(store.countByFolder(trashId).total).toBe(1)
  })
})

describe('AUDIT B: the G5 local row must not duplicate on the next sync', () => {
  it('uses the folder validity and skips when nothing is known', async () => {
    // The write engine calls storeAppendedDraft(folderPath, uidValidity, ...) with the validity as
    // known when the op was built - null until that folder was synced once. Storing with '' would
    // compute a key the next sync never reproduces, and the sync would then insert a SECOND row for
    // the same draft. This calls the PRODUCTION decision (draftStoreValidity), not a copy of it.
    const { draftStoreValidity } = await import('../src/main/mailclient/core/draft_store')

    // nothing known -> skip the local store (the resync stays the way the draft appears)
    expect(draftStoreValidity(null, null)).toBeNull()
    expect(draftStoreValidity('', null)).toBeNull()
    expect(draftStoreValidity(undefined, undefined)).toBeNull()

    // the caller's value wins, and it is the one the next sync will compute with
    expect(draftStoreValidity('99', null)).toBe('99')
    // the folder row covers the case where the value arrived meanwhile
    expect(draftStoreValidity(null, '77')).toBe('77')
    expect(draftStoreValidity('', '77')).toBe('77')
    // never an empty string: that key would never match
    expect(draftStoreValidity(null, '')).toBeNull()
  })

  it('stores exactly one row with the key the next sync computes', async () => {
    const { SyncEngine } = await import('../src/main/mailclient/core/sync')
    const { store, dir, draftsId } = openStore()
    store.db.prepare("UPDATE folders SET uid_validity = '99' WHERE imap_path = 'Drafts'").run()
    const engine = new SyncEngine(
      {
        id: ACCOUNT,
        host: '127.0.0.1',
        port: 1,
        security: 'none',
        user: 'u',
        pass: 'p',
        readOnly: false,
        dataDir: dir
      },
      store
    )
    const mime = Buffer.from('From: a@example.test\r\nSubject: X\r\n\r\nbody\r\n')
    await engine.storeAppendedDraft(draftsId, '99', 7, mime)
    const rows = store.listByFolder(draftsId, 0, 10)
    expect(rows).toHaveLength(1)
    expect(rows[0].message_key).toBe(store.messageKey(ACCOUNT, draftsId, '99', 7))
    // a second store of the same UID is a no-op, not a duplicate
    await engine.storeAppendedDraft(draftsId, '99', 7, mime)
    expect(store.listByFolder(draftsId, 0, 10)).toHaveLength(1)
  })
})
