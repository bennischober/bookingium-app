// S1 step 3: the download pass stores a message above `lazyAboveBytes` as its skeleton, against a
// scripted server. The skeleton itself is proven against Dovecot in mail_skeleton_sandbox.test.ts;
// here it is the wiring: which UIDs are fetched whole, the partial row (server size, estimated
// attachment sizes, `complete = 0`), the fallback for a structure without a skeleton, the progress
// bytes, and that an account without the option fetches exactly as before.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MessageStructureObject } from 'imapflow'
import { Store, type MessageRow } from '../src/main/mailclient/core/store'
import {
  LAZY_ABOVE_BYTES,
  makeLiveAccount,
  makeReadOnlyAccount,
  makeSandboxAccount,
  SyncEngine,
  type AccountConfig
} from '../src/main/mailclient/core/sync'

const ACCOUNT = 'acc'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function scratchDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-partial-ingest-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const crlf = (s: string): Buffer => Buffer.from(s.replace(/\r?\n/g, '\r\n'))
const HEAD =
  'From: a@example.test\nTo: b@example.test\nMessage-ID: <m@example.test>\nDate: Tue, 27 Oct 2026 10:00:00 +0100\nMIME-Version: 1.0\n'

/** One message on the scripted server: what a whole fetch returns, and what the skeleton fetch does */
interface ServerMessage {
  size: number
  source: Buffer
  structure: MessageStructureObject
  header?: Buffer
  sections?: Record<string, Buffer>
}

const small: ServerMessage = {
  size: 200,
  source: crlf(`${HEAD}Subject: klein\nContent-Type: text/plain\n\nKurz.\n`),
  structure: { type: 'text/plain', size: 7 } as MessageStructureObject
}

const largeHeader = crlf(`${HEAD}Subject: gross\nContent-Type: multipart/mixed; boundary="o"\n\n`)
const large: ServerMessage = {
  size: 7_900_000,
  // the whole source only matters to the pass without a threshold
  source: crlf(
    `${HEAD}Subject: gross\nContent-Type: multipart/mixed; boundary="o"\n\n--o\nContent-Type: text/plain\n\nHallo\n` +
      '--o\nContent-Type: application/pdf\nContent-Transfer-Encoding: base64\nContent-Disposition: attachment; filename="gross.pdf"\n\nAAAA\n--o--\n'
  ),
  structure: {
    type: 'multipart/mixed',
    parameters: { boundary: 'o' },
    childNodes: [
      { part: '1', type: 'text/plain', encoding: '7bit', size: 5 },
      {
        part: '2',
        type: 'application/pdf',
        encoding: 'base64',
        size: 7_800_000,
        disposition: 'attachment'
      }
    ]
  } as MessageStructureObject,
  header: largeHeader,
  // imapflow may hand section keys back in lower case
  sections: {
    '1.mime': crlf('Content-Type: text/plain\n\n'),
    '1': Buffer.from('Hallo'),
    '2.mime': crlf(
      'Content-Type: application/pdf\nContent-Transfer-Encoding: base64\nContent-Disposition: attachment; filename="gross.pdf"\n\n'
    )
  }
}

/** Large, but a multipart without a boundary: no skeleton, so it is downloaded whole */
const uncovered: ServerMessage = {
  ...small,
  size: 6_000_000,
  source: crlf(`${HEAD}Subject: ohne\nContent-Type: text/plain\n\nGanz.\n`),
  structure: {
    type: 'multipart/mixed',
    childNodes: [{ part: '1', type: 'text/plain' }]
  } as MessageStructureObject
}

type Query = { source?: boolean; bodyStructure?: boolean; headers?: boolean; bodyParts?: string[] }

/** A server holding `messages` by UID; it records every query and the UIDs whose whole source it sent */
function scriptedClient(messages: Record<number, ServerMessage>) {
  const queries: Query[] = []
  const wholeSent: number[] = []
  const base = (uid: number) => ({
    uid,
    flags: new Set<string>(),
    internalDate: new Date('2026-10-27T09:00:00Z'),
    size: messages[uid].size
  })
  const answer = (uid: number, query: Query) => {
    const m = messages[uid]
    if (query.source) wholeSent.push(uid)
    return {
      ...base(uid),
      ...(query.source ? { source: m.source } : {}),
      ...(query.bodyStructure ? { bodyStructure: m.structure } : {}),
      ...(query.headers ? { headers: m.header } : {}),
      ...(query.bodyParts
        ? {
            bodyParts: new Map(
              query.bodyParts
                .filter((s) => m.sections?.[s.toLowerCase()])
                .map((s) => [s.toLowerCase(), m.sections![s.toLowerCase()]])
            )
          }
        : {})
    }
  }
  const client = {
    mailbox: false,
    async *fetch(range: string, query: Query) {
      queries.push(query)
      const want = new Set(range.split(',').flatMap(rangeUids))
      for (const uid of Object.keys(messages).map(Number))
        if (want.has(uid)) yield answer(uid, query)
    },
    async fetchOne(uid: string, query: Query) {
      queries.push(query)
      return answer(Number(uid), query)
    }
  }
  return { client, queries, wholeSent }
}

function rangeUids(part: string): number[] {
  const [a, b] = part.split(':').map(Number)
  return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i)
}

type Client = ReturnType<typeof scriptedClient>['client']
type Internals = {
  downloadMessages(
    client: Client,
    uids: number[],
    imapPath: string,
    folderId: string,
    uidValidity: string
  ): Promise<number>
  getStatus(): { bytesDone: number }
}

function setup(lazyAboveBytes?: number) {
  const dir = scratchDir()
  const store = new Store(dir, ACCOUNT, Date.now, {})
  cleanups.push(() => store.close())
  const config: AccountConfig = {
    id: ACCOUNT,
    host: '127.0.0.1',
    port: 10199,
    security: 'none',
    user: 'u',
    pass: 'p',
    readOnly: false,
    dataDir: dir,
    lazyAboveBytes
  }
  const engine = new SyncEngine(config, store, { log: {} }) as unknown as Internals
  const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '7' })
  const row = (uid: number): MessageRow =>
    store.getByKey(store.messageKey(ACCOUNT, inbox.id, '7', uid))!
  return { store, engine, inbox, row }
}

describe('S1: partial ingest in the download pass', () => {
  it('stores a message above the threshold as its skeleton, the others whole', async () => {
    const { store, engine, inbox, row } = setup(5_000_000)
    const { client, wholeSent } = scriptedClient({ 1: small, 2: large, 3: uncovered })

    expect(await engine.downloadMessages(client, [1, 2, 3], 'INBOX', inbox.id, '7')).toBe(3)

    // the small one in the batch fetch, the uncovered one on its own, the large one never
    expect(wholeSent).toEqual([1, 3])
    expect([row(1).complete, row(2).complete, row(3).complete]).toEqual([1, 0, 1])

    const partial = row(2)
    expect(partial.size_bytes).toBe(7_900_000)
    expect(partial.subject).toBe('gross')
    expect(partial.body_text.trim()).toBe('Hallo')
    expect(partial.has_attachments).toBe(1)
    expect(JSON.parse(partial.attachments_json)).toEqual([
      expect.objectContaining({ partId: '2', filename: 'gross.pdf', size: 5_700_000 })
    ])
    const skeletonBytes = fs.statSync(store.filePath(partial.file_path)).size
    expect(skeletonBytes).toBeLessThan(1000)
    // the uncovered message keeps the file's size, as every whole one does
    expect(row(3).size_bytes).toBe(uncovered.source.length)

    // progress counts what came over the wire
    expect(engine.getStatus().bytesDone).toBe(
      small.source.length + skeletonBytes + uncovered.source.length
    )
  })

  it('keeps a message at the threshold whole', async () => {
    const { engine, inbox, row } = setup(large.size)
    const { client, wholeSent } = scriptedClient({ 2: large })
    await engine.downloadMessages(client, [2], 'INBOX', inbox.id, '7')
    expect(wholeSent).toEqual([2])
    expect(row(2).complete).toBe(1)
  })

  it('without a threshold, asks for no structure and stores everything whole', async () => {
    const { engine, inbox, row } = setup()
    const { client, queries, wholeSent } = scriptedClient({ 1: small, 2: large })

    await engine.downloadMessages(client, [1, 2], 'INBOX', inbox.id, '7')

    expect(queries).toHaveLength(1)
    expect(queries[0].bodyStructure).toBeUndefined()
    expect(wholeSent).toEqual([1, 2])
    expect([row(1).complete, row(2).complete]).toEqual([1, 1])
    expect(row(2).size_bytes).toBe(large.source.length)
  })
})

describe('S1 threshold default', () => {
  const input = {
    id: 'a',
    host: 'imap.example.test',
    port: 993,
    security: 'tls' as const,
    user: 'u',
    pass: 'p',
    dataDir: os.tmpdir()
  }

  it('is the agreed 5 MB on every account kind', () => {
    expect(LAZY_ABOVE_BYTES).toBe(5_000_000)
    expect(makeSandboxAccount(input).lazyAboveBytes).toBe(LAZY_ABOVE_BYTES)
    expect(makeReadOnlyAccount(input).lazyAboveBytes).toBe(LAZY_ABOVE_BYTES)
    expect(makeLiveAccount(input).lazyAboveBytes).toBe(LAZY_ABOVE_BYTES)
  })
})
