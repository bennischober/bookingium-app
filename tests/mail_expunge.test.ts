// A1 / F7: the local half of a permanent deletion. The row goes first, then the file,
// resolved against the account's data dir (never the process working directory), and the
// FTS index stays intact because the messages_bd trigger already removed the row.
import { sandboxWriteAccount, sandboxCredentials } from './helpers/writeAccount'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store } from '../src/main/mailclient/core/store'
import { WriteEngine } from '../src/main/mailclient/core/write_engine'

const ACCOUNT = 'acc'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function openStore(): { store: Store; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-expunge-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { store, dir }
}

/** One stored message with its .eml file, the way the sync engine writes it */
function addMessage(
  store: Store,
  dir: string,
  n: number,
  folderId: string,
  subject: string
): { id: number; messageKey: string; file: string } {
  const messageKey = `key-${n}`
  const file = `${messageKey}.eml`
  fs.writeFileSync(path.join(dir, file), `Subject: ${subject}\r\n\r\nbody ${subject}\r\n`)
  const id = store.insertMessage({
    account_id: ACCOUNT,
    folder_id: folderId,
    uid: n,
    message_key: messageKey,
    file_path: file,
    message_id: `<${n}@example.test>`,
    in_reply_to: null,
    references_json: '[]',
    thread_id: null,
    date: `2026-01-0${n}T09:00:00.000Z`,
    internal_date: `2026-01-0${n}T09:00:00.000Z`,
    subject,
    from_name: 'Absender',
    from_email: 'absender@example.test',
    to_json: '[]',
    cc_json: '[]',
    bcc_json: '[]',
    flags_json: '{"seen":false,"flagged":false,"draft":false,"deleted":false,"answered":false}',
    modseq: null,
    has_attachments: 0,
    attachments_json: '[]',
    size_bytes: 40,
    snippet: subject,
    parsed_ok: 1,
    parse_error: null,
    body_text: `body ${subject}`,
    body_html: null
  })
  return { id, messageKey, file }
}

describe('expunge: local cleanup (A1)', () => {
  it('removes the row and its file, keeps the FTS index intact and leaves the other mail searchable', () => {
    const { store, dir } = openStore()
    const folder = store.upsertFolder({ imapPath: 'Trash', delimiter: '/' })
    const doomed = addMessage(store, dir, 1, folder.id, 'zitrone')
    const kept = addMessage(store, dir, 2, folder.id, 'apfel')
    expect(store.ftsIntegrityCheck()).toBe(true)

    const writes = new WriteEngine(store, ACCOUNT, { writeAccount: sandboxWriteAccount(), credentials: sandboxCredentials })
    writes.removeLocally(doomed.messageKey)

    // The row is gone, the other one is untouched
    expect(store.getByKey(doomed.messageKey)).toBeUndefined()
    expect(store.getByKey(kept.messageKey)).toBeDefined()

    // The file is gone, resolved against the account dir
    expect(fs.existsSync(path.join(dir, doomed.file))).toBe(false)
    expect(fs.existsSync(path.join(dir, kept.file))).toBe(true)

    // The index survived: still consistent, the kept mail is still searchable,
    // and the deleted one is not
    expect(store.ftsIntegrityCheck()).toBe(true)
    const hits = store.search({ matchExpr: 'apfel', limit: 10, offset: 0 })
    expect(hits.rows.map((r) => r.id)).toContain(kept.id)
    const gone = store.search({ matchExpr: 'zitrone', limit: 10, offset: 0 })
    expect(gone.rows.map((r) => r.id)).not.toContain(doomed.id)
  })

  it('does not depend on the process working directory', () => {
    const { store, dir } = openStore()
    const folder = store.upsertFolder({ imapPath: 'Trash', delimiter: '/' })
    const doomed = addMessage(store, dir, 1, folder.id, 'birne')

    // A file of the same name in another directory must never be the one that goes
    const cwd = process.cwd()
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-cwd-'))
    cleanups.push(() => fs.rmSync(elsewhere, { recursive: true, force: true }))
    fs.writeFileSync(path.join(elsewhere, doomed.file), 'not this one')
    try {
      process.chdir(elsewhere)
      const writes = new WriteEngine(store, ACCOUNT, { writeAccount: sandboxWriteAccount(), credentials: sandboxCredentials })
      writes.removeLocally(doomed.messageKey)
    } finally {
      process.chdir(cwd)
    }

    // The account's file went; the same-named file in the working directory did not
    expect(fs.existsSync(path.join(dir, doomed.file))).toBe(false)
    expect(fs.existsSync(path.join(elsewhere, doomed.file))).toBe(true)
  })

  it('reports a file it cannot remove, without the file name, and keeps the row gone', () => {
    const { store, dir } = openStore()
    const folder = store.upsertFolder({ imapPath: 'Trash', delimiter: '/' })
    const doomed = addMessage(store, dir, 1, folder.id, 'pflaume')
    // A directory where the file is expected: unlink fails with EISDIR/EPERM
    fs.rmSync(path.join(dir, doomed.file))
    fs.mkdirSync(path.join(dir, doomed.file))

    const warnings: string[] = []
    const writes = new WriteEngine(store, ACCOUNT, { writeAccount: sandboxWriteAccount(), credentials: sandboxCredentials, log: { warn: (m) => warnings.push(m) } })
    writes.removeLocally(doomed.messageKey)

    expect(store.getByKey(doomed.messageKey)).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(doomed.messageKey)
    expect(warnings[0]).not.toContain(dir)
  })
})
