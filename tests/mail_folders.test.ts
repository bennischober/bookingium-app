// B1: folder names come from the user and reach the server, so the rules are
// checked before anything is journaled. The helpers are pure.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store } from '../src/main/mailclient/core/store'
import {
  checkFolderName,
  folderMoveRefusal,
  folderMoveTarget,
  folderPath,
  isPathOrChild,
  isProtectedFolder,
  renamedPath,
  FolderNameError
} from '../src/main/mailclient/core/folders'

const ACCOUNT = 'acc'
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function openStore(): { store: Store; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-folders-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { store, dir }
}

describe('folder name rules (B1)', () => {
  it('accepts an ordinary name', () => {
    expect(checkFolderName('Verträge')).toBe('Verträge')
    expect(checkFolderName('2026 Tour')).toBe('2026 Tour')
  })

  it('refuses an empty name or only spaces', () => {
    expect(() => checkFolderName('')).toThrow(FolderNameError)
    expect(() => checkFolderName('   ')).toThrow(FolderNameError)
  })

  it('refuses leading or trailing spaces instead of silently trimming', () => {
    // Trimming would create a different folder than the user asked for
    expect(() => checkFolderName(' Verträge')).toThrow(/Leerzeichen/)
    expect(() => checkFolderName('Verträge ')).toThrow(/Leerzeichen/)
  })

  it('refuses the hierarchy delimiter inside a name', () => {
    expect(() => checkFolderName('Ver/träge')).toThrow(FolderNameError)
    // The account's own delimiter is what counts, not always a slash
    expect(() => checkFolderName('Ver.träge', '.')).toThrow(FolderNameError)
    expect(checkFolderName('Ver.träge')).toBe('Ver.träge')
  })

  it('refuses control characters', () => {
    expect(() => checkFolderName('Ver\tträge')).toThrow(FolderNameError)
  })

  it('refuses INBOX in any case', () => {
    for (const name of ['INBOX', 'inbox', 'Inbox', 'iNbOx']) {
      expect(() => checkFolderName(name), name).toThrow(/Posteingang/)
    }
  })

  it('builds a path from a parent and a name', () => {
    expect(folderPath(null, 'Verträge')).toBe('Verträge')
    expect(folderPath('2026', 'Verträge')).toBe('2026/Verträge')
    expect(folderPath('2026', 'Verträge', '.')).toBe('2026.Verträge')
  })

  it('knows a folder and its subfolders apart from its neighbours', () => {
    expect(isPathOrChild('2026', '2026')).toBe(true)
    expect(isPathOrChild('2026/Verträge', '2026')).toBe(true)
    // A folder whose name merely starts the same is not a child
    expect(isPathOrChild('2026-Archiv', '2026')).toBe(false)
  })

  it('renames a folder and every subfolder below it', () => {
    expect(renamedPath('2026', '2026', '2027')).toBe('2027')
    expect(renamedPath('2026/Verträge', '2026', '2027')).toBe('2027/Verträge')
    // An unrelated folder keeps its path
    expect(renamedPath('2025', '2026', '2027')).toBe('2025')
  })

  it('protects INBOX and every special-use folder', () => {
    expect(isProtectedFolder({ path: 'INBOX' })).toBe(true)
    expect(isProtectedFolder({ path: 'inbox' })).toBe(true)
    for (const use of ['\\Sent', '\\Drafts', '\\Trash', '\\Archive', '\\Junk']) {
      expect(isProtectedFolder({ path: 'X', specialUse: use }), use).toBe(true)
    }
    // A plain folder may be renamed and deleted
    expect(isProtectedFolder({ path: 'Verträge' })).toBe(false)
  })
})

describe('folder re-key (B1)', () => {
  /** A folder with a few mails, plus a subfolder with one mail */
  function seedTree(store: Store, dir: string) {
    const parent = store.upsertFolder({
      imapPath: 'INBOX.Verträge',
      delimiter: '.',
      uidValidity: '7'
    })
    const child = store.upsertFolder({
      imapPath: 'INBOX.Verträge.2026',
      delimiter: '.',
      uidValidity: '8'
    })
    const insert = (folderId: string, uid: number, validity: string) => {
      const key = store.messageKey(ACCOUNT, folderId, validity, uid)
      const file = `m${folderId.slice(0, 4)}${uid}.eml`
      fs.writeFileSync(path.join(dir, file), 'Subject: x\r\n\r\nx')
      store.insertMessage({
        account_id: ACCOUNT,
        folder_id: folderId,
        uid,
        message_key: key,
        file_path: file,
        message_id: `<${uid}@example.test>`,
        in_reply_to: null,
        references_json: '[]',
        thread_id: null,
        date: '2026-01-01T09:00:00.000Z',
        internal_date: '2026-01-01T09:00:00.000Z',
        subject: `Mail ${uid}`,
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
        snippet: 'x',
        parsed_ok: 1,
        parse_error: null,
        body_text: 'x',
        body_html: null
      } as never)
      return key
    }
    insert(parent.id, 1, '7')
    insert(parent.id, 2, '7')
    insert(child.id, 3, '8')
    return { parent, child }
  }

  it('re-keys the folder, its subfolders and their message keys', () => {
    const { store, dir } = openStore()
    const { child } = seedTree(store, dir)
    const oldKeys = (
      store.db.prepare('SELECT message_key FROM messages').all() as {
        message_key: string
      }[]
    ).map((r) => r.message_key)

    const count = store.rekeyFolder('INBOX.Verträge', 'INBOX.Vertrag', true)
    expect(count).toBe(2)

    // The folder and its subfolder have new paths and new ids
    expect(store.getFolderByPath('INBOX.Vertrag')).toBeTruthy()
    expect(store.getFolderByPath('INBOX.Vertrag.2026')).toBeTruthy()
    expect(store.getFolderByPath('INBOX.Verträge')).toBeUndefined()
    expect(store.getFolderByPath('INBOX.Verträge.2026')).toBeUndefined()
    // A subfolder keeps its own name, only its prefix changed
    expect(store.getFolderByPath('INBOX.Vertrag.2026')!.id).not.toBe(child.id)
    // Every message is still there, under a new key, and points at its new folder
    const rows = store.db.prepare('SELECT message_key, folder_id FROM messages').all() as {
      message_key: string
      folder_id: string
    }[]
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => !oldKeys.includes(r.message_key))).toBe(true)
    const newParent = store.getFolderByPath('INBOX.Vertrag')!
    expect(rows.filter((r) => r.folder_id === newParent.id)).toHaveLength(2)
  })

  it('keeps the mail readable after the re-key', () => {
    const { store, dir } = openStore()
    seedTree(store, dir)
    store.rekeyFolder('INBOX.Verträge', 'INBOX.Vertrag', true)
    // The file is untouched (A3) and the row still finds it
    const row = store.db.prepare('SELECT * FROM messages ORDER BY uid LIMIT 1').get() as {
      file_path: string
    }
    expect(fs.existsSync(store.filePath(row.file_path))).toBe(true)
  })

  it('drops the messages when UIDVALIDITY changed', () => {
    const { store, dir } = openStore()
    seedTree(store, dir)
    store.rekeyFolder('INBOX.Verträge', 'INBOX.Vertrag', false)
    // The normal UIDVALIDITY swap re-downloads them
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 0 })
    expect(store.getFolderByPath('INBOX.Vertrag')).toBeTruthy()
  })

  it('leaves folders outside the subtree alone', () => {
    const { store, dir } = openStore()
    const other = store.upsertFolder({ imapPath: 'INBOX.Archiv', delimiter: '.', uidValidity: '9' })
    seedTree(store, dir)
    store.rekeyFolder('INBOX.Verträge', 'INBOX.Vertrag', true)
    expect(store.getFolderByPath('INBOX.Archiv')!.id).toBe(other.id)
  })

  it('drops a folder row after a delete', () => {
    const { store, dir } = openStore()
    // The core only deletes an empty folder without subfolders, so the leaf is the
    // one that goes; the parent stays.
    const { child } = seedTree(store, dir)
    store.db.prepare('DELETE FROM messages WHERE folder_id = ?').run(child.id)
    store.deleteFolderRow(child.id)
    expect(store.getFolderByPath('INBOX.Verträge.2026')).toBeUndefined()
    expect(store.getFolderByPath('INBOX.Verträge')).toBeTruthy()
  })
})

describe('folder move rules (B2)', () => {
  const known = ['INBOX', 'Projekte', 'Projekte/2026', 'Archiv', 'Archiv/Projekte']

  it('keeps the folder name and only changes the parent', () => {
    expect(folderMoveTarget('Projekte/2026', 'Archiv')).toBe('Archiv/2026')
    expect(folderMoveTarget('Projekte/2026', null)).toBe('2026')
    expect(folderMoveTarget('Projekte', 'Archiv')).toBe('Archiv/Projekte')
  })

  it('refuses a move into itself or its own subfolder', () => {
    expect(folderMoveRefusal('Projekte', 'Projekte', { knownPaths: known })).toMatch(/in sich selbst/)
    expect(folderMoveRefusal('Projekte', 'Projekte/2026', { knownPaths: known })).toMatch(/in sich selbst/)
  })

  it('refuses a name clash in the target', () => {
    expect(folderMoveRefusal('Projekte', 'Archiv', { knownPaths: known })).toMatch(/existiert dort schon/)
  })

  it('refuses a target that does not exist', () => {
    expect(folderMoveRefusal('Projekte', 'Gibt es nicht', { knownPaths: known })).toMatch(/nicht gefunden/)
  })

  it('refuses to move a protected folder', () => {
    expect(folderMoveRefusal('INBOX', 'Archiv', { knownPaths: known })).toMatch(/nicht verschoben/)
    expect(
      folderMoveRefusal('Sent', 'Archiv', { specialUse: '\\Sent', knownPaths: ['Sent', 'Archiv'] })
    ).toMatch(/nicht verschoben/)
  })

  it('allows a move to a free name in an existing folder', () => {
    expect(folderMoveRefusal('Projekte', 'Archiv', { knownPaths: ['Projekte', 'Archiv'] })).toBeNull()
    expect(folderMoveRefusal('Projekte', null, { knownPaths: ['Projekte'] })).toBeNull()
  })
})
