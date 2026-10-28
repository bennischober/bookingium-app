// G4: deleting a draft must be as immediate as deleting an inbox mail.
//
// The person reported exactly that split: an inbox delete felt instant after the G2 work, a draft
// delete still took seconds. Two separate causes, both fixed here:
//
//   1. The renderer awaited the whole write before closing the editor, so the click looked dead.
//      An inbox delete goes through moveAway(), which hides the row first (G2/L1) - a discard had
//      no such optimism.
//   2. discardDraft() journaled only `uid`, no `message_key`, so the read-side exclusion from
//      G2/L2 never matched it and the draft lingered in the Drafts list until the resync landed.
//
// The core half is tested here against a real Store: the op must carry the key, and the list must
// stop showing the draft while the op is in flight.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store } from '../src/main/mailclient/core/store'

const ACCOUNT = 'g4'
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function openStore(): { store: Store; draftsId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-g4-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const drafts = store.upsertFolder({ imapPath: 'Drafts', delimiter: '/', specialUse: '\\Drafts' })
  store.upsertFolder({ imapPath: 'Trash', delimiter: '/', specialUse: '\\Trash' })
  return { store, draftsId: drafts.id }
}

function addDraft(store: Store, draftsId: string, key: string, uid: number): void {
  store.insertMessage({
    account_id: ACCOUNT,
    folder_id: draftsId,
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
    flags_json: '{"seen":true,"flagged":false,"draft":true,"deleted":false,"answered":false}',
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

describe('G4: a discarded draft leaves the Drafts list at once', () => {
  it('hides the draft while the delete is in flight, when the op carries the key', () => {
    // This is the shape discardDraft now journals: kind draft_delete WITH messageKey
    const { store, draftsId } = openStore()
    addDraft(store, draftsId, 'key-a', 1)
    addDraft(store, draftsId, 'key-b', 2)
    store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'draft_delete',
      folderPath: 'Drafts',
      uid: 1,
      messageKey: 'key-a',
      targetFolderPath: 'Trash'
    })

    expect(store.listByFolder(draftsId, 0, 10).map((r) => r.message_key)).toEqual(['key-b'])
  })

  it('would NOT hide it without the key - the regression this fixes', () => {
    // The old op: uid only. The exclusion matches on message_key, so nothing was hidden and the
    // draft stayed visible until the server answered.
    const { store, draftsId } = openStore()
    addDraft(store, draftsId, 'key-a', 1)
    store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'draft_delete',
      folderPath: 'Drafts',
      uid: 1,
      targetFolderPath: 'Trash'
    })

    expect(store.listByFolder(draftsId, 0, 10).map((r) => r.message_key)).toEqual(['key-a'])
  })

  it('shows the draft again once the op has failed', () => {
    // A failed discard must not hide the draft forever
    const { store, draftsId } = openStore()
    addDraft(store, draftsId, 'key-a', 1)
    const opId = store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'draft_delete',
      folderPath: 'Drafts',
      uid: 1,
      messageKey: 'key-a',
      targetFolderPath: 'Trash'
    })
    expect(store.listByFolder(draftsId, 0, 10)).toHaveLength(0)
    store.journalUpdate(opId, { state: 'failed' })
    expect(store.listByFolder(draftsId, 0, 10).map((r) => r.message_key)).toEqual(['key-a'])
  })
})

describe('G4: the editor does not wait for the server', () => {
  it('closes before the discard round-trip', async () => {
    // The renderer must not await discardDraft before onClose(); it used to, which is the
    // "unresponsive" part. Asserted on the source because it is an ordering rule in a component.
    const { readFileSync } = await import('fs')
    const src = readFileSync(
      path.join(process.cwd(), 'src/renderer/src/components/mail/ComposeView.tsx'),
      'utf8'
    )
    const discard = src.slice(src.indexOf("setBusy('discard')"), src.indexOf('const addFiles'))
    // no `await mailApi.discardDraft` - it is fired and reported on its own
    expect(discard).not.toContain('await mailApi.discardDraft')
    expect(discard).toContain('void mailApi')
    // and the close comes after the fire-and-forget, not before it
    expect(discard.indexOf('void mailApi')).toBeLessThan(discard.indexOf('onClose()'))
  })
})
