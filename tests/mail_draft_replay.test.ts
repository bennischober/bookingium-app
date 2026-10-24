// A5: the invariant that makes the draft replay probe safe, and the replay itself.
//
// The probe searches Drafts for the draft's Message-ID before appending again. That is only
// safe because EVERY draft save builds a fresh Message-ID (compose.ts uses randomUUID per
// build), so a found id is always THIS attempt's copy and never an older version's.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { composeMime } from '../src/main/mailclient/core/compose'
import { Store, type JournalRow } from '../src/main/mailclient/core/store'
import { WriteEngine } from '../src/main/mailclient/core/write_engine'

const ACCOUNT = 'acc'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const draftInput = {
  to: [{ name: '', email: 'empfaenger@example.test' }],
  cc: [],
  bcc: [],
  subject: 'Ein Entwurf',
  bodyText: 'Hallo',
  bodyHtml: null,
  attachments: [],
  inReplyTo: null,
  references: []
}

describe('draft Message-ID invariant (A5 step 4)', () => {
  it('gives two builds of the same draft different Message-IDs', async () => {
    const opts = {
      from: { name: 'Ich', email: 'ich@example.test' },
      date: new Date('2026-01-01T09:00:00Z'),
      draft: true
    }
    const first = await composeMime(draftInput, opts)
    const second = await composeMime(draftInput, opts)

    expect(first.messageId).not.toBe(second.messageId)
    // The header carries the id the caller gets back, so the probe can find it
    expect(first.raw.toString()).toContain(`Message-ID: <${first.messageId}>`)
  })
})

type Call = { method: string; args: unknown[] }

/** A scripted Drafts mailbox: append, search by Message-ID, fetch, delete */
function stubClient(opts: { searchHits?: number[]; appendedUid?: number; appendFails?: boolean }) {
  const calls: Call[] = []
  const client = {
    capabilities: new Set(['IMAP4rev1', 'UIDPLUS']),
    mailboxOpen: async (mailbox: string) => {
      calls.push({ method: 'mailboxOpen', args: [mailbox] })
      return { uidValidity: 1n, exists: 1 }
    },
    search: async (query: unknown) => {
      calls.push({ method: 'search', args: [query] })
      return opts.searchHits ?? []
    },
    append: async (mailbox: string) => {
      calls.push({ method: 'append', args: [mailbox] })
      if (opts.appendFails) throw new Error('append failed')
      return { uid: opts.appendedUid ?? 99 }
    },
    fetch: (uid: string) => {
      calls.push({ method: 'fetch', args: [uid] })
      return (async function* () {
        yield { uid: Number(uid), flags: new Set(['\\Draft']) }
      })()
    },
    messageDelete: async (uid: string) => {
      calls.push({ method: 'messageDelete', args: [uid] })
      return true
    },
    logout: async () => {
      calls.push({ method: 'logout', args: [] })
    }
  }
  return { client, calls }
}

function openStore(): { store: Store; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-draft-replay-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { store, dir }
}

/** A draft-save op in the journal; `attempts`/`state` model a crash and its replay */
function enqueueDraft(
  store: Store,
  opts: { messageId: string; oldUid?: number; attempts?: number; state?: string }
): JournalRow {
  store.upsertFolder({
    imapPath: 'Entwürfe',
    delimiter: '/',
    specialUse: '\\Drafts',
    uidValidity: '1'
  })
  const id = store.journalEnqueue({
    accountId: ACCOUNT,
    kind: 'draft_save',
    folderPath: 'Entwürfe',
    folderUidValidity: '1',
    messageId: opts.messageId,
    payload: {
      mime: Buffer.from('Subject: x\r\n\r\nHallo\r\n').toString('base64'),
      oldUid: opts.oldUid
    }
  })
  if (opts.attempts || opts.state) {
    store.db
      .prepare('UPDATE op_journal SET attempts = ?, state = ? WHERE id = ?')
      .run(opts.attempts ?? 0, opts.state ?? 'pending', id)
  }
  return store.journalGet(id)!
}

function engineWith(store: Store, client: unknown): WriteEngine {
  const writes = new WriteEngine(store, ACCOUNT)
  const internals = writes as unknown as {
    sandboxClient: () => Promise<unknown>
    execute: (op: JournalRow) => Promise<{ outcome: string; detail?: string }>
  }
  internals.sandboxClient = async () => client
  return writes
}

const run = (writes: WriteEngine, op: JournalRow) =>
  (
    writes as unknown as {
      execute: (o: JournalRow) => Promise<{ outcome: string; detail?: string }>
    }
  ).execute(op)

const appends = (calls: Call[]): number => calls.filter((c) => c.method === 'append').length
const searches = (calls: Call[]): number => calls.filter((c) => c.method === 'search').length

describe('draft replay (A5)', () => {
  it('appends once and removes the old version on a normal save', async () => {
    const { store } = openStore()
    const op = enqueueDraft(store, { messageId: '<neu@example.test>', oldUid: 5 })
    const { client, calls } = stubClient({})

    const result = await run(engineWith(store, client), op)

    expect(result.outcome).toBe('done')
    expect(appends(calls)).toBe(1)
    // the previous version is removed, so exactly one draft remains
    expect(calls.filter((c) => c.method === 'messageDelete').map((c) => c.args[0])).toEqual(['5'])
    expect(JSON.parse(store.journalGet(op.id)!.payload!).appendedUid).toBe(99)
  })

  it('does not append again when a replay finds the draft by Message-ID', async () => {
    const { store } = openStore()
    // A crash after APPEND: the op is back to pending with an attempt behind it and no
    // appendedUid, but the draft is already in the Drafts folder
    const op = enqueueDraft(store, { messageId: '<neu@example.test>', oldUid: 5, attempts: 1 })
    const { client, calls } = stubClient({ searchHits: [42] })

    const result = await run(engineWith(store, client), op)

    expect(result.outcome).toBe('done')
    // The probe found it, so no second APPEND happened
    expect(searches(calls)).toBe(1)
    expect(appends(calls)).toBe(0)
    // ... and the old version was still removed
    expect(calls.filter((c) => c.method === 'messageDelete').map((c) => c.args[0])).toEqual(['5'])
    expect(JSON.parse(store.journalGet(op.id)!.payload!).appendedUid).toBe(42)
  })

  it('appends normally on a replay when the probe finds nothing', async () => {
    const { store } = openStore()
    const op = enqueueDraft(store, { messageId: '<neu@example.test>', attempts: 1 })
    const { client, calls } = stubClient({ searchHits: [] })

    const result = await run(engineWith(store, client), op)

    expect(result.outcome).toBe('done')
    expect(searches(calls)).toBe(1)
    expect(appends(calls)).toBe(1)
  })

  it('does not probe on the first attempt', async () => {
    const { store } = openStore()
    const op = enqueueDraft(store, { messageId: '<neu@example.test>' })
    const { client, calls } = stubClient({ searchHits: [7] })

    const result = await run(engineWith(store, client), op)

    expect(result.outcome).toBe('done')
    expect(searches(calls)).toBe(0)
    expect(appends(calls)).toBe(1)
  })
})
