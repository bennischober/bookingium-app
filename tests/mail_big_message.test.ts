// A8: a 25 MB message through the file and journal path, ported from the prototype's
// test-big-message. Size changes the physics: an APPEND/FETCH of 25 MB takes seconds, so a kill
// can land inside the literal; and the journal stores MIME base64, which is ~34 MB of TEXT.
//
// Proven here:
//   R1. a 25 MB message survives the store round trip (row + file size match)
//   R2. a journaled 25 MB payload round-trips through SQLite intact
//   R3. the store stays consistent (ftsIntegrityCheck) after the big row
//
// The 25 MB variant runs only with MAIL_LONG=1; the default run uses 256 KB so
// `pnpm test` stays fast (the write does a real fsync, slow on WSL filesystems).
import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { Store } from '../src/main/mailclient/core/store'
import { writeMessageFile } from '../src/main/mailclient/core/files'

const LONG = process.env.MAIL_LONG === '1'
const SIZE = LONG ? 25 * 1024 * 1024 : 256 * 1024

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-big-'))
const store = new Store(dir, 'big')

afterAll(() => {
  store.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

/** A message of about `bytes`, with a real MIME shape */
function bigMessage(bytes: number, token: string): Buffer {
  const head =
    `From: big@example.test\r\nTo: big@example.test\r\n` +
    `Subject: big ${token}\r\nMessage-ID: <big-${token}@example.test>\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n\r\n`
  const filler = 'x'.repeat(Math.max(0, bytes - head.length - token.length))
  return Buffer.from(head + filler + token)
}

const sizeLabel =
  SIZE >= 1024 * 1024 ? `${Math.round(SIZE / 1024 / 1024)} MB` : `${Math.round(SIZE / 1024)} KB`

describe(`big message (${sizeLabel})`, () => {
  it('writes and reads the file at full size', () => {
    const source = bigMessage(SIZE, 'riesigtoken')
    const relPath = writeMessageFile(dir, source)

    expect(fs.statSync(path.join(dir, relPath)).size).toBe(source.length)
    // Compare by digest, not a deep structural compare of a multi-MB buffer
    const digest = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
    expect(digest(fs.readFileSync(path.join(dir, relPath)))).toBe(digest(source))
  })

  it('stores a row whose file size matches, and stays searchable', () => {
    const source = bigMessage(SIZE, 'riesigtoken')
    const relPath = writeMessageFile(dir, source)
    const folder = store.upsertFolder({ imapPath: 'Big', delimiter: '/', uidValidity: '1' })
    const id = store.insertMessage({
      account_id: 'big',
      folder_id: folder.id,
      uid: 1,
      message_key: 'big-1',
      file_path: relPath,
      message_id: '<big-1@example.test>',
      in_reply_to: null,
      references_json: '[]',
      thread_id: null,
      date: '2026-01-01T09:00:00.000Z',
      internal_date: '2026-01-01T09:00:00.000Z',
      subject: 'big riesigtoken',
      from_name: 'Big',
      from_email: 'big@example.test',
      to_json: '[]',
      cc_json: '[]',
      bcc_json: '[]',
      flags_json: '{"seen":false,"flagged":false,"draft":false,"deleted":false,"answered":false}',
      modseq: null,
      has_attachments: 0,
      attachments_json: '[]',
      size_bytes: source.length,
      body_text: 'x'.repeat(1000),
      body_html: null,
      snippet: 'big',
      parsed_ok: 1,
      parse_error: null
    })

    const row = store.getMessage(id)!
    expect(Number(row.size_bytes)).toBe(source.length)
    expect(fs.statSync(path.join(dir, row.file_path)).size).toBe(source.length)

    const found = store.search({
      matchExpr: store.ftsEscapeUserQuery('riesigtoken'),
      limit: 10,
      offset: 0
    })
    expect(found.rows.map((r) => r.id)).toContain(id)
    expect(store.ftsIntegrityCheck()).toBe(true)
  })

  it('round-trips the journal payload through SQLite', () => {
    const source = bigMessage(SIZE, 'journallast')
    const folder = store.upsertFolder({ imapPath: 'Big', delimiter: '/', uidValidity: '1' })
    const opId = store.journalEnqueue({
      accountId: 'big',
      kind: 'draft_save',
      folderPath: 'Big',
      folderUidValidity: '1',
      payload: { mime: source.toString('base64') }
    })

    const op = store.journalGet(opId)!
    const payload = JSON.parse(op.payload!) as { mime: string }
    const digest = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
    expect(digest(Buffer.from(payload.mime, 'base64'))).toBe(digest(source))
    // The write engine's size-aware watchdog reads this payload; it must stay readable
    expect(Buffer.from(payload.mime, 'base64').length).toBe(source.length)
    void folder
  })
})
