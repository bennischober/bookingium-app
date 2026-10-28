// S1 step 3 against the real sandbox Dovecot: the MIME corpus is appended to one folder, then synced
// into two stores, one without a threshold and one with `lazyAboveBytes` lowered to 1000 bytes so
// most of the corpus is stored as skeletons. Every row of the second store must read like the
// first (headers, text, HTML, attachment list), with the server size, estimated attachment sizes
// and `complete = 0` above the threshold. Fetching sets no \Seen, and the repair sweep sets
// `complete` to what it wrote.
//
// Failures name the corpus mail and the differing field, never its content. Skips (with a visible
// reason) when the sandbox is down; the mails it appends are removed again, the folder stays.
import { sandboxSkipReason } from './helpers/sandboxGate'
import { SANDBOX_HOST, SANDBOX_IMAP_PORT, SANDBOX_PASS, SANDBOX_USER } from './helpers/writeAccount'
import { mimeCorpus } from './helpers/mimeCorpus'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ImapFlow } from 'imapflow'
import { Store, type MessageRow } from '../src/main/mailclient/core/store'
import {
  makeSandboxAccount,
  SyncEngine,
  type AccountConfig
} from '../src/main/mailclient/core/sync'
import { Maintenance } from '../src/main/mailclient/core/maintenance'
import type { AccountEntry } from '../src/main/mailclient/core/index'

const FOLDER = 'S1Partial'
const SUBJECT_PREFIX = 'bookingum-s1-partial-'
const THRESHOLD = 1000

/** True when something listens on the port (the sandbox is up) */
function reachable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: SANDBOX_HOST, port, timeout: 1000 })
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

const sandboxUp = await reachable(SANDBOX_IMAP_PORT)
const skipReason = sandboxSkipReason(sandboxUp, 'partial ingest', SANDBOX_IMAP_PORT)
if (skipReason) console.warn(skipReason)

const corpus = mimeCorpus(SUBJECT_PREFIX, SANDBOX_USER)

/** Paths of the fields that differ, so a failure says where without showing the content */
function differences(a: unknown, b: unknown, at = ''): string[] {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].flatMap((k) =>
      differences(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${at}.${k}`
      )
    )
  }
  return a === b ? [] : [at || '(root)']
}

type Attachment = { partId: string; size: number; [k: string]: unknown }

/** What the app reads from a row, sizes aside */
function view(row: MessageRow) {
  return {
    message_id: row.message_id,
    thread_id: row.thread_id,
    date: row.date,
    subject: row.subject,
    from_email: row.from_email,
    to_json: row.to_json,
    cc_json: row.cc_json,
    body_text: row.body_text,
    body_html: row.body_html,
    snippet: row.snippet,
    has_attachments: row.has_attachments,
    parsed_ok: row.parsed_ok,
    attachments: (JSON.parse(row.attachments_json) as Attachment[]).map((a) => ({
      ...a,
      size: undefined
    }))
  }
}

describe.skipIf(!sandboxUp)('S1 partial ingest (sandbox)', () => {
  let client: ImapFlow
  const uids = new Map<string, number>()
  const dirs: string[] = []
  const stores: Store[] = []
  const engines: SyncEngine[] = []

  /** One store synced from the folder, with or without the threshold */
  async function synced(lazyAboveBytes?: number) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-s1-partial-'))
    dirs.push(dir)
    const config: AccountConfig = {
      ...makeSandboxAccount({
        id: 's1',
        host: SANDBOX_HOST,
        port: SANDBOX_IMAP_PORT,
        security: 'none',
        user: SANDBOX_USER,
        pass: SANDBOX_PASS,
        dataDir: dir
      }),
      lazyAboveBytes
    }
    const store = new Store(dir, 's1')
    stores.push(store)
    const engine = new SyncEngine(config, store)
    engines.push(engine)
    await engine.syncFolderList()
    await engine.syncFolder(FOLDER, { full: true })
    const byName = new Map<string, MessageRow>()
    for (const mail of corpus) {
      const row = store.db
        .prepare(
          'SELECT m.* FROM messages m JOIN folders f ON f.id = m.folder_id WHERE f.imap_path = ? AND m.uid = ?'
        )
        .get(FOLDER, uids.get(mail.name)) as MessageRow | undefined
      if (!row) throw new Error(`${mail.name}: not stored`)
      byName.set(mail.name, row)
    }
    return { config, store, engine, byName }
  }

  let whole: Awaited<ReturnType<typeof synced>>
  let lazy: Awaited<ReturnType<typeof synced>>
  const serverSize = new Map<string, number>()

  beforeAll(async () => {
    client = new ImapFlow({
      host: SANDBOX_HOST,
      port: SANDBOX_IMAP_PORT,
      secure: false,
      auth: { user: SANDBOX_USER, pass: SANDBOX_PASS },
      logger: false
    })
    await client.connect()
    if (!(await client.list()).some((b) => b.path === FOLDER)) await client.mailboxCreate(FOLDER)
    for (const mail of corpus) {
      const result = await client.append(FOLDER, mail.mime, [])
      if (!result || typeof result !== 'object' || !result.uid)
        throw new Error('append returned no uid')
      uids.set(mail.name, Number(result.uid))
    }
    await client.mailboxOpen(FOLDER)
    for (const mail of corpus) {
      const meta = await client.fetchOne(String(uids.get(mail.name)), { size: true }, { uid: true })
      serverSize.set(mail.name, meta ? Number(meta.size) : -1)
    }
    whole = await synced()
    lazy = await synced(THRESHOLD)
  }, 120_000)

  afterAll(async () => {
    for (const engine of engines) await engine.close().catch(() => undefined)
    for (const store of stores) store.close()
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true })
    if (!client) return
    if (uids.size) await client.messageDelete([...uids.values()].join(','), { uid: true })
    await client.logout().catch(() => client.close())
  })

  it('the corpus has messages on both sides of the threshold', () => {
    const above = corpus.filter((m) => serverSize.get(m.name)! > THRESHOLD).length
    expect(above).toBeGreaterThan(0)
    expect(above).toBeLessThan(corpus.length)
  })

  it.each(corpus.map((m) => [m.name, m] as const))('%s', (name) => {
    const a = whole.byName.get(name)!
    const b = lazy.byName.get(name)!
    const size = serverSize.get(name)!
    expect(differences(view(b), view(a))).toEqual([])
    expect(a.complete).toBe(1)
    expect(b.complete).toBe(size > THRESHOLD ? 0 : 1)
    // the server size either way: whole rows have it as their file length
    expect(b.size_bytes).toBe(a.size_bytes)
    expect(a.size_bytes).toBe(size)

    const real = JSON.parse(a.attachments_json) as Attachment[]
    const estimated = JSON.parse(b.attachments_json) as Attachment[]
    const off = real.flatMap((r, i) =>
      Math.abs(estimated[i].size - r.size) <= Math.max(r.size * 0.03, 64)
        ? []
        : [`${r.partId}: off`]
    )
    expect(off).toEqual([])

    const file = fs.statSync(lazy.store.filePath(b.file_path)).size
    // a message that is large because of its cid images keeps them all: no smaller, accepted
    if (b.complete === 0) expect(file).toBeLessThanOrEqual(size)
    else expect(file).toBe(size)
  })

  it('the skeleton of the large message is under a tenth of it', () => {
    const big = corpus.find((m) => m.big)!
    const row = lazy.byName.get(big.name)!
    expect(fs.statSync(lazy.store.filePath(row.file_path)).size).toBeLessThan(row.size_bytes / 10)
  })

  it('sets no \\Seen on the server', async () => {
    const seen: string[] = []
    for await (const m of client.fetch(
      [...uids.values()].join(','),
      { flags: true },
      { uid: true }
    ))
      if (m.flags?.has('\\Seen')) seen.push(String(m.uid))
    expect(seen).toEqual([])
  })

  it('repair writes a skeleton above the threshold and a whole file below, and sets complete to match', async () => {
    const big = corpus.find((m) => m.big)!.name
    const plain = corpus.find((m) => serverSize.get(m.name)! <= THRESHOLD)!.name
    const bigRow = lazy.byName.get(big)!
    const plainRow = lazy.byName.get(plain)!
    const skeletonSize = fs.statSync(lazy.store.filePath(bigRow.file_path)).size
    // the flags say the opposite of what repair will write, so it has to set them
    const set = lazy.store.db.prepare('UPDATE messages SET complete = ? WHERE id = ?')
    set.run(1, bigRow.id)
    set.run(0, plainRow.id)
    fs.rmSync(lazy.store.filePath(bigRow.file_path))
    fs.rmSync(lazy.store.filePath(plainRow.file_path))

    const entry = { config: lazy.config, store: lazy.store, engine: lazy.engine } as AccountEntry
    const maintenance = new Maintenance({
      entries: new Map([['s1', entry]]),
      log: {},
      clock: Date.now,
      entry: () => entry
    })
    expect(await maintenance.repairMissingFiles()).toEqual({ repaired: 2, left: 0 })

    const after = (id: number) =>
      lazy.store.db.prepare('SELECT file_path, complete FROM messages WHERE id = ?').get(id) as {
        file_path: string
        complete: number
      }
    const bigAfter = after(bigRow.id)
    const plainAfter = after(plainRow.id)
    expect([bigAfter.complete, plainAfter.complete]).toEqual([0, 1])
    expect(fs.statSync(lazy.store.filePath(bigAfter.file_path)).size).toBe(skeletonSize)
    expect(fs.statSync(lazy.store.filePath(plainAfter.file_path)).size).toBe(serverSize.get(plain))
  }, 60_000)
})
