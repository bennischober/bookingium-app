// S1 step 4: completing a message stored as its skeleton, against a scripted server. The row is
// stored the way the download pass stores it (MessageIngest with `partSizes`); the server hands
// out the whole source. Covered: the completed row and file, one download for two callers, the
// errors (gone, offline, disk full) leave the row as it was, every door that reads the stored
// file asks first, and repair replaces a former skeleton's estimated attachment sizes.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store, type MessageRow } from '../src/main/mailclient/core/store'
import { MessageIngest } from '../src/main/mailclient/core/message_ingest'
import {
  adoptWholeSource,
  GONE_MESSAGE,
  MessageCompletion,
  OFFLINE_MESSAGE
} from '../src/main/mailclient/core/message_complete'
import { MessageViews, type MessageViewsContext } from '../src/main/mailclient/core/message_views'
import { DraftApi, type DraftApiContext } from '../src/main/mailclient/core/draft_api'
import { Maintenance } from '../src/main/mailclient/core/maintenance'
import { diskFullMessage } from '../src/main/mailclient/core/disk_full'
import type { AccountConfig } from '../src/main/mailclient/core/sync'
import type { AccountEntry } from '../src/main/mailclient/core/index'

const ACCOUNT = 'acc'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const crlf = (s: string): Buffer => Buffer.from(s.replace(/\r?\n/g, '\r\n'))
const PDF = Buffer.from('%PDF-1.4\n%complete\n')
const mail = (body: string): Buffer =>
  crlf(
    'From: a@example.test\nTo: b@example.test\nMessage-ID: <m@example.test>\nDate: Tue, 27 Oct 2026 10:00:00 +0100\n' +
      'Subject: gross\nMIME-Version: 1.0\nContent-Type: multipart/mixed; boundary="o"\n\n' +
      '--o\nContent-Type: text/plain\n\nHallo\n' +
      '--o\nContent-Type: application/pdf\nContent-Transfer-Encoding: base64\nContent-Disposition: attachment; filename="gross.pdf"\n\n' +
      `${body}\n--o--\n`
  )
const WHOLE = mail(PDF.toString('base64'))
const SKELETON = mail('')
const ESTIMATE = 7_000_000

type FetchAnswer = { uid: number; source: Buffer } | false

/** A fake sync engine: `withSelected` runs `fn` on a client whose fetchOne answers `answer()` */
function fakeEngine(
  answer: () => FetchAnswer,
  opts: { validityChanged?: boolean; offline?: boolean } = {}
) {
  const calls: { path: string; validity: string | null; query?: unknown }[] = []
  let release: () => void = () => undefined
  let gate: Promise<void> = Promise.resolve()
  const engine = {
    isDiskFull: false,
    diskFullAt: null as string | null,
    noteDiskFull(p: string | null) {
      engine.isDiskFull = true
      engine.diskFullAt = p
    },
    /** Holds the next fetch until `open()` */
    hold() {
      gate = new Promise((r) => (release = r))
      return () => release()
    },
    async withSelected<T>(
      p: string,
      validity: string | null,
      fn: (client: unknown) => Promise<T>
    ): Promise<T | null> {
      const call: (typeof calls)[number] = { path: p, validity }
      calls.push(call)
      if (opts.offline) throw new Error('connect ECONNREFUSED 127.0.0.1:10143')
      if (opts.validityChanged) return null
      return fn({
        async fetchOne(_uid: string, query: unknown) {
          call.query = query
          await gate
          return answer()
        }
      })
    }
  }
  return { engine, calls }
}

function setup(engineOpts: Parameters<typeof fakeEngine>[1] = {}, answer?: () => FetchAnswer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-complete-'))
  const store = new Store(dir, ACCOUNT, Date.now, {})
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  cleanups.push(() => store.close())
  const config: AccountConfig = {
    id: ACCOUNT,
    host: '127.0.0.1',
    port: 10199,
    security: 'none',
    user: 'u',
    pass: 'p',
    readOnly: false,
    dataDir: dir
  }
  const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '7' })
  const { engine, calls } = fakeEngine(answer ?? (() => ({ uid: 4, source: WHOLE })), engineOpts)
  const entry = { config, store, engine } as unknown as AccountEntry
  const ingest = new MessageIngest(
    { account: config, store, log: {}, passInsertedMsgIds: () => new Set() },
    undefined
  )
  /** The partial row the download pass would store for UID 4 */
  const partial = async (): Promise<MessageRow> => {
    await ingest.storeMessage(inbox.id, '7', {
      uid: 4,
      source: SKELETON,
      size: ESTIMATE + 400,
      partSizes: new Map([['2', ESTIMATE]])
    })
    return store.getByKey(store.messageKey(ACCOUNT, inbox.id, '7', 4))!
  }
  const files = () =>
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.eml'))
      .sort()
  return { store, engine, calls, entry, partial, files, completion: new MessageCompletion() }
}

const sizeOf = (row: MessageRow): number =>
  (JSON.parse(row.attachments_json) as { size: number }[])[0].size

describe('S1: ensureComplete', () => {
  it('returns a complete row as it is, without asking the server', async () => {
    const { entry, partial, store, calls, completion } = setup()
    const row = await partial()
    store.db.prepare('UPDATE messages SET complete = 1 WHERE id = ?').run(row.id)
    const complete = store.getMessage(row.id)!
    expect(await completion.ensureComplete(entry, complete)).toBe(complete)
    expect(calls).toEqual([])
  })

  it('downloads the whole message once and makes the row complete', async () => {
    const { entry, partial, store, calls, files, completion } = setup()
    const row = await partial()
    expect(row.complete).toBe(0)
    expect(sizeOf(row)).toBe(ESTIMATE)
    const skeletonFile = row.file_path

    const done = await completion.ensureComplete(entry, row)

    expect(calls).toEqual([{ path: 'INBOX', validity: '7', query: { uid: true, source: true } }])
    expect(done.complete).toBe(1)
    expect(fs.readFileSync(store.filePath(done.file_path)).equals(WHOLE)).toBe(true)
    // the real size from the full parse replaces the estimate
    expect(sizeOf(done)).toBe(PDF.length)
    expect(done.has_attachments).toBe(1)
    // the row's own fields stay what the skeleton gave
    expect(done.size_bytes).toBe(row.size_bytes)
    expect(done.body_text).toBe(row.body_text)
    expect(files()).toEqual([done.file_path])
    expect(files()).not.toContain(skeletonFile)
  })

  it('shares one download between two callers', async () => {
    const { entry, partial, engine, calls, completion } = setup()
    const row = await partial()
    const open = engine.hold()
    const first = completion.ensureComplete(entry, row)
    const second = completion.ensureComplete(entry, row)
    open()
    const [a, b] = await Promise.all([first, second])
    expect(calls.length).toBe(1)
    expect(a.file_path).toBe(b.file_path)
  })

  it('a changed UIDVALIDITY or a missing UID is "gone", and the row stays as it was', async () => {
    for (const [opts, answer] of [
      [{ validityChanged: true }, undefined],
      [{}, () => false as const]
    ] as const) {
      const { entry, partial, store, files, completion } = setup(opts, answer)
      const row = await partial()
      await expect(completion.ensureComplete(entry, row)).rejects.toThrow(GONE_MESSAGE)
      expect(store.getMessage(row.id)).toEqual(row)
      expect(files()).toEqual([row.file_path])
    }
  })

  it('offline says so without the connection error, and the next call tries again', async () => {
    const { entry, partial, store, calls, completion } = setup({ offline: true })
    const row = await partial()
    const error = await completion.ensureComplete(entry, row).catch((e: Error) => e)
    expect((error as Error).message).toBe(OFFLINE_MESSAGE)
    expect(store.getMessage(row.id)!.complete).toBe(0)
    await completion.ensureComplete(entry, row).catch(() => undefined)
    expect(calls.length).toBe(2)
  })

  it('a full disk refuses before any server contact', async () => {
    const { entry, partial, engine, calls, completion } = setup()
    const row = await partial()
    engine.isDiskFull = true
    await expect(completion.ensureComplete(entry, row)).rejects.toThrow(diskFullMessage())
    expect(calls).toEqual([])
  })

  it('a row deleted during the download is "gone", and the new file is removed again', async () => {
    const { entry, partial, store, engine, files, completion } = setup()
    const row = await partial()
    const open = engine.hold()
    const pending = completion.ensureComplete(entry, row)
    store.db.prepare('DELETE FROM messages WHERE id = ?').run(row.id)
    open()
    await expect(pending).rejects.toThrow(GONE_MESSAGE)
    // only the deleted row's own file is left, for the sweep
    expect(files()).toEqual([row.file_path])
  })
})

describe('S1: the doors that read the stored file complete it first', () => {
  function doors() {
    const s = setup()
    const ensureComplete = (e: AccountEntry, row: MessageRow) => s.completion.ensureComplete(e, row)
    const views = new MessageViews({
      options: { dataDir: '', accounts: [] },
      entry: () => s.entry,
      emitEvent: () => undefined,
      ensureComplete
    } as MessageViewsContext)
    const unused = () => {
      throw new Error('not used here')
    }
    const drafts = new DraftApi({
      clock: Date.now,
      entry: () => s.entry,
      writableEntry: () => s.entry,
      runOp: unused,
      replayOps: unused,
      planFlagOp: unused,
      resyncMovedFolders: unused,
      ensureComplete
    } as DraftApiContext)
    return { ...s, views, drafts }
  }

  it('getAttachment returns the real bytes', async () => {
    const { views, partial, calls } = doors()
    const row = await partial()
    expect(Buffer.from(await views.getAttachment(row.id, '2')).equals(PDF)).toBe(true)
    expect(calls.length).toBe(1)
  })

  it('getRawEml never returns the skeleton', async () => {
    const { views, partial } = doors()
    const row = await partial()
    expect(Buffer.from(await views.getRawEml(row.id)).equals(WHOLE)).toBe(true)
  })

  it('getDraft carries the attachment', async () => {
    const { drafts, partial } = doors()
    const row = await partial()
    const draft = await drafts.getDraft(row.id)
    expect(draft.attachments.map((a) => Buffer.from(a.base64, 'base64').equals(PDF))).toEqual([
      true
    ])
  })

  it('a forward carries the file, and offline it fails instead of dropping it', async () => {
    const { drafts, partial, entry } = doors()
    const row = await partial()
    type Forward = { attachmentsOf(e: AccountEntry, id: number): Promise<{ content: Buffer }[]> }
    const forward = drafts as unknown as Forward
    const files = await forward.attachmentsOf(entry, row.id)
    expect(files.map((f) => f.content.equals(PDF))).toEqual([true])

    const offline = doors()
    const offlineRow = await offline.partial()
    ;(offline.engine as unknown as { withSelected: () => never }).withSelected = () => {
      throw new Error('connect ECONNREFUSED')
    }
    const offlineForward = offline.drafts as unknown as Forward
    await expect(offlineForward.attachmentsOf(offline.entry, offlineRow.id)).rejects.toThrow(
      OFFLINE_MESSAGE
    )
  })
})

describe('S1: whole files written by repair', () => {
  it('a former skeleton row written whole gets the real attachment sizes', async () => {
    const { entry, partial, store } = setup()
    const row = await partial()
    fs.rmSync(store.filePath(row.file_path))
    const maintenance = new Maintenance({
      entries: new Map([[ACCOUNT, entry]]),
      log: {},
      clock: Date.now,
      entry: () => entry
    })
    // no threshold (raised or removed since): the message is written whole
    expect(await maintenance.repairMissingFiles()).toEqual({ repaired: 1, left: 0 })
    const after = store.getMessage(row.id)!
    expect(after.complete).toBe(1)
    expect(sizeOf(after)).toBe(PDF.length)
    expect(fs.readFileSync(store.filePath(after.file_path)).equals(WHOLE)).toBe(true)
  })

  it('adoptWholeSource leaves a row alone whose file changed meanwhile', async () => {
    const { partial, store, files } = setup()
    const row = await partial()
    const stale = { id: row.id, file_path: 'elsewhere.eml' }
    expect(await adoptWholeSource(store, stale, WHOLE)).toBe(false)
    expect(store.getMessage(row.id)).toEqual(row)
    expect(files()).toEqual([row.file_path])
  })
})
