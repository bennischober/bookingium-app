// G2: every write op must announce itself, not just a send.
//
// The H2 indicator was wired for sends only, because the 'running' event was emitted in
// sendMail. A move or a delete therefore showed nothing while the server worked - exactly
// the actions the user described as "feels unresponsive". The announcement now lives in
// runOp(), the single place an op is executed.
//
// Driven through a real moveToFolder against an unreachable server: the running event must
// be emitted BEFORE the connection is attempted, which is what makes it observable here.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMailCore, type MailCoreEvent } from '../src/main/mailclient/core/index'
import { Store } from '../src/main/mailclient/core/store'

const ACCOUNT = 'ops2'
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function scratchDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-opsevents-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const mkCore = (dataDir: string) =>
  createMailCore({
    dataDir,
    accounts: [
      {
        id: ACCOUNT,
        readOnly: false,
        email: 'a@example.test',
        host: '127.0.0.1',
        port: 1, // unreachable on purpose: the op is announced before it connects
        security: 'none' as const,
        credentials: async () => ({ user: 'a@example.test', pass: 'x' })
      }
    ]
  })

/** A stored mail in INBOX plus a Trash folder, so a delete has something to act on */
function seedMail(dataDir: string): { inboxId: string } {
  const dir = path.join(dataDir, ACCOUNT)
  fs.mkdirSync(dir, { recursive: true })
  const store = new Store(dir, ACCOUNT)
  const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/' })
  store.upsertFolder({ imapPath: 'Trash', delimiter: '/', specialUse: '\\Trash' })
  store.insertMessage({
    account_id: ACCOUNT,
    folder_id: inbox.id,
    uid: 7,
    message_key: 'key-7',
    file_path: 'msg.eml',
    message_id: '<7@example.test>',
    in_reply_to: null,
    references_json: '[]',
    thread_id: null,
    date: '2026-01-01T09:00:00.000Z',
    internal_date: '2026-01-01T09:00:00.000Z',
    subject: 'Weg damit',
    from_name: 'Absender',
    from_email: 'absender@example.test',
    to_json: '[]',
    cc_json: '[]',
    bcc_json: '[]',
    flags_json: '{"seen":false,"flagged":false,"draft":false,"deleted":false,"answered":false}',
    modseq: null,
    has_attachments: 0,
    attachments_json: '[]',
    size_bytes: 10,
    snippet: 'Weg damit',
    parsed_ok: 1,
    parse_error: null,
    body_text: 'Weg damit',
    body_html: '<p>Weg damit</p>'
  })
  fs.writeFileSync(path.join(dir, 'msg.eml'), 'Subject: Weg damit\r\n\r\nx\r\n')
  store.close()
  return { inboxId: inbox.id }
}

describe('G2: a delete announces itself like a send does', () => {
  it('emits running for a delete, not only the result', async () => {
    const dataDir = scratchDir()
    const { inboxId } = seedMail(dataDir)
    const api = mkCore(dataDir)
    const seen: { kind: string; outcome: string }[] = []
    api.on('op-event', (event: MailCoreEvent) => {
      if (event.type === 'op-event') seen.push({ kind: event.kind, outcome: event.outcome })
    })

    const message = (await api.listMessages(inboxId, { offset: 0, limit: 10 }, ACCOUNT))[0]
    try {
      await api.deleteToTrash([message.id], ACCOUNT).catch(() => undefined)
    } finally {
      // I17: close() now waits for the sync work the failed delete left in flight, so the folder can
      // only be removed once it is done
      await api.close()
    }

    // The regression: before runOp() existed, a move/delete emitted no 'running' at all
    expect(seen.some((e) => e.outcome === 'running')).toBe(true)
  }, 30_000)
})
