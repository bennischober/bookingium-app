// B4: a move of N mails is one op per (source, target) group, one UID MOVE, and one
// undo - not N round trips. The tests drive the engine through a stubbed connection
// (the real guard and the real IMAP server are exercised in the e2e suite).
import { sandboxWriteAccount, sandboxCredentials } from './helpers/writeAccount'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store, type JournalRow } from '../src/main/mailclient/core/store'
import { WriteEngine } from '../src/main/mailclient/core/write_engine'

const ACCOUNT = 'acc'
const INBOX = { id: 'f-inbox', path: 'INBOX', uidValidity: '1' }
const ARCHIVE = { id: 'f-arch', path: 'Archiv', uidValidity: '9' }

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function openStore(): { store: Store; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-batch-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { store, dir }
}

function seedFolders(store: Store): void {
  store.db
    .prepare(
      `INSERT INTO folders (id, account_id, imap_path, delimiter, special_use, uid_validity)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(INBOX.id, ACCOUNT, INBOX.path, '/', '\\Inbox', INBOX.uidValidity)
  store.db
    .prepare(
      `INSERT INTO folders (id, account_id, imap_path, delimiter, special_use, uid_validity)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(ARCHIVE.id, ACCOUNT, ARCHIVE.path, '/', null, ARCHIVE.uidValidity)
}

/** One mail in INBOX with a distinct uid, key, size and Message-ID */
function seedMessage(
  store: Store,
  dir: string,
  n: number
): { id: number; key: string; uid: number } {
  const uid = n
  const key = store.messageKey(ACCOUNT, INBOX.id, INBOX.uidValidity, uid)
  const file = `m${n}.eml`
  fs.writeFileSync(path.join(dir, file), 'Subject: x\r\n\r\nx')
  const id = store.insertMessage({
    account_id: ACCOUNT,
    folder_id: INBOX.id,
    uid,
    message_key: key,
    file_path: file,
    message_id: `<${n}@example.test>`,
    in_reply_to: null,
    references_json: '[]',
    thread_id: null,
    date: '2026-01-01T09:00:00.000Z',
    internal_date: '2026-01-01T09:00:00.000Z',
    subject: `Mail ${n}`,
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
  } as never) as number
  return { id, key, uid }
}

type Call = { method: string; args: unknown[] }

/** A connection stub: MOVE maps every uid to a fresh uid at the target */
function stubClient(capabilities: string[], options: { uidMap?: Map<number, number> } = {}) {
  const calls: Call[] = []
  const known = new Map<number, { size: number; internalDate: Date }>()
  const client = {
    capabilities: new Set(capabilities),
    known,
    mailboxOpen: async (mailbox: string) => {
      calls.push({ method: 'mailboxOpen', args: [mailbox] })
      return { uidValidity: mailbox === ARCHIVE.path ? 9n : 1n, exists: known.size }
    },
    fetch: (seq: string) => {
      calls.push({ method: 'fetch', args: [seq] })
      const uids = seq.split(',').map(Number)
      const items = uids
        .filter((u) => known.has(u))
        .map((u) => ({
          uid: u,
          size: known.get(u)!.size,
          internalDate: known.get(u)!.internalDate,
          flags: new Set<string>()
        }))
      return (async function* () {
        for (const i of items) yield i
      })()
    },
    search: async (query: unknown) => {
      calls.push({ method: 'search', args: [query] })
      return []
    },
    messageMove: async (seq: string, target: string) => {
      calls.push({ method: 'messageMove', args: [seq, target] })
      const uids = seq.split(',').map(Number)
      const uidMap = options.uidMap ?? new Map(uids.map((u, i) => [u, 1000 + i]))
      return { uidMap }
    },
    messageCopy: async () => {
      calls.push({ method: 'messageCopy', args: [] })
      return { uidMap: new Map() }
    },
    status: async (mailbox: string) => {
      calls.push({ method: 'status', args: [mailbox] })
      return { path: mailbox, uidNext: 1000 }
    },
    messageFlagsAdd: async () => {
      calls.push({ method: 'messageFlagsAdd', args: [] })
      return true
    },
    messageDelete: async () => {
      calls.push({ method: 'messageDelete', args: [] })
      return true
    },
    logout: async () => undefined
  }
  return { client, calls }
}

/** A WriteEngine whose connection is the stub */
function engineWith(store: Store, client: unknown): WriteEngine {
  const writes = new WriteEngine(store, ACCOUNT, {
    writeAccount: sandboxWriteAccount(),
    credentials: sandboxCredentials
  })
  ;(writes as unknown as { writeClient: () => Promise<unknown> }).writeClient = async () => client
  return writes
}

const run = (writes: WriteEngine, op: JournalRow) =>
  (
    writes as unknown as {
      execute: (o: JournalRow) => Promise<{ outcome: string; detail?: string; reason?: string }>
    }
  ).execute(op)

/** The batch op a group of mails produces */
function batchOp(store: Store, members: { key: string; uid: number }[]): JournalRow {
  const id = store.journalEnqueue({
    accountId: ACCOUNT,
    kind: 'move_batch',
    folderPath: INBOX.path,
    folderUidValidity: INBOX.uidValidity,
    targetFolderPath: ARCHIVE.path,
    payload: {
      members: members.map((m) => ({
        uid: m.uid,
        messageKey: m.key,
        messageId: `<${m.uid}@example.test>`
      }))
    }
  })
  return store.journalGet(id)!
}

describe('batch move in one UID MOVE (B4)', () => {
  it('moves 50 mails with a single MOVE call and records every new uid', async () => {
    const { store, dir } = openStore()
    seedFolders(store)
    const mails = Array.from({ length: 50 }, (_, i) => seedMessage(store, dir, i + 1))
    const op = batchOp(
      store,
      mails.map((m) => ({ key: m.key, uid: m.uid }))
    )
    const { client, calls } = stubClient(['IMAP4rev1', 'MOVE', 'UIDPLUS'])
    for (const m of mails)
      client.known.set(m.uid, { size: 30, internalDate: new Date('2026-01-01T09:00:00.000Z') })

    const result = await run(engineWith(store, client), op)
    expect(result.outcome).toBe('done')

    // Exactly one UID MOVE, with all 50 uids in one set
    const moves = calls.filter((c) => c.method === 'messageMove')
    expect(moves).toHaveLength(1)
    expect(String(moves[0].args[0]).split(',')).toHaveLength(50)
    expect(moves[0].args[1]).toBe(ARCHIVE.path)
    // One FETCH for the whole set, not one per mail
    expect(calls.filter((c) => c.method === 'fetch')).toHaveLength(1)

    // Every row is in the target, keyed by its COPYUID uid
    const rows = store.db
      .prepare('SELECT folder_id, uid, message_key FROM messages ORDER BY uid')
      .all() as { folder_id: string; uid: number; message_key: string }[]
    expect(rows).toHaveLength(50)
    expect(rows.every((r) => r.folder_id === ARCHIVE.id)).toBe(true)
    expect(rows.map((r) => r.uid)).toEqual(Array.from({ length: 50 }, (_, i) => 1000 + i))
    expect(rows[0].message_key).toBe(store.messageKey(ACCOUNT, ARCHIVE.id, '9', 1000))

    // The mapping is durable, so a crash after this point resumes without a server call
    const payload = JSON.parse(store.journalGet(op.id)!.payload || '{}') as {
      movedTo?: { destUid: number }[]
    }
    expect(payload.movedTo).toHaveLength(50)
  })

  it('undoes the whole group as one op', async () => {
    const { store, dir } = openStore()
    seedFolders(store)
    const mails = Array.from({ length: 50 }, (_, i) => seedMessage(store, dir, i + 1))
    const op = batchOp(
      store,
      mails.map((m) => ({ key: m.key, uid: m.uid }))
    )
    const { client } = stubClient(['IMAP4rev1', 'MOVE', 'UIDPLUS'])
    for (const m of mails)
      client.known.set(m.uid, { size: 30, internalDate: new Date('2026-01-01T09:00:00.000Z') })
    expect((await run(engineWith(store, client), op)).outcome).toBe('done')

    // The inverse op carries every member, so the undo is one UID MOVE again.
    // This is exactly what MailCore.undoOp builds for a move_batch op.
    const done = store.journalGet(op.id)!
    const moved = JSON.parse(done.payload || '{}') as { movedTo: { messageKey: string }[] }
    expect(moved.movedTo).toHaveLength(50)

    // Undo finds each row by the key the MOVE gave it (newKey), not the source key
    const members = moved.movedTo.map((m) => {
      expect(m.newKey, 'the new key is recorded').toBe(
        store.messageKey(ACCOUNT, ARCHIVE.id, ARCHIVE.uidValidity, m.destUid)
      )
      const row = store.db
        .prepare('SELECT uid FROM messages WHERE message_key = ?')
        .get(m.newKey!) as { uid: number }
      return { uid: row.uid, messageKey: m.newKey!, messageId: null as string | null }
    })
    expect(members).toHaveLength(50)
    const inverseId = store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'move_batch',
      folderPath: ARCHIVE.path,
      folderUidValidity: ARCHIVE.uidValidity,
      targetFolderPath: INBOX.path,
      payload: { members }
    })
    // A move back needs the Archive UIDs to exist on the stub, and INBOX to be the
    // mailbox whose uidvalidity the op was created against.
    for (const m of members)
      client.known.set(m.uid, { size: 30, internalDate: new Date('2026-01-01T09:00:00.000Z') })
    const back = await run(engineWith(store, client), store.journalGet(inverseId)!)
    expect(back.outcome).toBe('done')

    const rows = store.db.prepare('SELECT folder_id FROM messages').all() as {
      folder_id: string
    }[]
    expect(rows.every((r) => r.folder_id === INBOX.id)).toBe(true)
  })

  it('refuses when the server has no MOVE, before touching anything', async () => {
    const { store, dir } = openStore()
    seedFolders(store)
    const mails = Array.from({ length: 3 }, (_, i) => seedMessage(store, dir, i + 1))
    const op = batchOp(
      store,
      mails.map((m) => ({ key: m.key, uid: m.uid }))
    )
    const { client, calls } = stubClient(['IMAP4rev1', 'UIDPLUS'])
    for (const m of mails)
      client.known.set(m.uid, { size: 30, internalDate: new Date('2026-01-01T09:00:00.000Z') })

    const result = await run(engineWith(store, client), op)
    expect(result.outcome).toBe('conflict')
    expect(result.reason).toMatch(/no MOVE/)
    // Nothing was copied, moved or deleted
    expect(
      calls.filter((c) => /messageMove|messageCopy|messageDelete/.test(c.method))
    ).toHaveLength(0)
  })

  it('refuses when COPYUID is missing instead of guessing the new uids', async () => {
    const { store, dir } = openStore()
    seedFolders(store)
    const mails = Array.from({ length: 3 }, (_, i) => seedMessage(store, dir, i + 1))
    const op = batchOp(
      store,
      mails.map((m) => ({ key: m.key, uid: m.uid }))
    )
    // A server that answers the MOVE without a uid map
    const { client } = stubClient(['IMAP4rev1', 'MOVE', 'UIDPLUS'], { uidMap: new Map() })
    for (const m of mails)
      client.known.set(m.uid, { size: 30, internalDate: new Date('2026-01-01T09:00:00.000Z') })

    const result = await run(engineWith(store, client), op)
    expect(result.outcome).toBe('conflict')
    expect(result.reason).toMatch(/COPYUID/)
    // The rows stay where they were: no guessed uid was written
    const rows = store.db.prepare('SELECT folder_id FROM messages').all() as { folder_id: string }[]
    expect(rows.every((r) => r.folder_id === INBOX.id)).toBe(true)
  })

  it('refuses when one mail of the group vanished from the server', async () => {
    const { store, dir } = openStore()
    seedFolders(store)
    const mails = Array.from({ length: 3 }, (_, i) => seedMessage(store, dir, i + 1))
    const op = batchOp(
      store,
      mails.map((m) => ({ key: m.key, uid: m.uid }))
    )
    const { client, calls } = stubClient(['IMAP4rev1', 'MOVE', 'UIDPLUS'])
    // Only two of the three exist on the server
    for (const m of mails.slice(0, 2))
      client.known.set(m.uid, { size: 30, internalDate: new Date('2026-01-01T09:00:00.000Z') })

    const result = await run(engineWith(store, client), op)
    expect(result.outcome).toBe('conflict')
    expect(result.reason).toMatch(/vanished/)
    expect(calls.filter((c) => c.method === 'messageMove')).toHaveLength(0)
  })

  it('finds a crashed batch at the target by Message-ID and updates the rows', async () => {
    const { store, dir } = openStore()
    seedFolders(store)
    const mails = Array.from({ length: 2 }, (_, i) => seedMessage(store, dir, i + 1))
    const op = batchOp(
      store,
      mails.map((m) => ({ key: m.key, uid: m.uid }))
    )
    // The MOVE happened on the server, the crash came before the journal update: the
    // source uids are gone, the mails are at the target under other uids. The run that crashed
    // recorded the target's UIDNEXT first (I15a, MR-32).
    const payload = JSON.parse(store.journalGet(op.id)!.payload || '{}') as Record<string, unknown>
    store.journalUpdate(op.id, { payload: { ...payload, targetUidNext: 2000 } })
    const { client } = stubClient(['IMAP4rev1', 'MOVE', 'UIDPLUS'])
    client.search = (async (query: { header?: Record<string, string> }) => {
      const id = query.header?.['message-id']
      const n = Number(String(id).replace(/[^0-9]/g, ''))
      return [2000 + n]
    }) as never

    const result = await run(engineWith(store, client), store.journalGet(op.id)!)
    expect(result.outcome).toBe('done')
    expect(result.detail).toMatch(/resumed/)

    const rows = store.db.prepare('SELECT folder_id, uid FROM messages ORDER BY uid').all() as {
      folder_id: string
      uid: number
    }[]
    expect(rows.every((r) => r.folder_id === ARCHIVE.id)).toBe(true)
    expect(rows.map((r) => r.uid)).toEqual([2001, 2002])
  })

  // I15a (MR-32): the resume used to search after ANY preflight failure and take found[0], so a
  // copy that was already at the target (a list mail, a CC duplicate) marked the op done
  describe('I15a: the resume needs proof that this move happened', () => {
    /** A crashed batch whose run recorded the target's UIDNEXT, and a target search answer */
    function crashed(found: (n: number) => number[], targetUidNext: number | null = 2000) {
      const { store, dir } = openStore()
      seedFolders(store)
      const mails = Array.from({ length: 2 }, (_, i) => seedMessage(store, dir, i + 1))
      const op = batchOp(
        store,
        mails.map((m) => ({ key: m.key, uid: m.uid }))
      )
      if (targetUidNext !== null) {
        const payload = JSON.parse(store.journalGet(op.id)!.payload || '{}') as Record<
          string,
          unknown
        >
        store.journalUpdate(op.id, { payload: { ...payload, targetUidNext } })
      }
      const { client, calls } = stubClient(['IMAP4rev1', 'MOVE', 'UIDPLUS'])
      client.search = (async (query: { header?: Record<string, string> }) => {
        calls.push({ method: 'search', args: [query] })
        return found(Number(String(query.header?.['message-id']).replace(/[^0-9]/g, '')))
      }) as never
      return { store, mails, op: store.journalGet(op.id)!, client, calls }
    }

    const stayed = (store: Store): boolean =>
      (store.db.prepare('SELECT folder_id FROM messages').all() as { folder_id: string }[]).every(
        (r) => r.folder_id === INBOX.id
      )

    it('does not search while a source uid is still there', async () => {
      const { store, mails, op, client, calls } = crashed((n) => [2000 + n])
      client.known.set(mails[0].uid, {
        size: 30,
        internalDate: new Date('2026-01-01T09:00:00.000Z')
      })
      const result = await run(engineWith(store, client), op)
      expect(result.outcome).toBe('conflict')
      expect(calls.filter((c) => c.method === 'search')).toHaveLength(0)
      expect(stayed(store)).toBe(true)
    })

    it('does not take a copy that was there before the move', async () => {
      const { store, op, client } = crashed((n) => (n === 1 ? [1500] : [2002]))
      const result = await run(engineWith(store, client), op)
      expect(result.outcome).toBe('conflict')
      expect(stayed(store)).toBe(true)
    })

    it('does not guess between two arrivals', async () => {
      const { store, op, client } = crashed((n) => (n === 1 ? [2001, 2007] : [2002]))
      expect((await run(engineWith(store, client), op)).outcome).toBe('conflict')
      expect(stayed(store)).toBe(true)
    })

    it('does not map two members to one uid', async () => {
      const { store, op, client } = crashed(() => [2005])
      expect((await run(engineWith(store, client), op)).outcome).toBe('conflict')
      expect(stayed(store)).toBe(true)
    })

    it('does not resume when a member has no Message-ID', async () => {
      const { store, op, client } = crashed((n) => [2000 + n])
      const payload = JSON.parse(op.payload || '{}') as {
        members: { messageId?: string }[]
      }
      delete payload.members[1].messageId
      store.journalUpdate(op.id, { payload })
      const result = await run(engineWith(store, client), store.journalGet(op.id)!)
      expect(result.outcome).toBe('conflict')
      expect(stayed(store)).toBe(true)
    })

    it('does not resume an op from before the UIDNEXT was recorded', async () => {
      const { store, op, client } = crashed((n) => [2000 + n], null)
      expect((await run(engineWith(store, client), op)).outcome).toBe('conflict')
      expect(stayed(store)).toBe(true)
    })

    it('records the target UIDNEXT before the MOVE', async () => {
      const { store, dir } = openStore()
      seedFolders(store)
      const mails = Array.from({ length: 2 }, (_, i) => seedMessage(store, dir, i + 1))
      const op = batchOp(
        store,
        mails.map((m) => ({ key: m.key, uid: m.uid }))
      )
      const { client, calls } = stubClient(['IMAP4rev1', 'MOVE', 'UIDPLUS'])
      for (const m of mails)
        client.known.set(m.uid, { size: 30, internalDate: new Date('2026-01-01T09:00:00.000Z') })
      expect((await run(engineWith(store, client), op)).outcome).toBe('done')
      const methods = calls.map((c) => c.method)
      expect(methods.indexOf('status')).toBeGreaterThan(-1)
      expect(methods.indexOf('status')).toBeLessThan(methods.indexOf('messageMove'))
      const payload = JSON.parse(store.journalGet(op.id)!.payload || '{}') as {
        targetUidNext?: number
      }
      expect(payload.targetUidNext).toBe(1000)
    })
  })

  it('resumes locally when the mapping was already recorded before the crash', async () => {
    const { store, dir } = openStore()
    seedFolders(store)
    const mails = Array.from({ length: 2 }, (_, i) => seedMessage(store, dir, i + 1))
    const op = batchOp(
      store,
      mails.map((m) => ({ key: m.key, uid: m.uid }))
    )
    const payload = JSON.parse(store.journalGet(op.id)!.payload || '{}') as Record<string, unknown>
    store.journalUpdate(op.id, {
      payload: {
        ...payload,
        movedTo: mails.map((m, i) => ({ uid: m.uid, messageKey: m.key, destUid: 3000 + i }))
      }
    })
    const { client, calls } = stubClient(['IMAP4rev1', 'MOVE', 'UIDPLUS'])

    const result = await run(engineWith(store, client), store.journalGet(op.id)!)
    expect(result.outcome).toBe('done')
    // No server contact at all: the mapping was durable
    expect(calls.filter((c) => c.method === 'messageMove')).toHaveLength(0)
    const rows = store.db.prepare('SELECT folder_id, uid FROM messages ORDER BY uid').all() as {
      folder_id: string
      uid: number
    }[]
    expect(rows.map((r) => r.uid)).toEqual([3000, 3001])
  })
})
