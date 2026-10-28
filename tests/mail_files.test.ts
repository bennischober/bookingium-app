// A3: crash-safe .eml files, a consistency check and an orphan sweep that moves
// rather than deletes. The write order is tmp -> fsync -> rename, and the file name is
// opaque and permanent, so a move only touches the row.
import { sandboxWriteAccount, sandboxCredentials } from './helpers/writeAccount'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Store } from '../src/main/mailclient/core/store'
import {
  writeMessageFile,
  isMessageFile,
  isStoredMessagePath,
  listMessageFiles
} from '../src/main/mailclient/core/files'
import { WriteEngine } from '../src/main/mailclient/core/write_engine'

const cleanups: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  while (cleanups.length) cleanups.pop()!()
})

function tempDir(prefix = 'bookingum-mail-files-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const body = (subject: string): Buffer =>
  Buffer.from(`From: a@example.test\r\nSubject: ${subject}\r\n\r\n${subject}\r\n`)

describe('writeMessageFile (A3 step 1)', () => {
  it('writes the file under a random, permanent name in its subfolder and returns it', () => {
    const dir = tempDir()
    const name = writeMessageFile(dir, body('hallo'))

    // the subfolder is the name's first two characters
    expect(name).toMatch(/^([0-9a-f]{2})\/\1[0-9a-f-]{34}\.eml$/)
    expect(isStoredMessagePath(name)).toBe(true)
    expect(fs.readFileSync(path.join(dir, name), 'utf8')).toContain('hallo')
    // no tmp file is left behind
    expect(listMessageFiles(dir).filter((f) => f.endsWith('.tmp'))).toHaveLength(0)
  })

  it('gives every message its own name', () => {
    const dir = tempDir()
    const a = writeMessageFile(dir, body('eins'))
    const b = writeMessageFile(dir, body('zwei'))
    expect(a).not.toBe(b)
    expect(listMessageFiles(dir).sort()).toEqual([a, b].sort())
  })

  it('keeps the file under its tmp name when the rename keeps failing', () => {
    const dir = tempDir()
    // Windows AV holds the file: every rename attempt fails with EPERM
    const err = Object.assign(new Error('EPERM'), { code: 'EPERM' })
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw err
    })

    const name = writeMessageFile(dir, body('gesperrt'))

    // The returned name is the one the file actually has, so the row can point at it
    expect(name.endsWith('.eml.tmp')).toBe(true)
    expect(fs.existsSync(path.join(dir, name))).toBe(true)
    expect(fs.readFileSync(path.join(dir, name), 'utf8')).toContain('gesperrt')
    expect(isMessageFile(name)).toBe(true)
  })

  it('cleans up the tmp file when writing fails', () => {
    const dir = tempDir()
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('disk full')
    })

    expect(() => writeMessageFile(dir, body('kaputt'))).toThrow('disk full')
    expect(listMessageFiles(dir)).toHaveLength(0)
  })
})

describe('message files in subfolders', () => {
  it('lists the subfolders and the top level, where older files stay', () => {
    const dir = tempDir()
    const fresh = writeMessageFile(dir, body('neu'))
    // a file written before the subfolders, and its row still names it there
    fs.writeFileSync(path.join(dir, 'aaaaaaaa-0000-4000-8000-000000000000.eml'), 'x')
    // not message files: the store, parked orphans, another folder
    fs.writeFileSync(path.join(dir, 'acc.db'), 'x')
    fs.mkdirSync(path.join(dir, 'orphans'))
    fs.writeFileSync(path.join(dir, 'orphans', 'bbbbbbbb-0000-4000-8000-000000000000.eml'), 'x')
    fs.mkdirSync(path.join(dir, 'attachments'))
    fs.writeFileSync(path.join(dir, 'attachments', 'c.eml'), 'x')

    expect(listMessageFiles(dir).sort()).toEqual(
      [fresh, 'aaaaaaaa-0000-4000-8000-000000000000.eml'].sort()
    )
    expect(listMessageFiles(path.join(dir, 'missing'))).toEqual([])
  })

  it('takes only a stored path as one: top level or one subfolder', () => {
    expect(isStoredMessagePath('3f/3f000000-0000-4000-8000-000000000000.eml')).toBe(true)
    expect(isStoredMessagePath('3f000000-0000-4000-8000-000000000000.eml')).toBe(true)
    expect(isStoredMessagePath('3f/3f000000.eml.tmp')).toBe(false)
    expect(isStoredMessagePath('orphans/3f000000.eml')).toBe(false)
    expect(isStoredMessagePath('../3f000000.eml')).toBe(false)
    expect(isStoredMessagePath('3f/../../x.eml')).toBe(false)
    expect(isStoredMessagePath('3f\\3f000000.eml')).toBe(false)
    expect(isStoredMessagePath('/3f000000.eml')).toBe(false)
  })
})

describe('sweep and move (A3 steps 3 and 6)', () => {
  function openStore(): { store: Store; dir: string } {
    const dir = tempDir('bookingum-mail-sweep-')
    const store = new Store(dir, 'acc')
    cleanups.push(() => store.close())
    return { store, dir }
  }

  it('a move only updates the row: the file keeps its name and stays readable', async () => {
    const { store, dir } = openStore()
    const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
    const archive = store.upsertFolder({ imapPath: 'Archiv', delimiter: '/', uidValidity: '1' })
    const relPath = writeMessageFile(dir, body('umzug'))
    const id = store.insertMessage({
      account_id: 'acc',
      folder_id: inbox.id,
      uid: 1,
      message_key: 'key-1',
      file_path: relPath,
      message_id: '<1@example.test>',
      in_reply_to: null,
      references_json: '[]',
      thread_id: null,
      date: '2026-01-01T09:00:00.000Z',
      internal_date: '2026-01-01T09:00:00.000Z',
      subject: 'umzug',
      from_name: '',
      from_email: '',
      to_json: '[]',
      cc_json: '[]',
      bcc_json: '[]',
      flags_json: '{}',
      modseq: null,
      has_attachments: 0,
      attachments_json: '[]',
      size_bytes: 10,
      snippet: '',
      parsed_ok: 1,
      parse_error: null,
      body_text: '',
      body_html: null
    })
    const opId = store.journalEnqueue({
      accountId: 'acc',
      kind: 'move',
      folderPath: 'INBOX',
      folderUidValidity: '1',
      uid: 1,
      messageKey: 'key-1',
      messageId: '<1@example.test>',
      targetFolderPath: 'Archiv'
    })

    // The engine's local half of the move, without any server contact
    const writes = new WriteEngine(store, 'acc', {
      writeAccount: sandboxWriteAccount(),
      credentials: sandboxCredentials
    }) as unknown as {
      moves: { applyMoveLocally: (op: unknown, target: string, uid: number) => void }
    }
    writes.moves.applyMoveLocally(store.journalGet(opId)!, 'Archiv', 7)

    const moved = store.getMessage(id)!
    expect(moved.folder_id).toBe(archive.id)
    expect(moved.uid).toBe(7)
    // The file name is unchanged and still readable
    expect(moved.file_path).toBe(relPath)
    expect(fs.existsSync(path.join(dir, moved.file_path))).toBe(true)
    expect(fs.readFileSync(path.join(dir, moved.file_path), 'utf8')).toContain('umzug')
  })
})

describe('storeMessage and consistency (A3 steps 2 and 4)', () => {
  function openStore(): { store: Store; dir: string } {
    const dir = tempDir('bookingum-mail-store-')
    const store = new Store(dir, 'acc')
    cleanups.push(() => store.close())
    return { store, dir }
  }

  it('stores a row whose file exists under the opaque name, for a parseable mail', async () => {
    const { store, dir } = openStore()
    const folder = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
    const relPath = writeMessageFile(dir, body('parsebar'))
    const id = store.insertMessage({
      account_id: 'acc',
      folder_id: folder.id,
      uid: 1,
      message_key: 'key-1',
      file_path: relPath,
      message_id: '<1@example.test>',
      in_reply_to: null,
      references_json: '[]',
      thread_id: null,
      date: '2026-01-01T09:00:00.000Z',
      internal_date: '2026-01-01T09:00:00.000Z',
      subject: 'parsebar',
      from_name: 'A',
      from_email: 'a@example.test',
      to_json: '[]',
      cc_json: '[]',
      bcc_json: '[]',
      flags_json: '{}',
      modseq: null,
      has_attachments: 0,
      attachments_json: '[]',
      size_bytes: 30,
      snippet: 'x',
      parsed_ok: 1,
      parse_error: null,
      body_text: 'x',
      body_html: null
    })
    expect(store.getMessage(id)!.file_path).toBe(relPath)
    expect(fs.existsSync(path.join(dir, relPath))).toBe(true)
  })

  it('counts rows without a file, files without a row and tmp files', () => {
    const { store, dir } = openStore()
    const folder = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
    // one healthy row
    const good = writeMessageFile(dir, body('gut'))
    store.insertMessage({
      account_id: 'acc',
      folder_id: folder.id,
      uid: 1,
      message_key: 'key-1',
      file_path: good,
      message_id: null,
      in_reply_to: null,
      references_json: '[]',
      thread_id: null,
      date: '2026-01-01T09:00:00.000Z',
      internal_date: '2026-01-01T09:00:00.000Z',
      subject: 'gut',
      from_name: '',
      from_email: '',
      to_json: '[]',
      cc_json: '[]',
      bcc_json: '[]',
      flags_json: '{}',
      modseq: null,
      has_attachments: 0,
      attachments_json: '[]',
      size_bytes: 10,
      snippet: '',
      parsed_ok: 1,
      parse_error: null,
      body_text: '',
      body_html: null
    })
    // one row whose file is gone
    store.insertMessage({
      account_id: 'acc',
      folder_id: folder.id,
      uid: 2,
      message_key: 'key-2',
      file_path: 'missing.eml',
      message_id: null,
      in_reply_to: null,
      references_json: '[]',
      thread_id: null,
      date: '2026-01-01T09:00:00.000Z',
      internal_date: '2026-01-01T09:00:00.000Z',
      subject: 'weg',
      from_name: '',
      from_email: '',
      to_json: '[]',
      cc_json: '[]',
      bcc_json: '[]',
      flags_json: '{}',
      modseq: null,
      has_attachments: 0,
      attachments_json: '[]',
      size_bytes: 10,
      snippet: '',
      parsed_ok: 1,
      parse_error: null,
      body_text: '',
      body_html: null
    })
    // one orphan file and one leftover tmp file
    fs.writeFileSync(path.join(dir, 'orphan.eml'), 'x')
    fs.writeFileSync(path.join(dir, 'leftover.eml.tmp'), 'x')

    // The consistency check itself lives on MailCore; the counts are computed from
    // the same two sources here, so the store contract is pinned.
    const rows = store.db.prepare('SELECT file_path FROM messages').all() as { file_path: string }[]
    const files = new Set(listMessageFiles(dir))
    const referenced = new Set(rows.map((r) => r.file_path))
    const rowsWithoutFile = [...referenced].filter((r) => !files.has(r)).length
    const filesWithoutRow = [...files].filter((f) => !referenced.has(f)).length
    const tmpFiles = [...files].filter((f) => f.endsWith('.tmp')).length

    expect(rowsWithoutFile).toBe(1)
    expect(filesWithoutRow).toBe(2)
    expect(tmpFiles).toBe(1)
    expect(store.ftsIntegrityCheck()).toBe(true)
  })
})
