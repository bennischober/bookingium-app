// A8: crash/replay safety against the real sandbox Dovecot.
//
// What it really does: it journals an op, never runs it (exactly the state a killed process leaves
// behind), then replays it through a fresh engine in the same process. It does NOT kill or start a
// process - the journal row is the whole recovery claim, and the replay path is the same code a
// restart uses. The header used to claim a kill and a fresh process, which was not true.
//
// Proven here:
//   R1. a pending op replays to completion (or a conflict) - never silent loss
//   R2. a move never duplicates: the destination holds exactly one copy, and the source loses it
//   R3. a send never sends twice: Mailpit holds exactly one delivery per Message-ID
//
// Skips (with a visible reason) when the sandbox is down. Every mail this suite creates is removed
// again, in the folder it created it in.
import { sandboxWriteAccount, sandboxCredentials } from './helpers/writeAccount'
import { sandboxSkipReason } from './helpers/sandboxGate'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { ImapFlow } from 'imapflow'
import { Store } from '../src/main/mailclient/core/store'
import { makeSandboxAccount, SyncEngine } from '../src/main/mailclient/core/sync'
import { WriteEngine } from '../src/main/mailclient/core/write_engine'

const HOST = '127.0.0.1'
const PORT = 10143
const MAILPIT_API = 8025
const USER = 'bookingum-e2e@example.test'
const PASS = 'testpass'
const FOLDER = 'CrashA'
const FOLDER_B = 'CrashB'
const SUBJECT_PREFIX = 'bookingum-crash-'

const dirs: string[] = []

/** A scratch data dir for one store; removed in afterAll */
function scratchDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-crash-'))
  dirs.push(dir)
  return dir
}

/** True when something listens on the port (the sandbox is up) */
function reachable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port, timeout: 1000 })
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

const sandboxUp = await reachable(PORT)
const skipReason = sandboxSkipReason(sandboxUp, 'mail crash-points', PORT)
if (skipReason) console.warn(skipReason)

function account(dataDir: string) {
  return makeSandboxAccount({
    id: 'crash',
    host: HOST,
    port: PORT,
    security: 'none',
    user: USER,
    pass: PASS,
    dataDir
  })
}

const mime = (subject: string, messageId: string): Buffer =>
  Buffer.from(
    `From: crash@example.test\r\nTo: ${USER}\r\nSubject: ${subject}\r\nMessage-ID: <${messageId}>\r\n\r\nbody ${subject}\r\n`
  )

/** Counts of one folder on the server, read with a fresh client */
async function folderCount(folder: string): Promise<number> {
  const client = new ImapFlow({
    host: HOST,
    port: PORT,
    secure: false,
    auth: { user: USER, pass: PASS },
    logger: false
  })
  await client.connect()
  try {
    const status = await client.status(folder, { messages: true })
    return status.messages
  } finally {
    await client.logout().catch(() => client.close())
  }
}

/** Deliveries of ONE message, found by its Message-ID.
 *
 * Counting by subject prefix is not enough: earlier runs leave mails with the same prefix in the
 * shared sandbox, so a "delta of 1" can be satisfied by an OLD message and a real send that never
 * happened still looks like a pass. The Message-ID carries the run's own timestamp, so it is unique.
 * -1 means the API could not be reached; the caller must fail on that rather than pass. */
async function mailpitDeliveries(messageId: string): Promise<number> {
  try {
    // limit=1000: a busy shared sandbox holds more than 500, and a miss would read as "0 delivered".
    const r = await fetch(`http://${HOST}:${MAILPIT_API}/api/v1/messages?limit=1000`)
    if (!r.ok) return -1
    const body = (await r.json()) as { messages?: { MessageID?: string }[] }
    const bare = messageId.replace(/^<|>$/g, '')
    return (body.messages ?? []).filter((m) => (m.MessageID ?? '') === bare).length
  } catch {
    return -1
  }
}

/** Deletes every mail in a folder whose subject is the given one */
async function deleteBySubject(folder: string, subject: string): Promise<void> {
  const client = new ImapFlow({
    host: HOST,
    port: PORT,
    secure: false,
    auth: { user: USER, pass: PASS },
    logger: false
  })
  await client.connect()
  try {
    await client.mailboxOpen(folder)
    const uids = await client.search({ subject }, { uid: true })
    if (uids && uids.length) await client.messageDelete(uids, { uid: true })
  } finally {
    await client.logout().catch(() => client.close())
  }
}

/** Ensures a folder exists on the server */
async function ensureFolder(folder: string): Promise<void> {
  const client = new ImapFlow({
    host: HOST,
    port: PORT,
    secure: false,
    auth: { user: USER, pass: PASS },
    logger: false
  })
  await client.connect()
  try {
    if (!(await client.list()).some((b) => b.path === folder)) await client.mailboxCreate(folder)
  } finally {
    await client.logout().catch(() => client.close())
  }
}

/** Appends a mail and returns its UID in the folder */
async function appendMail(folder: string, subject: string, messageId: string): Promise<number> {
  const client = new ImapFlow({
    host: HOST,
    port: PORT,
    secure: false,
    auth: { user: USER, pass: PASS },
    logger: false
  })
  await client.connect()
  try {
    const result = await client.append(folder, mime(subject, messageId), [])
    if (!result || typeof result !== 'object' || !result.uid)
      throw new Error('append returned no uid')
    return Number(result.uid)
  } finally {
    await client.logout().catch(() => client.close())
  }
}

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!sandboxUp)('crash points and replay (sandbox)', () => {
  it('a journaled move replays to exactly one copy at the destination', async () => {
    await ensureFolder(FOLDER)
    await ensureFolder(FOLDER_B)
    const dir = scratchDir()
    const subject = `${SUBJECT_PREFIX}move-${Date.now()}`
    const uid = await appendMail(FOLDER, subject, `<${subject}@example.test>`)

    const store = new Store(dir, 'crash')
    const sync = new SyncEngine(account(dir), store)
    const before = await folderCount(FOLDER_B)
    const sourceBefore = await folderCount(FOLDER)
    try {
      // Sync so the store knows the mail and the folder ids
      await sync.syncFolderList()
      await sync.syncFolder(FOLDER, { full: true })

      const folder = store.getFolderByPath(FOLDER)
      const target = store.getFolderByPath(FOLDER_B)
      expect(folder).toBeDefined()
      expect(target).toBeDefined()

      const opId = store.journalEnqueue({
        accountId: 'crash',
        kind: 'move',
        folderPath: FOLDER,
        folderUidValidity: folder!.uid_validity ?? undefined,
        uid,
        messageKey: store.messageKey('crash', folder!.id, folder!.uid_validity ?? '', uid),
        targetFolderPath: FOLDER_B
      })

      // "Crash" before the op ever ran: the journal row survives, nothing was moved
      expect(store.journalGet(opId)!.state).toBe('pending')

      // Recovery: a fresh engine replays the pending op
      const writes = new WriteEngine(store, 'crash', {
        writeAccount: sandboxWriteAccount(),
        credentials: sandboxCredentials
      })
      const op = store.journalGet(opId)!
      const result = await writes.execute(op)
      expect(['done', 'conflict']).toContain(result.outcome)

      // R2: exactly one copy at the destination, never two...
      const after = await folderCount(FOLDER_B)
      expect(after - before).toBe(1)
      // ...and the source lost its copy. Without this the move could have COPIED: the
      // destination would still show exactly one new message.
      const sourceAfter = await folderCount(FOLDER)
      expect(sourceAfter).toBe(sourceBefore - 1)
    } finally {
      // The moved mail now sits in FOLDER_B; it is this suite's own, so it goes
      await deleteBySubject(FOLDER_B, subject)
      await deleteBySubject(FOLDER, subject)
      store.close()
    }
  }, 120_000)

  it('a send that is replayed after a crash is delivered only once', async () => {
    const dir = scratchDir()
    const store = new Store(dir, 'crash')
    const subject = `${SUBJECT_PREFIX}send-${Date.now()}`
    const messageId = `<${subject}@example.test>`
    try {
      // Baseline BEFORE the send: measuring after it makes the delta always 0, which is what a
      // first version of this fix did.
      const beforeCount = await mailpitDeliveries(messageId)
      if (beforeCount < 0) {
        throw new Error(
          `Mailpit API not reachable on ${HOST}:${MAILPIT_API} - the send-dedup claim cannot be verified`
        )
      }
      expect(beforeCount).toBe(0)

      // A send op that never ran: exactly the crash-before-SMTP case
      const opId = store.journalEnqueue({
        accountId: 'crash',
        kind: 'send',
        folderPath: 'Sent',
        messageId,
        payload: {
          mime: mime(subject, messageId).toString('base64'),
          messageId,
          sentFolderPath: 'Sent',
          envelope: { from: `crash@example.test`, to: [USER], cc: [], bcc: [] }
        }
      })

      const writes = new WriteEngine(store, 'crash', {
        writeAccount: sandboxWriteAccount(),
        credentials: sandboxCredentials
      })
      const first = await writes.execute(store.journalGet(opId)!)
      expect(['done', 'unknown', 'failed']).toContain(first.outcome)

      // The sink must have been reachable from the start, or the dedup claim is unproven. This used
      // to `return` (a PASS) when Mailpit was down, so the test proved nothing on exactly the
      // machines where the sandbox was misconfigured.

      // Replay the very same op (as a restart would): never a second delivery
      if (first.outcome === 'done') {
        const replay = await writes.execute(store.journalGet(opId)!)
        expect(['done', 'noop', 'unknown']).toContain(replay.outcome)
      }

      const after = await mailpitDeliveries(messageId)
      // EXACTLY one: 0 deliveries means the send never happened (the old `<= 1` passed on that).
      expect(after).toBe(1)
    } finally {
      // The mail reached the sandbox's Sent folder; it goes again, so the sandbox
      // stays as the suite found it
      await deleteBySubject('Sent', subject)
      store.close()
    }
  }, 120_000)
})
