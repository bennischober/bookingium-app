// The remote-image type allowlist, pinned as a rule rather than through one happy path.
//
// This regex is the only thing between an email's <img src> and an arbitrary fetch that gets inlined
// into the reader as a data: URI. A "cleanup" that loosened it would not fail any existing test, so the
// allowlist and the denylist are both written out here.
//
// The SVG case is the one that mattered: image/svg+xml used to be allowed and was removed, because an SVG
// is a document - it can carry <script> and remote references of its own.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fetchRemoteImagesAsDataUris } from '../src/main/mailclient/core/remote_images'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    const name = (req.url ?? '/').slice(1)
    // every URL serves a real PNG body; only the Content-Type differs, so the test isolates the
    // type check from the payload and from reachability
    res.writeHead(200, { 'Content-Type': name, 'Content-Length': String(PNG.length) })
    res.end(PNG)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

const fetchType = async (type: string): Promise<Map<string, string>> =>
  fetchRemoteImagesAsDataUris([`${base}/${type}`])

describe('remote image type allowlist', () => {
  it('accepts the types a mail actually uses', async () => {
    for (const type of [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/x-icon'
    ]) {
      const out = await fetchType(type)
      expect(out.size, type).toBe(1)
      expect([...out.values()][0]).toMatch(new RegExp(`^data:${type};base64,`))
    }
  })

  it('accepts image/jpg as well as image/jpeg', async () => {
    // non-standard but seen in the wild; jpe?g covers both
    expect((await fetchType('image/jpg')).size).toBe(1)
  })

  it('refuses an SVG, which is a document and can carry script', async () => {
    // the removal this test exists to keep: an SVG inlined as a data: URI renders as a document
    expect((await fetchType('image/svg+xml')).size).toBe(0)
  })

  it('refuses a non-image that a tracker would be served as', async () => {
    for (const type of [
      'text/html',
      'text/plain',
      'application/javascript',
      'application/octet-stream'
    ]) {
      expect((await fetchType(type)).size, type).toBe(0)
    }
  })

  it('refuses an image type with a suffix or parameter smuggled in', async () => {
    // the check runs on the type alone, so "image/png+xml" must not pass as png
    for (const type of ['image/png+xml', 'image/svg', 'image/png2', 'ximage/png']) {
      expect((await fetchType(type)).size, type).toBe(0)
    }
  })

  it('accepts a type in any case, because Content-Type is case-insensitive', async () => {
    // RFC 9110: the media type is case-insensitive. Before the fix this legitimate image was
    // silently dropped and the reader showed a broken image.
    expect((await fetchType('IMAGE/PNG')).size).toBe(1)
    expect((await fetchType('Image/Jpeg')).size).toBe(1)
  })

  it('still refuses an SVG in any case', async () => {
    // normalising must not open the door the allowlist closed
    expect((await fetchType('IMAGE/SVG+XML')).size).toBe(0)
  })
})
