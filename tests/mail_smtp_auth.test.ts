// A7: the SMTP half of the write path must authenticate.
//
// The sandbox Mailpit accepts unauthenticated mail, so a send with no credentials at all
// still "works" there - which is why this was never caught. A real server answers 530/535.
//
// IMAP points at the real sandbox Dovecot (the send path probes Sent there); SMTP points
// at a fake server that refuses MAIL FROM until a correct AUTH arrived.
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { sandboxSkipReason } from './helpers/sandboxGate'
import { Store } from '../src/main/mailclient/core/store'
import { WriteEngine } from '../src/main/mailclient/core/write_engine'
import type { WriteAccount } from '../src/main/mailclient/core/write_guard'
import { startFakeSmtp, type FakeSmtp } from './helpers/fakeSmtp'

const HOST = '127.0.0.1'
const IMAP_PORT = 10143
const USER = 'bookingum-e2e@example.test'
const PASS = 'testpass'
const SUBJECT_PREFIX = 'bookingum-smtp-auth-'

const dirs: string[] = []
const servers: FakeSmtp[] = []

function scratchDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-smtp-auth-'))
  dirs.push(dir)
  return dir
}

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

const sandboxUp = await reachable(IMAP_PORT)
const skipReason = sandboxSkipReason(sandboxUp, 'mail smtp auth', IMAP_PORT)
if (skipReason) console.warn(skipReason)

afterEach(async () => {
  while (servers.length) await servers.pop()!.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const mime = (subject: string, messageId: string): Buffer =>
  Buffer.from(
    `From: ${USER}\r\nTo: ${USER}\r\nSubject: ${subject}\r\nMessage-ID: <${messageId}>\r\n\r\nbody ${subject}\r\n`
  )

/** A sandbox write account: real IMAP, the fake server as SMTP */
function writeAccount(smtpPort: number): WriteAccount {
  return {
    id: 'smtp-auth',
    kind: 'sandbox',
    imapHost: HOST,
    imapPort: IMAP_PORT,
    security: 'none',
    smtpHost: HOST,
    smtpPort
  }
}

/** Queues one send and runs it through the real engine */
async function runSend(
  account: WriteAccount,
  credentials: { user: string; pass: string },
  subject: string
): Promise<{ outcome: string; detail?: string; reason?: string }> {
  const dir = scratchDir()
  const store = new Store(dir, account.id)
  try {
    const messageId = `<${subject}@example.test>`
    const opId = store.journalEnqueue({
      accountId: account.id,
      kind: 'send',
      folderPath: 'Sent',
      messageId,
      payload: {
        mime: mime(subject, messageId).toString('base64'),
        messageId,
        sentFolderPath: 'Sent',
        envelope: { from: USER, to: [USER], cc: [], bcc: [] }
      }
    })
    const writes = new WriteEngine(store, account.id, {
      writeAccount: account,
      credentials: async () => credentials
    })
    const result = await writes.execute(store.journalGet(opId)!)
    return { outcome: result.outcome, detail: result.detail, reason: result.reason }
  } finally {
    store.close()
  }
}

/** Removes whatever this test filed into the sandbox's Sent folder */
async function cleanSent(subject: string): Promise<void> {
  const { ImapFlow } = await import('imapflow')
  const client = new ImapFlow({
    host: HOST,
    port: IMAP_PORT,
    secure: false,
    auth: { user: USER, pass: PASS },
    logger: false
  })
  await client.connect()
  try {
    await client.mailboxOpen('Sent')
    const uids = await client.search({ subject }, { uid: true })
    if (uids && uids.length) await client.messageDelete(uids, { uid: true })
  } finally {
    await client.logout().catch(() => client.close())
  }
}

describe.skipIf(!sandboxUp)('A7: a send authenticates against SMTP', () => {
  it('sends credentials, so a server that requires AUTH accepts the mail', async () => {
    const subject = `${SUBJECT_PREFIX}mit-${Date.now()}`
    const server = await startFakeSmtp({ user: USER, pass: PASS })
    servers.push(server)
    try {
      const result = await runSend(writeAccount(server.port), { user: USER, pass: PASS }, subject)

      // The server refuses MAIL FROM without a correct AUTH, so the mail arriving
      // proves the credentials were sent
      expect(server.authAttempts).toContainEqual({ user: USER, pass: PASS })
      expect(server.messages).toHaveLength(1)
      expect(server.messages[0]).toContain(`Subject: ${subject}`)
      expect(result.outcome).toBe('done')
    } finally {
      await cleanSent(subject)
    }
  }, 60_000)

  it('authenticates before it sends, not after', async () => {
    const subject = `${SUBJECT_PREFIX}reihenfolge-${Date.now()}`
    const server = await startFakeSmtp({ user: USER, pass: PASS })
    servers.push(server)
    try {
      await runSend(writeAccount(server.port), { user: USER, pass: PASS }, subject)

      // AUTH must come before MAIL FROM: the other order is refused by every real server
      const authIndex = server.commands.findIndex((c) => /^AUTH /i.test(c))
      const mailFromIndex = server.commands.findIndex((c) => /^MAIL FROM/i.test(c))
      expect(authIndex).toBeGreaterThanOrEqual(0)
      expect(mailFromIndex).toBeGreaterThan(authIndex)
    } finally {
      await cleanSent(subject)
    }
  }, 60_000)

  it('reports a rejected login as a definite failure, so the mail is retried', async () => {
    const subject = `${SUBJECT_PREFIX}falsch-${Date.now()}`
    // The server expects another password: IMAP still works, the SMTP login is refused
    const server = await startFakeSmtp({ user: USER, pass: 'ein-anderes-passwort' })
    servers.push(server)
    try {
      const result = await runSend(writeAccount(server.port), { user: USER, pass: PASS }, subject)

      expect(server.messages).toHaveLength(0)
      // The login was attempted and refused, so the failure is about the credentials
      expect(server.authAttempts).toContainEqual({ user: USER, pass: PASS })
      // A rejected login is definitive (before DATA): retryable, never "unknown"
      expect(result.outcome).toBe('failed')
    } finally {
      await cleanSent(subject)
    }
  }, 60_000)
})
