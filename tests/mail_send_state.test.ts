// I1: the send state machine. A send must never be delivered twice: not after a quit or a
// crash in the SMTP phase (MR-01), not after a throw that skipped the journal (MR-02), not
// after a watchdog timeout (MR-03), not through retryOp (MR-05). A mail the server took but
// that could not be filed is filed later, never sent again (MR-43).
//
// IMAP is a scripted Sent mailbox; SMTP is the local fake server, so every delivery is
// counted. Nothing here talks to the sandbox.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { composeMime } from '../src/main/mailclient/core/compose'
import { createMailCore } from '../src/main/mailclient/core/index'
import { Store, type JournalRow } from '../src/main/mailclient/core/store'
import { WriteEngine, smtpRefused } from '../src/main/mailclient/core/write_engine'
import { startFakeSmtp, type FakeSmtp } from './helpers/fakeSmtp'
import {
  SANDBOX_PASS,
  SANDBOX_USER,
  sandboxCredentials,
  sandboxWriteAccount
} from './helpers/writeAccount'

const ACCOUNT = 'acc'
const MESSAGE_ID = 'f00d0000-0000-4000-8000-000000000001@example.test'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  while (cleanups.length) await cleanups.pop()!()
})

function openStore(): Store {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-send-state-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return store
}

async function fakeSmtp(afterData?: 'accept' | 'drop' | 'reject'): Promise<FakeSmtp> {
  const server = await startFakeSmtp({ user: SANDBOX_USER, pass: SANDBOX_PASS }, { afterData })
  cleanups.push(() => server.close())
  return server
}

/** A scripted Sent folder: search by Message-ID, append (which can be made to fail) */
function sentMailbox(
  opts: { filed?: string[]; appendFails?: boolean; connectFails?: boolean } = {}
) {
  const filed = [...(opts.filed ?? [])]
  let appends = 0
  const client = {
    capabilities: new Set(['IMAP4rev1', 'UIDPLUS']),
    mailboxOpen: async () => ({ uidValidity: 1n, exists: filed.length }),
    search: async (query: { header?: Record<string, string> }) => {
      const wanted = query.header?.['message-id'] ?? ''
      return filed.some((raw) => raw.includes(wanted)) ? [1] : []
    },
    append: async (_path: string, raw: Buffer) => {
      appends++
      if (opts.appendFails) throw new Error('APPEND refused')
      filed.push(raw.toString())
      return { uid: filed.length }
    },
    logout: async () => undefined
  }
  return {
    connect: async () => {
      if (opts.connectFails) throw new Error('connect ECONNREFUSED 127.0.0.1:10143')
      return client
    },
    filed,
    appends: () => appends,
    setAppendFails: (fails: boolean) => (opts.appendFails = fails)
  }
}

function engine(store: Store, smtpPort: number, mailbox: ReturnType<typeof sentMailbox>) {
  const writes = new WriteEngine(store, ACCOUNT, {
    writeAccount: sandboxWriteAccount({ smtpPort }),
    credentials: sandboxCredentials
  })
  ;(writes as unknown as { writeClient: () => Promise<unknown> }).writeClient = mailbox.connect
  return writes
}

function enqueueSend(
  store: Store,
  extra: { phase?: 'smtp' | 'sent'; state?: string } = {}
): JournalRow {
  const raw = `From: ${SANDBOX_USER}\r\nTo: ${SANDBOX_USER}\r\nSubject: state\r\nMessage-ID: <${MESSAGE_ID}>\r\n\r\nbody\r\n`
  const id = store.journalEnqueue({
    accountId: ACCOUNT,
    kind: 'send',
    messageId: MESSAGE_ID,
    payload: {
      mime: Buffer.from(raw).toString('base64'),
      messageId: MESSAGE_ID,
      envelope: { from: SANDBOX_USER, to: [SANDBOX_USER], cc: [], bcc: [] },
      sentFolderPath: 'Sent',
      ...(extra.phase ? { phase: extra.phase } : {})
    }
  })
  store.journalUpdate(id, { state: extra.state ?? 'running' })
  return store.journalGet(id)!
}

const phaseOf = (store: Store, id: string): string | undefined =>
  (JSON.parse(store.journalGet(id)!.payload || '{}') as { phase?: string }).phase

describe('smtpRefused: only a definite "no" may be retried', () => {
  it('counts an answer from the server as definite', () => {
    expect(smtpRefused({ code: 'EAUTH', responseCode: 535, command: 'AUTH PLAIN' })).toBe(true)
    expect(smtpRefused({ code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' })).toBe(true)
    expect(smtpRefused({ code: 'EMESSAGE', responseCode: 554, command: 'DATA' })).toBe(true)
    expect(smtpRefused({ code: 'EDNS', command: 'CONN' })).toBe(true)
  })

  it('counts a connection that never came up as definite', () => {
    expect(smtpRefused({ code: 'ESOCKET', originalCode: 'ECONNREFUSED', command: 'CONN' })).toBe(
      true
    )
    expect(smtpRefused({ code: 'ESOCKET', originalCode: 'EHOSTUNREACH', command: 'CONN' })).toBe(
      true
    )
  })

  it('counts a reset, a timeout or a close as unknown, whatever the label says', () => {
    // nodemailer labels all of these CONN, even after the content was sent
    expect(smtpRefused({ code: 'ESOCKET', originalCode: 'ECONNRESET', command: 'CONN' })).toBe(
      false
    )
    expect(smtpRefused({ code: 'ETIMEDOUT', command: 'CONN' })).toBe(false)
    expect(smtpRefused({ code: 'ECONNECTION', command: 'CONN' })).toBe(false)
    // a response code on a dropped connection proves nothing either
    expect(smtpRefused({ code: 'ECONNECTION', responseCode: 421, command: 'CONN' })).toBe(false)
    expect(smtpRefused({ code: 'EPIPE' })).toBe(false)
    expect(smtpRefused(new Error('something else'))).toBe(false)
    expect(smtpRefused(undefined)).toBe(false)
  })
})

describe('the send phases (MR-01, MR-43)', () => {
  it('sends once and files the mail', async () => {
    const store = openStore()
    const smtp = await fakeSmtp()
    const mailbox = sentMailbox()
    const op = enqueueSend(store)

    const result = await engine(store, smtp.port, mailbox).execute(op)

    expect(result.outcome).toBe('done')
    expect(smtp.messages).toHaveLength(1)
    expect(mailbox.filed).toHaveLength(1)
    expect(phaseOf(store, op.id)).toBe('sent')
  })

  it('never resends a send that was cut off in the SMTP phase: it probes', async () => {
    const store = openStore()
    const smtp = await fakeSmtp()
    // the quit or the crash left the op 'running' with phase 'smtp'; Sent does not have it
    const op = enqueueSend(store, { phase: 'smtp' })

    const result = await engine(store, smtp.port, sentMailbox()).execute(op)

    expect(smtp.commands).toHaveLength(0)
    expect(result.outcome).toBe('conflict')
    expect(store.journalGet(op.id)!.state).toBe('unknown')
  })

  it('resolves a cut-off send that the probe finds in Sent', async () => {
    const store = openStore()
    const smtp = await fakeSmtp()
    const op = enqueueSend(store, { phase: 'smtp' })

    const result = await engine(
      store,
      smtp.port,
      sentMailbox({ filed: [`Message-ID: <${MESSAGE_ID}>`] })
    ).execute(op)

    expect(smtp.commands).toHaveLength(0)
    expect(result.outcome).toBe('done')
  })

  it('files a delivered mail whose filing failed, without sending it again', async () => {
    const store = openStore()
    const smtp = await fakeSmtp()
    const mailbox = sentMailbox({ appendFails: true })
    const writes = engine(store, smtp.port, mailbox)
    const op = enqueueSend(store)

    const first = await writes.execute(op)

    // delivered, not filed: a failure that says so, and the phase says what is left
    expect(first.outcome).toBe('failed')
    expect(first.reason).toMatch(/already delivered/)
    expect(smtp.messages).toHaveLength(1)
    expect(phaseOf(store, op.id)).toBe('sent')

    mailbox.setAppendFails(false)
    store.journalUpdate(op.id, { state: 'pending' })
    const second = await writes.execute(store.journalGet(op.id)!)

    expect(second.outcome).toBe('done')
    expect(smtp.messages).toHaveLength(1)
    expect(mailbox.filed).toHaveLength(1)
  })
})

describe('ambiguous and definite SMTP failures', () => {
  it('marks a send unknown when the connection drops after the content', async () => {
    const store = openStore()
    const smtp = await fakeSmtp('drop')
    const mailbox = sentMailbox()
    const writes = engine(store, smtp.port, mailbox)
    const op = enqueueSend(store)

    const result = await writes.execute(op)

    expect(result.outcome).toBe('unknown')
    expect(store.journalGet(op.id)!.state).toBe('unknown')
    expect(phaseOf(store, op.id)).toBe('smtp')
    // the server has it - and a replay must not send it a second time
    expect(smtp.messages).toHaveLength(1)
    const replay = await writes.execute(store.journalGet(op.id)!)
    expect(replay.outcome).toBe('conflict')
    expect(smtp.messages).toHaveLength(1)
  })

  it('lets a send the server rejected go again: nothing went out', async () => {
    const store = openStore()
    const smtp = await fakeSmtp('reject')
    const op = enqueueSend(store)

    const result = await engine(store, smtp.port, sentMailbox()).execute(op)

    expect(result.outcome).toBe('failed')
    expect(phaseOf(store, op.id)).toBeUndefined()
    expect(smtp.messages).toHaveLength(0)
  })
})

describe('a throwing op body is an outcome, not a stranded op (MR-02)', () => {
  it('turns a refused connect into failed', async () => {
    const store = openStore()
    store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
    const id = store.journalEnqueue({
      accountId: ACCOUNT,
      kind: 'flag',
      folderPath: 'INBOX',
      folderUidValidity: '1',
      uid: 1,
      payload: { add: ['\\Seen'], remove: [] }
    })
    const writes = engine(store, 1, sentMailbox({ connectFails: true }))

    const result = await writes.execute(store.journalGet(id)!)

    expect(result.outcome).toBe('failed')
    expect(result.reason).toMatch(/ECONNREFUSED/)
  })

  it('turns a throw in the SMTP phase into unknown, recorded in the journal', async () => {
    const store = openStore()
    const op = enqueueSend(store)
    const writes = engine(store, 1, sentMailbox())
    ;(writes as unknown as { executeOne: () => Promise<unknown> }).executeOne = async () => {
      store.journalUpdate(op.id, { payload: { ...JSON.parse(op.payload!), phase: 'smtp' } })
      throw new Error('socket gone')
    }

    const result = await writes.execute(op)

    expect(result.outcome).toBe('unknown')
    expect(store.journalGet(op.id)!.state).toBe('unknown')
  })

  it('counts every run, so a replay can tell itself from a first run (MR-15)', async () => {
    const store = openStore()
    const smtp = await fakeSmtp()
    const op = enqueueSend(store)

    await engine(store, smtp.port, sentMailbox()).execute(op)

    expect(store.journalGet(op.id)!.attempts).toBe(1)
  })
})

describe('watchdog in the SMTP phase (MR-03, MR-16)', () => {
  it('answers unknown at once and keeps the op running until its body ends', async () => {
    vi.useFakeTimers()
    const store = openStore()
    const op = enqueueSend(store)
    const writes = engine(store, 1, sentMailbox())
    let release: () => void = () => undefined
    let bodyEnded = false
    ;(writes as unknown as { executeOne: () => Promise<unknown> }).executeOne = async () => {
      store.journalUpdate(op.id, { payload: { ...JSON.parse(op.payload!), phase: 'smtp' } })
      // a body that ignores its abort signal: SMTP hangs mid-transfer
      await new Promise<void>((resolve) => (release = resolve))
      bodyEnded = true
      return { outcome: 'done' }
    }

    const answer = writes.execute(op)
    await vi.advanceTimersByTimeAsync(120_000 + 1)
    await vi.advanceTimersByTimeAsync(15_000 + 1)
    const result = await answer

    expect(result.outcome).toBe('unknown')
    expect(store.journalGet(op.id)!.state).toBe('unknown')
    // the body still runs, so close() still has something to wait for
    let drained = false
    const drain = writes.drain(60_000).then(() => (drained = true))
    await vi.advanceTimersByTimeAsync(10)
    expect(drained).toBe(false)

    release()
    await drain
    expect(bodyEnded).toBe(true)
    expect(drained).toBe(true)
  })
})

describe('drain (MR-01: close waits for the op in flight)', () => {
  it('waits for a running op, bounded', async () => {
    const store = openStore()
    const smtp = await fakeSmtp()
    const mailbox = sentMailbox()
    const writes = engine(store, smtp.port, mailbox)
    const op = enqueueSend(store)

    const running = writes.execute(op)
    await writes.drain(10_000)

    // drained means the op reached its journal state, not just that it started
    expect(store.journalGet(op.id)!.attempts).toBe(1)
    expect(mailbox.filed).toHaveLength(1)
    expect((await running).outcome).toBe('done')
  })

  it('returns at once with nothing in flight', async () => {
    const writes = engine(openStore(), 1, sentMailbox())
    const started = Date.now()
    await writes.drain(10_000)
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})

describe('a stable Message-ID per mail (I2)', () => {
  const mail = {
    to: [{ name: '', email: 'empfaenger@example.test' }],
    cc: [],
    bcc: [],
    subject: 'Betreff',
    bodyText: 'Hallo',
    bodyHtml: null,
    attachments: [],
    inReplyTo: null,
    references: []
  }
  const opts = {
    from: { name: '', email: 'ich@example.test' },
    date: new Date('2026-01-01T09:00:00Z')
  }
  const key = 'a1b2c3d4-0000-4000-8000-00000000abcd'

  it('uses the editor key for a send, every time', async () => {
    const first = await composeMime({ ...mail, sendKey: key }, { ...opts, draft: false })
    const second = await composeMime({ ...mail, sendKey: key }, { ...opts, draft: false })
    expect(first.messageId).toBe(`${key}@example.test`)
    expect(second.messageId).toBe(first.messageId)
  })

  it('ignores the key for a draft and a key that is not a UUID', async () => {
    const draft = await composeMime({ ...mail, sendKey: key }, { ...opts, draft: true })
    expect(draft.messageId).not.toContain(key)
    const odd = await composeMime({ ...mail, sendKey: 'x>\r\nBcc: y' }, { ...opts, draft: false })
    expect(odd.messageId).not.toContain('Bcc')
  })
})

describe('the core around the send (MR-02, MR-05, MR-15)', () => {
  function scratchDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-send-core-'))
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
    return dir
  }

  /** A writable account whose server is unreachable; the store is seeded first */
  function core(dataDir: string, seed: (store: Store) => void) {
    const dir = path.join(dataDir, ACCOUNT)
    fs.mkdirSync(dir, { recursive: true })
    const store = new Store(dir, ACCOUNT)
    seed(store)
    store.close()
    const api = createMailCore({
      dataDir,
      accounts: [
        {
          id: ACCOUNT,
          readOnly: false,
          email: 'a@example.test',
          host: '127.0.0.1',
          port: 1,
          security: 'none' as const,
          credentials: async () => ({ user: 'a@example.test', pass: 'x' })
        }
      ]
    })
    cleanups.push(() => api.close())
    return api
  }

  it('refuses to retry a send whose outcome is unknown, and probes it on resolve', async () => {
    let opId = ''
    const api = core(scratchDir(), (store) => {
      opId = enqueueSend(store, { phase: 'smtp', state: 'unknown' }).id
    })

    await expect(api.retryOp(opId, ACCOUNT)).rejects.toThrow(/resolveOp/)
    // resolving probes; with no server reachable it stays a decision for the user
    const resolved = await api.resolveOp(opId, ACCOUNT)
    expect(resolved.outcome).toBe('conflict')
  }, 30_000)

  it('probes unknown sends on replay and keeps going when one op throws', async () => {
    let unknownId = ''
    let pendingId = ''
    const api = core(scratchDir(), (store) => {
      unknownId = enqueueSend(store, { phase: 'smtp', state: 'unknown' }).id
      store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
      pendingId = store.journalEnqueue({
        accountId: ACCOUNT,
        kind: 'flag',
        folderPath: 'INBOX',
        uid: 1,
        payload: { add: ['\\Seen'], remove: [] }
      })
    })
    const internals = api as unknown as { runOp: (e: unknown, op: JournalRow) => Promise<unknown> }
    const original = internals.runOp.bind(api)
    internals.runOp = async (e, op) => {
      if (op.kind === 'send') throw new Error('boom')
      return original(e, op)
    }

    const { results } = await api.replayPendingOps(ACCOUNT)

    expect(results[unknownId]).toBe('failed')
    // the throw did not stop the loop: the next op still ran
    expect(results[pendingId]).toBeDefined()
  }, 30_000)

  it('journals the Message-ID of a draft save, so a replay can find its copy', async () => {
    const api = core(scratchDir(), (store) => {
      store.upsertFolder({
        imapPath: 'Entwürfe',
        delimiter: '/',
        specialUse: '\\Drafts',
        uidValidity: '1'
      })
    })

    // the server is unreachable, so the save fails - the journal row is what counts
    await api
      .saveDraft(
        {
          to: [],
          cc: [],
          bcc: [],
          subject: 'x',
          bodyText: 'y',
          bodyHtml: null,
          attachments: [],
          inReplyTo: null,
          references: []
        },
        null,
        ACCOUNT
      )
      .catch(() => undefined)

    const ops = await api.listOps(ACCOUNT)
    const draft = ops.find((o) => o.kind === 'draft_save')
    expect(draft?.messageId).toMatch(/^[0-9a-f-]{36}@example\.test$/)
  }, 30_000)

  it('journals the editor session key of a draft save, never as its Message-ID (I17)', async () => {
    const dataDir = scratchDir()
    const api = core(dataDir, (store) => {
      store.upsertFolder({
        imapPath: 'Entwürfe',
        delimiter: '/',
        specialUse: '\\Drafts',
        uidValidity: '1'
      })
    })
    const key = '0f8e2b7a-3c41-4d5e-9a6b-7c8d9e0f1a2b'
    const draft = (sendKey: string) => ({
      to: [],
      cc: [],
      bcc: [],
      subject: 'x',
      bodyText: 'y',
      bodyHtml: null,
      attachments: [],
      inReplyTo: null,
      references: [],
      sendKey
    })

    await api.saveDraft(draft(key), null, ACCOUNT).catch(() => undefined)
    await api.saveDraft(draft('not-a-key'), null, ACCOUNT).catch(() => undefined)
    await api.close()

    const store = new Store(path.join(dataDir, ACCOUNT), ACCOUNT)
    cleanups.push(() => store.close())
    const rows = store.db
      .prepare(
        "SELECT compose_key, message_id FROM op_journal WHERE kind = 'draft_save' ORDER BY rowid"
      )
      .all() as { compose_key: string | null; message_id: string }[]
    expect(rows.map((r) => r.compose_key)).toEqual([key, null])
    expect(rows[0].message_id.startsWith(key)).toBe(false)
  }, 30_000)
})
