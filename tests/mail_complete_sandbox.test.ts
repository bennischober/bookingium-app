// S1 step 6 against the real sandbox Dovecot, through the MailCore surface the UI calls. Three
// generated mails, each with a random binary attachment just above the 5 MB default a sandbox
// account gets, are synced into a store and must stay partial there: list, search and the
// attachment names read as usual. Each door then completes one of them: getAttachment and
// getRawEml return the server's bytes, and a forward (saved as a draft, never sent) carries the
// file. The core reaches the server through a relay this suite owns, so "proxy down" is the
// relay refusing connections: the offline error, and the row stays partial. \Seen stays untouched
// and the search index stays consistent.
//
// Failures name the mail and the field, never its content. Skips (with a visible reason) when the
// sandbox is down; the mails and the draft it creates are removed again, the folder stays.
import { sandboxSkipReason } from './helpers/sandboxGate'
import { SANDBOX_HOST, SANDBOX_IMAP_PORT, SANDBOX_PASS, SANDBOX_USER } from './helpers/writeAccount'
import crypto from 'crypto'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ImapFlow } from 'imapflow'
import { Store } from '../src/main/mailclient/core/store'
import { LAZY_ABOVE_BYTES, makeSandboxAccount, SyncEngine } from '../src/main/mailclient/core/sync'
import { createMailCore, type MailCore } from '../src/main/mailclient/core/index'
import { OFFLINE_MESSAGE } from '../src/main/mailclient/core/message_complete'
import { parseMessage } from '../src/main/mailclient/core/parse'
import type { DraftInput, MessageDetail } from '../src/main/mailclient/core/types'

const ACCOUNT = 's1c'
const FOLDER = 'S1Complete'
const SUBJECT_PREFIX = 'bookingum-s1-complete-'
// base64 with line breaks makes this about 5.2 MB on the server, just above the default
const ATTACHMENT_BYTES = 3_800_000

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
const skipReason = sandboxSkipReason(sandboxUp, 'message completion', SANDBOX_IMAP_PORT)
if (skipReason) console.warn(skipReason)

// one token per run, only in the attachment names: a search for it can only match through them
const RUN = `s1c${Date.now().toString(36)}`

type Mail = { name: string; filename: string; bytes: Buffer; mime: Buffer }

function largeMail(name: string): Mail {
  const bytes = crypto.randomBytes(ATTACHMENT_BYTES)
  const filename = `${RUN}-${name}.bin`
  const mime = [
    'From: s1-sender@example.test',
    `To: ${SANDBOX_USER}`,
    `Subject: ${SUBJECT_PREFIX}${name}`,
    `Message-ID: <${RUN}-${name}@example.test>`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="s1-boundary"',
    '',
    '--s1-boundary',
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Begleittext ${name}`,
    '--s1-boundary',
    `Content-Type: application/octet-stream; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    bytes.toString('base64').replace(/.{76}/g, '$&\r\n'),
    '--s1-boundary--',
    ''
  ].join('\r\n')
  return { name, filename, bytes, mime: Buffer.from(mime) }
}

/** A TCP relay to the sandbox that can be taken down: then it drops every connection */
async function startRelay() {
  const sockets = new Set<net.Socket>()
  let down = false
  const server = net.createServer((inbound) => {
    if (down) {
      inbound.destroy()
      return
    }
    const outbound = net.connect(SANDBOX_IMAP_PORT, SANDBOX_HOST)
    const end = () => {
      inbound.destroy()
      outbound.destroy()
      sockets.delete(inbound)
      sockets.delete(outbound)
    }
    sockets.add(inbound)
    sockets.add(outbound)
    inbound.pipe(outbound)
    outbound.pipe(inbound)
    for (const s of [inbound, outbound]) {
      s.on('error', end)
      s.on('close', end)
    }
  })
  await new Promise<void>((r) => server.listen(0, SANDBOX_HOST, () => r()))
  return {
    port: (server.address() as net.AddressInfo).port,
    setDown(value: boolean) {
      down = value
      if (value) for (const s of sockets) s.destroy()
    },
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy()
        server.close(() => r())
      })
  }
}

describe.skipIf(!sandboxUp)('S1 completion through the core (sandbox)', () => {
  const mails = ['open', 'eml', 'forward'].map(largeMail)
  const uids = new Map<string, number>()
  const serverSize = new Map<string, number>()
  const ids = new Map<string, number>()
  const draftUids: number[] = []
  const warnings: string[] = []
  let client: ImapFlow
  let relay: Awaited<ReturnType<typeof startRelay>>
  let dataDir: string
  let core: MailCore | null = null
  let folderId: string

  const byName = (name: string) => mails.find((m) => m.name === name)!
  const detail = (name: string): Promise<MessageDetail> => core!.getMessage(ids.get(name)!)
  /** The stored file of a message, from its detail */
  const stored = (d: MessageDetail): string => path.join(dataDir, ACCOUNT, d.emlPath)

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
    for (const mail of mails) {
      const result = await client.append(FOLDER, mail.mime, [])
      if (!result || typeof result !== 'object' || !result.uid)
        throw new Error('append returned no uid')
      uids.set(mail.name, Number(result.uid))
    }
    const lock = await client.getMailboxLock(FOLDER)
    try {
      for (const mail of mails) {
        const meta = await client.fetchOne(
          String(uids.get(mail.name)),
          { size: true },
          { uid: true }
        )
        serverSize.set(mail.name, meta ? Number(meta.size) : -1)
      }
    } finally {
      lock.release()
    }

    relay = await startRelay()
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-s1-complete-'))
    // the folder sync the core would run, with the builder the core uses for a sandbox account
    // (and so its default threshold); the core's own sync covers every folder of the mailbox
    const accountDir = path.join(dataDir, ACCOUNT)
    fs.mkdirSync(accountDir)
    const store = new Store(accountDir, ACCOUNT)
    const engine = new SyncEngine(
      makeSandboxAccount({
        id: ACCOUNT,
        host: SANDBOX_HOST,
        port: relay.port,
        security: 'none',
        user: SANDBOX_USER,
        pass: SANDBOX_PASS,
        dataDir: accountDir
      }),
      store
    )
    try {
      await engine.syncFolderList()
      await engine.syncFolder(FOLDER, { full: true })
    } finally {
      await engine.close()
      store.close()
    }

    core = createMailCore({
      dataDir,
      log: { warn: (m: string) => warnings.push(m) },
      accounts: [
        {
          id: ACCOUNT,
          readOnly: false,
          host: SANDBOX_HOST,
          port: relay.port,
          security: 'none',
          email: SANDBOX_USER,
          credentials: async () => ({ user: SANDBOX_USER, pass: SANDBOX_PASS })
        }
      ]
    })
    const folder = (await core.getFolders()).find((f) => f.path === FOLDER)
    if (!folder) throw new Error('folder not synced')
    folderId = folder.id
    for (const item of await core.listMessages(folderId, { offset: 0, limit: 200 })) {
      const mail = mails.find((m) => uids.get(m.name) === item.uid)
      if (mail) ids.set(mail.name, item.id)
    }
  }, 120_000)

  afterAll(async () => {
    await core?.close().catch(() => undefined)
    await relay?.close()
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
    if (!client) return
    for (const [folder, list] of [
      [FOLDER, [...uids.values()]],
      ['Drafts', draftUids]
    ] as const) {
      if (!list.length) continue
      const lock = await client.getMailboxLock(folder)
      try {
        await client.messageDelete(list.join(','), { uid: true })
      } finally {
        lock.release()
      }
    }
    await client.logout().catch(() => client.close())
  }, 60_000)

  it('every mail is above the default threshold and stored as its skeleton', async () => {
    expect([...ids.keys()].sort()).toEqual(mails.map((m) => m.name).sort())
    const wrong: string[] = []
    for (const mail of mails) {
      const size = serverSize.get(mail.name)!
      if (size <= LAZY_ABOVE_BYTES) wrong.push(`${mail.name}: not above the threshold`)
      const d = await detail(mail.name)
      if (d.complete) wrong.push(`${mail.name}: complete`)
      if (d.sizeBytes !== size) wrong.push(`${mail.name}: sizeBytes`)
      if (fs.statSync(stored(d)).size >= size / 10) wrong.push(`${mail.name}: file`)
      const [attachment] = d.attachments
      if (d.attachments.length !== 1 || attachment.filename !== mail.filename)
        wrong.push(`${mail.name}: attachment name`)
      else if (Math.abs(attachment.sizeBytes - mail.bytes.length) > mail.bytes.length * 0.03)
        wrong.push(`${mail.name}: estimated size`)
    }
    expect(wrong).toEqual([])
  })

  it('list and search show them with their attachments', async () => {
    const items = (await core!.listMessages(folderId, { offset: 0, limit: 200 })).filter((i) =>
      [...ids.values()].includes(i.id)
    )
    const wrong = items.flatMap((i) => {
      const mail = mails.find((m) => ids.get(m.name) === i.id)!
      return i.hasAttachments && i.attachmentNames.join() === mail.filename
        ? []
        : [`${mail.name}: list`]
    })
    expect(items).toHaveLength(mails.length)
    expect(wrong).toEqual([])

    // the run token is only in the attachment names
    const found = await core!.search({ query: RUN, hasAttachment: true, folderId })
    expect(found.items.map((i) => i.id).sort()).toEqual([...ids.values()].sort())
  })

  it('proxy down: opening the attachment is the offline error, and the mail stays partial', async () => {
    const mail = byName('open')
    const partId = (await detail('open')).attachments[0].partId
    relay.setDown(true)
    try {
      await expect(core!.getAttachment(ids.get('open')!, partId)).rejects.toThrow(OFFLINE_MESSAGE)
    } finally {
      relay.setDown(false)
    }
    // the relay's refusal, not a login the core never made: that would stop the account
    const failures = warnings.filter((w) => w.startsWith('completing a message failed'))
    expect(failures).toHaveLength(1)
    expect(failures[0]).not.toMatch(/password|login/i)
    expect((await core!.getSyncStatus()).connection).toBe('offline')
    const after = await detail(mail.name)
    expect(after.complete).toBe(false)
    expect(fs.existsSync(stored(after))).toBe(true)
  }, 60_000)

  it('getAttachment returns the original bytes and completes the mail', async () => {
    const mail = byName('open')
    const partId = (await detail('open')).attachments[0].partId
    const bytes = Buffer.from(await core!.getAttachment(ids.get('open')!, partId))
    expect(bytes.equals(mail.bytes)).toBe(true)
    const after = await detail('open')
    expect(after.complete).toBe(true)
    expect(after.attachments[0].sizeBytes).toBe(mail.bytes.length)
    expect(fs.statSync(stored(after)).size).toBe(serverSize.get('open'))
  }, 60_000)

  it('getRawEml returns the server source and completes the mail', async () => {
    const raw = Buffer.from(await core!.getRawEml(ids.get('eml')!))
    expect(raw.equals(byName('eml').mime)).toBe(true)
    expect((await detail('eml')).complete).toBe(true)
  }, 60_000)

  it('a forward carries the file (saved as a draft, never sent)', async () => {
    const mail = byName('forward')
    const draft: DraftInput = {
      to: [{ name: '', email: SANDBOX_USER }],
      cc: [],
      bcc: [],
      subject: `${SUBJECT_PREFIX}forward-draft`,
      bodyText: 'Weiterleitung',
      bodyHtml: null,
      inReplyTo: null,
      references: [],
      attachments: [],
      forwardsFrom: ids.get('forward')!
    }
    const uid = await core!.saveDraft(draft)
    draftUids.push(uid)
    expect((await detail('forward')).complete).toBe(true)

    const lock = await client.getMailboxLock('Drafts')
    let source: Buffer | undefined
    try {
      source = (await client.fetchOne(String(uid), { source: true }, { uid: true }))?.source
    } finally {
      lock.release()
    }
    expect(source).toBeDefined()
    const files = (await parseMessage(source!)).attachments.filter(
      (a) => a.filename === mail.filename
    )
    expect(files).toHaveLength(1)
    expect(files[0].content.equals(mail.bytes)).toBe(true)
  }, 60_000)

  it('sets no \\Seen on the server', async () => {
    const lock = await client.getMailboxLock(FOLDER)
    const seen: string[] = []
    try {
      for await (const m of client.fetch(
        [...uids.values()].join(','),
        { flags: true },
        { uid: true }
      ))
        if (m.flags?.has('\\Seen')) seen.push(String(m.uid))
    } finally {
      lock.release()
    }
    expect(seen).toEqual([])
  })

  it('the search index is consistent after the completions', async () => {
    await core!.close()
    core = null
    const store = new Store(path.join(dataDir, ACCOUNT), ACCOUNT)
    try {
      expect(() =>
        store.db.exec(`INSERT INTO fts(fts, rank) VALUES('integrity-check', 1)`)
      ).not.toThrow()
    } finally {
      store.close()
    }
  }, 60_000)
})
