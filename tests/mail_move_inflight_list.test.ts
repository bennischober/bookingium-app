// G2/L2: a mail being moved leaves its source folder's list at once.
//
// The renderer hides the row (layer 1), but that only covers the window that clicked. A reload, the
// mail window, search and the folder counts all read the store - and there the row still pointed at
// the source folder until the server had answered and the resync had landed. So the mail appeared
// not to have moved, and briefly in both folders at once.
//
// The row is deliberately NOT rewritten before the server acks: a local-only move would be lost on a
// crash and could not be undone by replaying the journal. The journal stays the source of truth; the
// read side just stops showing a mail whose move is in flight.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store } from '../src/main/mailclient/core/store'

const ACCOUNT = 'l2'
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function openStore(): { store: Store; inboxId: string; trashId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-l2-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/' })
  const trash = store.upsertFolder({ imapPath: 'Trash', delimiter: '/', specialUse: '\\Trash' })
  return { store, inboxId: inbox.id, trashId: trash.id }
}

/** One mail in INBOX with the given key */
function addMail(store: Store, inboxId: string, key: string, uid: number): number {
  return store.insertMessage({
    account_id: ACCOUNT,
    folder_id: inboxId,
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

describe('G2/L2: a mail whose move is in flight leaves the source list', () => {
  it('hides the mail from the source folder while a single move is pending', () => {
    const { store, inboxId } = openStore()
    addMail(store, inboxId, 'key-a', 1)
    addMail(store, inboxId, 'key-b', 2)
    store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'move',
      folderPath: 'INBOX',
      uid: 1,
      messageKey: 'key-a',
      targetFolderPath: 'Trash'
    })

    const visible = store.listByFolder(inboxId, 0, 10).map((r) => r.message_key)
    expect(visible).toEqual(['key-b'])
  })

  it('hides every member of a pending batch move', () => {
    // The common case: a run of deletes becomes one batch op
    const { store, inboxId } = openStore()
    addMail(store, inboxId, 'key-a', 1)
    addMail(store, inboxId, 'key-b', 2)
    addMail(store, inboxId, 'key-c', 3)
    store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'move_batch',
      folderPath: 'INBOX',
      targetFolderPath: 'Trash',
      payload: {
        members: [
          { uid: 1, messageKey: 'key-a' },
          { uid: 2, messageKey: 'key-b' }
        ]
      }
    })

    const visible = store.listByFolder(inboxId, 0, 10).map((r) => r.message_key)
    expect(visible).toEqual(['key-c'])
  })

  it('does not hide a mail whose op is only a flag change', () => {
    // A flag op has no target folder: the mail stays in the list, it only changes appearance
    const { store, inboxId } = openStore()
    addMail(store, inboxId, 'key-a', 1)
    store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'flag',
      folderPath: 'INBOX',
      uid: 1,
      messageKey: 'key-a',
      payload: { add: ['\\Seen'], remove: [] }
    })

    expect(store.listByFolder(inboxId, 0, 10).map((r) => r.message_key)).toEqual(['key-a'])
  })

  it('shows the mail again once the move is done', () => {
    // The op is settled, so the mail is either in the target (re-keyed) or back after a failure
    const { store, inboxId } = openStore()
    addMail(store, inboxId, 'key-a', 1)
    const opId = store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'move',
      folderPath: 'INBOX',
      uid: 1,
      messageKey: 'key-a',
      targetFolderPath: 'Trash'
    })
    expect(store.listByFolder(inboxId, 0, 10)).toHaveLength(0)
    store.journalUpdate(opId, { state: 'failed' })
    expect(store.listByFolder(inboxId, 0, 10).map((r) => r.message_key)).toEqual(['key-a'])
  })

  it('keeps the folder count in step with the list', () => {
    // Otherwise the header says 2 mails while the list shows 1
    const { store, inboxId } = openStore()
    addMail(store, inboxId, 'key-a', 1)
    addMail(store, inboxId, 'key-b', 2)
    store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'move',
      folderPath: 'INBOX',
      uid: 1,
      messageKey: 'key-a',
      targetFolderPath: 'Trash'
    })

    expect(store.countByFolder(inboxId).total).toBe(1)
  })
})
