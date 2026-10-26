// G10: the core must report image progress, or the button cannot say "3 von 12".
//
// Without it a 72-image marketing mail shows one opaque spinner for the whole load, which is
// indistinguishable from a hang. The event travels: core -> worker -> protocol -> renderer.
//
// This drives the real loadRemoteImages() and asserts the emitted event sequence, because a progress
// indicator that never fires is worse than none - it looks like the feature is stuck.
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMailCore, type MailCoreEvent } from '../src/main/mailclient/core/index'
import { Store } from '../src/main/mailclient/core/store'

const ACCOUNT = 'progress'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

let server: Server
let root: string
let imageUrl: string

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(PNG.length) })
    res.end(PNG)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as { port: number }).port
  imageUrl = `http://127.0.0.1:${port}/pic.png`
  root = mkdtempSync(join(tmpdir(), 'bookingum-progress-'))
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  rmSync(root, { recursive: true, force: true })
})

/** A core holding one message with N remote images */
async function coreWithImages(
  count: number
): Promise<{ api: ReturnType<typeof createMailCore>; id: number }> {
  const dataDir = mkdtempSync(join(root, 'core-'))
  const dir = join(dataDir, ACCOUNT)
  mkdirSync(dir, { recursive: true })
  const store = new Store(dir, ACCOUNT)
  const folder = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/' })
  const file = 'msg.eml'
  writeFileSync(join(dir, file), 'Subject: Bilder\r\n\r\nx\r\n')
  const imgs = Array.from({ length: count }, () => `<img src="${imageUrl}">`).join('')
  const id = store.insertMessage({
    account_id: ACCOUNT,
    folder_id: folder.id,
    uid: 1,
    message_key: 'key-1',
    file_path: file,
    message_id: '<1@example.test>',
    in_reply_to: null,
    references_json: '[]',
    thread_id: null,
    date: '2026-01-01T09:00:00.000Z',
    internal_date: '2026-01-01T09:00:00.000Z',
    subject: 'Bilder',
    from_name: 'A',
    from_email: 'a@example.test',
    to_json: '[]',
    cc_json: '[]',
    bcc_json: '[]',
    flags_json: '{"seen":false,"flagged":false,"draft":false,"deleted":false,"answered":false}',
    modseq: null,
    has_attachments: 0,
    attachments_json: '[]',
    size_bytes: 40,
    snippet: 'Bilder',
    parsed_ok: 1,
    parse_error: null,
    body_text: 'Bilder',
    body_html: `<p>Bilder</p>${imgs}`
  })
  store.close()

  const api = createMailCore({
    dataDir,
    accounts: [
      {
        id: ACCOUNT,
        kind: 'sandbox',
        canary: true,
        readOnly: false,
        email: 'a@example.test',
        host: '127.0.0.1',
        port: 1,
        security: 'none',
        credentials: async () => ({ user: 'a@example.test', pass: 'x' })
      }
    ],
    // I11: the test server is on loopback, which is blocked otherwise
    remoteImages: { enabled: true, blockedAddress: () => false }
  })
  return { api, id }
}

describe('G10: image loading reports progress', () => {
  it('emits one progress event per image', async () => {
    // the 72-image case, scaled down: the button must be able to count
    const { api, id } = await coreWithImages(5)
    const seen: { done: number; total: number }[] = []
    api.on('image-progress', (event: MailCoreEvent) => {
      if (event.type === 'image-progress') seen.push({ done: event.done, total: event.total })
    })
    try {
      const before = await api.getMessage(id, ACCOUNT)
      expect(before.remoteImageCount).toBe(5)
      await api.loadRemoteImages(id, before.remoteImages, ACCOUNT)
    } finally {
      api.close()
    }
    // one event per image, counting up to the total
    expect(seen).toHaveLength(5)
    expect(seen[0].total).toBe(5)
    expect(seen[seen.length - 1]).toEqual({ done: 5, total: 5 })
  }, 60_000)

  it('names the message the progress belongs to', async () => {
    // two mails open at once must not mix their counters
    const { api, id } = await coreWithImages(2)
    const ids: number[] = []
    api.on('image-progress', (event: MailCoreEvent) => {
      if (event.type === 'image-progress') ids.push(event.messageId)
    })
    try {
      const before = await api.getMessage(id, ACCOUNT)
      await api.loadRemoteImages(id, before.remoteImages, ACCOUNT)
    } finally {
      api.close()
    }
    expect(new Set(ids)).toEqual(new Set([id]))
  }, 60_000)
})
