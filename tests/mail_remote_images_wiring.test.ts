// H5a: "Bilder laden" must actually load the images.
//
// The button was a no-op. loadRemoteImages() returns early unless
// options.remoteImages.enabled is set, and the WORKER never passed remoteImages at all -
// so the core's (correct) fetch path was never reached and the UI got the same blocked
// HTML back.
//
// This suite stores a real message with a remote image, then compares the HTML before and
// after the call: that is the assertion the old behaviour failed.
//
// Note which test covers which half, because only one of them catches the regression:
//   - "changes the rendered mail" and "untouched when the option is off" cover the CORE,
//     which was always correct - they pass with or without the worker fix.
//   - "the worker passes the option" is the one that fails when the wiring is missing.
// Do not drop the last test: it is the only guard against the regression recurring.
import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createMailCore, type MailCore } from '../src/main/mailclient/core/index'
import { Store } from '../src/main/mailclient/core/store'

const ACCOUNT = 'images'
// A 1x1 PNG, so the fetch returns a real image
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

let server: Server
let imageUrl: string
let root: string

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/pic.png') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(PNG.length) })
      res.end(PNG)
    } else {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  imageUrl = `http://127.0.0.1:${port}/pic.png`
  root = mkdtempSync(join(tmpdir(), 'bookingum-mail-images-'))
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(root, { recursive: true, force: true })
})

/**
 * A core with one stored message whose HTML contains the remote image.
 *
 * `enabled` is the option the worker was missing. The IMAP endpoint is unreachable on
 * purpose: nothing in this test talks to a mail server.
 */
async function coreWithImage(enabled: boolean): Promise<{ api: MailCore; id: number }> {
  const dataDir = mkdtempSync(join(root, 'core-'))
  // The core keeps each account in <dataDir>/<accountId>/, so the message must be
  // written there - otherwise the core opens a fresh database and finds nothing.
  const dir = join(dataDir, ACCOUNT)
  mkdirSync(dir, { recursive: true })
  const store = new Store(dir, ACCOUNT)
  const folder = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/' })
  const file = 'msg.eml'
  writeFileSync(join(dir, file), 'Subject: Bild\r\n\r\nx\r\n')
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
    subject: 'Bild',
    from_name: 'Absender',
    from_email: 'absender@example.test',
    to_json: '[]',
    cc_json: '[]',
    bcc_json: '[]',
    flags_json: '{"seen":false,"flagged":false,"draft":false,"deleted":false,"answered":false}',
    modseq: null,
    has_attachments: 0,
    attachments_json: '[]',
    size_bytes: 40,
    snippet: 'Bild',
    parsed_ok: 1,
    parse_error: null,
    body_text: 'Bild',
    body_html: `<p>Bild</p><img src="${imageUrl}">`
  })
  store.close()

  const api = createMailCore({
    dataDir,
    accounts: [
      {
        id: ACCOUNT,
        kind: 'sandbox',
        host: '127.0.0.1',
        port: 1,
        security: 'none',
        credentials: async () => ({ user: 'a@example.test', pass: 'x' })
      }
    ],
    remoteImages: { enabled }
  })
  return { api, id }
}

describe('H5a: "Bilder laden" changes the rendered mail', () => {
  it('replaces the blocked placeholder with the fetched image', async () => {
    const { api, id } = await coreWithImage(true)
    try {
      const before = await api.getMessage(id, ACCOUNT)
      // Blocked by default: the manifest lists the URL, the HTML carries a placeholder
      expect(before.remoteImageCount).toBe(1)
      expect(before.html).not.toContain('data:image/png')

      const after = await api.loadRemoteImages(id, before.remoteImages, ACCOUNT)

      // This is the assertion the old wiring failed: the HTML must now hold the image
      expect(after.html).toContain('data:image/png')
      expect(after.html).not.toBe(before.html)
    } finally {
      api.close()
    }
  }, 30_000)

  it('leaves the mail untouched when the option is off', async () => {
    // Exactly the shape the worker had: the guard fires and nothing is fetched
    const { api, id } = await coreWithImage(false)
    try {
      const before = await api.getMessage(id, ACCOUNT)
      const after = await api.loadRemoteImages(id, before.remoteImages, ACCOUNT)
      expect(after.html).toBe(before.html)
      expect(after.html).not.toContain('data:image/png')
    } finally {
      api.close()
    }
  }, 30_000)
})

describe('H5a: the worker passes the option to the core', () => {
  it('sends remoteImages.enabled', async () => {
    // The regression lived in worker.ts, which cannot be started without Electron's
    // parentPort, so the wiring is asserted at the source.
    const { readFileSync } = await import('fs')
    const source = readFileSync(join(process.cwd(), 'src/main/mailclient/worker.ts'), 'utf8')
    expect(source).toMatch(/remoteImages:\s*\{\s*enabled:\s*true\s*\}/)
  })
})
