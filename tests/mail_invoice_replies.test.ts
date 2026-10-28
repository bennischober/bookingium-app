// C4: an invoice knows its own mails and the answers to them. The matching runs in the
// mail store (In-Reply-To/References), so it is tested against a real store, not a mock:
// a reply that quotes the invoice's Message-ID either way must be found, an unrelated
// mail must not.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMailCore } from '../src/main/mailclient/core/index'
import { Store, type MessageRow } from '../src/main/mailclient/core/store'

const ACCOUNT = 'replies'
const cleanups: (() => void)[] = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()!
    try {
      await fn()
    } catch {
      /* best effort */
    }
  }
})

function scratchDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-replies-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const mkOptions = (dataDir: string) => ({
  dataDir,
  accounts: [
    {
      id: ACCOUNT,
      readOnly: false,
      host: '127.0.0.1',
      port: 10199, // deliberately unreachable: this test never contacts a server
      security: 'none' as const,
      user: 'replies@example.test',
      pass: 'testpass'
    }
  ],
  sandbox: {
    imapHost: '127.0.0.1',
    imapPort: 10143,
    smtpHost: '127.0.0.1',
    smtpPort: 1025,
    user: 'u',
    pass: 'p'
  }
})

type Seed = {
  uid: number
  messageId: string
  inReplyTo?: string | null
  references?: string[]
}

/** Rows exactly as a finished sync leaves them in the account's store */
function seedMessages(dir: string, rows: Seed[]): void {
  const store = new Store(path.join(dir, ACCOUNT), ACCOUNT)
  cleanups.push(() => store.close())
  // messages hang off a folder; the sync would have created INBOX first
  const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
  for (const row of rows) {
    const full: Omit<MessageRow, 'id'> = {
      account_id: ACCOUNT,
      folder_id: inbox.id,
      uid: row.uid,
      message_key: `key-${row.uid}`,
      file_path: `INBOX/${row.uid}.eml`,
      message_id: row.messageId,
      in_reply_to: row.inReplyTo ?? null,
      references_json: JSON.stringify(row.references ?? []),
      thread_id: null,
      date: `2026-10-2${row.uid}T10:00:00.000Z`,
      internal_date: null,
      subject: `Mail ${row.uid}`,
      from_name: 'Absender',
      from_email: 'sender@example.test',
      to_json: JSON.stringify([{ name: 'Ich', email: 'replies@example.test' }]),
      cc_json: '[]',
      bcc_json: '[]',
      flags_json: '[]',
      modseq: null,
      has_attachments: 0,
      attachments_json: '[]',
      size_bytes: 100,
      body_text: 'Text',
      body_html: null,
      snippet: 'Text',
      parsed_ok: 1,
      parse_error: null
    }
    store.insertMessage(full)
  }
}

describe('C4: replies to an invoice mail', () => {
  it('finds a reply by In-Reply-To, with or without angle brackets', async () => {
    const dir = scratchDir()
    seedMessages(dir, [
      { uid: 1, messageId: '<invoice-1040@example.test>' },
      { uid: 2, messageId: '<answer@example.test>', inReplyTo: '<invoice-1040@example.test>' },
      { uid: 3, messageId: '<unrelated@example.test>' }
    ])

    const core = createMailCore(mkOptions(dir))
    cleanups.push(() => core.close())

    // the app DB stores the Message-ID without its angle brackets
    const found = await core.findReplies(['invoice-1040@example.test'], ACCOUNT)
    expect(found.map((m) => m.messageId)).toEqual(['<answer@example.test>'])
  })

  it('finds a reply that only quotes the invoice mail in References', async () => {
    const dir = scratchDir()
    seedMessages(dir, [
      { uid: 1, messageId: '<invoice@example.test>' },
      {
        uid: 2,
        messageId: '<answer@example.test>',
        // a reply to the reply still quotes the original
        references: ['<other@example.test>', '<invoice@example.test>']
      }
    ])

    const core = createMailCore(mkOptions(dir))
    cleanups.push(() => core.close())

    const found = await core.findReplies(['<invoice@example.test>'], ACCOUNT)
    expect(found.map((m) => m.messageId)).toEqual(['<answer@example.test>'])
  })

  it('returns nothing for an invoice nobody answered', async () => {
    const dir = scratchDir()
    seedMessages(dir, [
      { uid: 1, messageId: '<invoice@example.test>' },
      { uid: 2, messageId: '<unrelated@example.test>' }
    ])

    const core = createMailCore(mkOptions(dir))
    cleanups.push(() => core.close())

    expect(await core.findReplies(['invoice@example.test'], ACCOUNT)).toEqual([])
    expect(await core.findReplies([], ACCOUNT)).toEqual([])
  })

  it('does not treat the invoice mail itself as its own reply', async () => {
    const dir = scratchDir()
    seedMessages(dir, [{ uid: 1, messageId: '<invoice@example.test>' }])

    const core = createMailCore(mkOptions(dir))
    cleanups.push(() => core.close())

    expect(await core.findReplies(['invoice@example.test'], ACCOUNT)).toEqual([])
  })
})
