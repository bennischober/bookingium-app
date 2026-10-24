// A2b: a server without MOVE and without UIDPLUS cannot move a single message safely.
// imapflow's messageDelete degrades to a plain EXPUNGE without UIDPLUS, which removes every
// \Deleted message in the mailbox - including ones another client flagged. The write path
// must refuse BEFORE copying anything, and the crash-resume path must refuse too.
//
// The engine is driven through a stubbed sandbox client (the real guard is exercised for
// real in the e2e suite; here only the capability decision and the mailbox selection are
// under test).
import { sandboxWriteAccount, sandboxCredentials } from './helpers/writeAccount'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store, type JournalRow } from '../src/main/mailclient/core/store'
import { WriteEngine } from '../src/main/mailclient/core/write_engine'

const ACCOUNT = 'acc'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function openStore(): { store: Store; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-uidplus-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { store, dir }
}

type Call = { method: string; args: unknown[] }

/**
 * A stand-in for the IMAP connection with a fixed capability set. Records every call so a
 * test can prove that no copy/delete/expunge happened before a refusal.
 */
function stubClient(capabilities: string[]) {
  const calls: Call[] = []
  const client = {
    capabilities: new Set(capabilities),
    mailboxOpen: async (mailbox: string) => {
      calls.push({ method: 'mailboxOpen', args: [mailbox] })
      return { uidValidity: 1n, exists: 1 }
    },
    fetch: (_seq: string) => {
      calls.push({ method: 'fetch', args: [_seq] })
      // preflight: exactly one message, matching size/internalDate
      const items = [
        {
          uid: 1,
          size: 30,
          internalDate: new Date('2026-01-01T09:00:00.000Z'),
          flags: new Set<string>()
        }
      ]
      return (async function* () {
        for (const i of items) yield i
      })()
    },
    search: async () => {
      calls.push({ method: 'search', args: [] })
      return []
    },
    messageMove: async () => {
      calls.push({ method: 'messageMove', args: [] })
      return { uidMap: new Map([[1, 2]]) }
    },
    messageCopy: async () => {
      calls.push({ method: 'messageCopy', args: [] })
      return { uidMap: new Map([[1, 2]]) }
    },
    messageFlagsAdd: async () => {
      calls.push({ method: 'messageFlagsAdd', args: [] })
      return true
    },
    messageDelete: async () => {
      calls.push({ method: 'messageDelete', args: [] })
      return true
    },
    logout: async () => {
      calls.push({ method: 'logout', args: [] })
    }
  }
  return { client, calls }
}

/** A store with INBOX + Archive and one message in INBOX, ready for a move op */
function seed(store: Store, dir: string): { op: JournalRow; messageKey: string } {
  const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
  store.upsertFolder({ imapPath: 'Archiv', delimiter: '/', uidValidity: '1' })
  const messageKey = 'key-1'
  const file = `${messageKey}.eml`
  fs.writeFileSync(path.join(dir, file), 'Subject: x\r\n\r\nbody\r\n')
  store.insertMessage({
    account_id: ACCOUNT,
    folder_id: inbox.id,
    uid: 1,
    message_key: messageKey,
    file_path: file,
    message_id: '<1@example.test>',
    in_reply_to: null,
    references_json: '[]',
    thread_id: null,
    date: '2026-01-01T09:00:00.000Z',
    internal_date: '2026-01-01T09:00:00.000Z',
    subject: 'x',
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
  })
  const id = store.journalEnqueue({
    accountId: ACCOUNT,
    kind: 'move',
    folderPath: 'INBOX',
    folderUidValidity: '1',
    uid: 1,
    messageKey,
    messageId: '<1@example.test>',
    targetFolderPath: 'Archiv'
  })
  return { op: store.journalGet(id)!, messageKey }
}

/** A WriteEngine whose connection is the stub (the guard is not under test here) */
function engineWith(store: Store, client: unknown): WriteEngine {
  const writes = new WriteEngine(store, ACCOUNT, { writeAccount: sandboxWriteAccount(), credentials: sandboxCredentials })
  const internals = writes as unknown as {
    writeClient: () => Promise<unknown>
    execute: (op: JournalRow) => Promise<{ outcome: string; reason?: string }>
  }
  internals.writeClient = async () => client
  return writes
}

const run = (writes: WriteEngine, op: JournalRow) =>
  (
    writes as unknown as {
      execute: (o: JournalRow) => Promise<{ outcome: string; reason?: string }>
    }
  ).execute(op)

describe('move on a server without MOVE or UIDPLUS (A2b)', () => {
  it('refuses before copying when the server has neither MOVE nor UIDPLUS', async () => {
    const { store, dir } = openStore()
    const { op } = seed(store, dir)
    const { client, calls } = stubClient(['IMAP4rev1'])

    const result = await run(engineWith(store, client), op)

    expect(result.outcome).toBe('conflict')
    expect(result.reason).toMatch(/neither MOVE nor UIDPLUS/)
    // Nothing was copied, moved or deleted - the refusal comes first
    expect(calls.map((c) => c.method)).not.toContain('messageCopy')
    expect(calls.map((c) => c.method)).not.toContain('messageMove')
    expect(calls.map((c) => c.method)).not.toContain('messageDelete')
  })

  it('moves with MOVE alone (no UIDPLUS needed)', async () => {
    const { store, dir } = openStore()
    const { op } = seed(store, dir)
    const { client, calls } = stubClient(['IMAP4rev1', 'MOVE'])

    const result = await run(engineWith(store, client), op)

    expect(result.outcome).toBe('done')
    expect(calls.map((c) => c.method)).toContain('messageMove')
  })

  it('falls back to copy + UID EXPUNGE when the server has UIDPLUS but no MOVE', async () => {
    const { store, dir } = openStore()
    const { op } = seed(store, dir)
    const { client, calls } = stubClient(['IMAP4rev1', 'UIDPLUS'])

    const result = await run(engineWith(store, client), op)

    expect(result.outcome).toBe('done')
    const methods = calls.map((c) => c.method)
    expect(methods).toContain('messageCopy')
    expect(methods).toContain('messageDelete')
  })

  it('resumes a half-done copy by looking in the TARGET mailbox, not the source', async () => {
    const { store, dir } = openStore()
    const { op } = seed(store, dir)
    // A previous attempt recorded the copy: the destination uid is 2
    store.journalUpdate(op.id, { payload: { copiedTo: { uid: 2 } } })
    const resumedOp = store.journalGet(op.id)!

    const opened: string[] = []
    // UIDPLUS but no MOVE: the fallback (copy + UID EXPUNGE) is allowed to finish
    const { client, calls } = stubClient(['IMAP4rev1', 'UIDPLUS'])
    const fetchUids: string[] = []
    const stubbed = {
      ...client,
      mailboxOpen: async (mailbox: string) => {
        opened.push(mailbox)
        return { uidValidity: 1n, exists: 1 }
      },
      fetch: (seq: string) => {
        fetchUids.push(seq)
        // The source (uid 1) is in INBOX; the copied mail (uid 2) is only in Archiv
        const selected = opened[opened.length - 1]
        const present =
          (selected === 'INBOX' && seq === '1') || (selected === 'Archiv' && seq === '2')
        return (async function* () {
          if (present) {
            yield {
              uid: Number(seq),
              size: 30,
              internalDate: new Date('2026-01-01T09:00:00.000Z'),
              flags: new Set<string>()
            }
          }
        })()
      }
    }

    const result = await run(engineWith(store, stubbed), resumedOp)

    expect(result.outcome).toBe('done')
    // The resume looked for the copied uid in Archiv, then went back to INBOX for the delete
    expect(fetchUids).toContain('2')
    expect(opened).toContain('Archiv')
    expect(opened[opened.length - 1]).toBe('INBOX')
    // It did not copy again
    expect(calls.map((c) => c.method)).not.toContain('messageCopy')
  })

  it('refuses a half-done copy instead of a plain EXPUNGE when UIDPLUS is missing', async () => {
    const { store, dir } = openStore()
    const { op } = seed(store, dir)
    store.journalUpdate(op.id, { payload: { copiedTo: { uid: 2 } } })
    const resumedOp = store.journalGet(op.id)!

    // MOVE but no UIDPLUS: the copy is found, but deleting the source would need a
    // plain EXPUNGE, so the fallback refuses and nothing is destroyed
    const { client, calls } = stubClient(['IMAP4rev1', 'MOVE'])
    const stubbed = {
      ...client,
      fetch: (seq: string) => {
        const present = seq === '1' || seq === '2'
        return (async function* () {
          if (present) {
            yield {
              uid: Number(seq),
              size: 30,
              internalDate: new Date('2026-01-01T09:00:00.000Z'),
              flags: new Set<string>()
            }
          }
        })()
      }
    }

    const result = await run(engineWith(store, stubbed), resumedOp)

    expect(result.outcome).toBe('conflict')
    expect(result.reason).toMatch(/no UIDPLUS/)
    expect(calls.map((c) => c.method)).not.toContain('messageDelete')
  })
})
