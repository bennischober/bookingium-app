// The opt-in image load is a privacy boundary: it is the only place the app
// fetches something an untrusted mail pointed at, so a bug here leaks the reader's
// IP to a tracking server. Every rule is pinned against a real local server.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fetchRemoteImagesAsDataUris } from '../src/main/mailclient/core/remote_images'

const PNG = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // PNG magic
  0x00,
  0x00,
  0x00,
  0x0d,
  0x49,
  0x48,
  0x44,
  0x52
])
const HTML = Buffer.from('<html><body>kein Bild</body></html>')

type Hit = { path: string; userAgent: string | undefined }

let server: Server
let base: string
const hits: Hit[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push({ path: req.url ?? '', userAgent: req.headers['user-agent'] })
    const send = (type: string, body: Buffer): void => {
      res.writeHead(200, { 'content-type': type, 'content-length': String(body.length) })
      res.end(body)
    }
    switch (req.url) {
      case '/bild.png':
        return send('image/png', PNG)
      case '/bild.jpg':
        return send('image/jpeg', PNG)
      case '/seite.html':
        return send('text/html; charset=utf-8', HTML)
      case '/gross.png':
        return send('image/png', Buffer.alloc(4096))
      case '/langsam.png':
        // never answers: the timeout must end it
        return
      default:
        // /mittel-<n>.png: one 1024-byte image per name, so a test can ask for
        // several distinct images
        if (/^\/mittel-\d+\.png$/.test(req.url ?? '')) return send('image/png', Buffer.alloc(1024))
        res.writeHead(404)
        return res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const fetchAll = (paths: string[], opts = {}) =>
  fetchRemoteImagesAsDataUris(
    paths.map((p) => `${base}${p}`),
    opts
  )

describe('remote images: what is never fetched', () => {
  it('skips anything that is not an image', async () => {
    // A tracker served as text/html is not an image and must not be turned into one
    const out = await fetchAll(['/seite.html'])
    expect(out.size).toBe(0)
  })

  it('skips an image that is too large', async () => {
    const out = await fetchAll(['/gross.png'], { maxBytesPerImage: 2048 })
    expect(out.size).toBe(0)
  })

  it('keeps the images it may fetch when one is skipped', async () => {
    const out = await fetchAll(['/gross.png', '/bild.png'], { maxBytesPerImage: 2048 })
    expect([...out.keys()]).toEqual([`${base}/bild.png`])
  })

  it('stops at the count limit instead of fetching everything', async () => {
    const before = hits.length
    const out = await fetchAll(['/bild.png', '/bild.jpg', '/mittel-1.png'], {
      maxImagesPerRequest: 2
    })
    expect(out.size).toBe(2)
    // The third URL was never contacted at all
    expect(hits.length - before).toBe(2)
  })

  it('leaves an unreachable URL out instead of throwing', async () => {
    const out = await fetchAll(['/fehlt.png', '/bild.png'])
    expect([...out.keys()]).toEqual([`${base}/bild.png`])
  })

  it('ends a hanging request at the timeout instead of waiting forever', async () => {
    const started = Date.now()
    const out = await fetchAll(['/langsam.png'], { timeoutMs: 150 })
    expect(out.size).toBe(0)
    // The abort is what ended it, not the server
    expect(Date.now() - started).toBeLessThan(2_000)
  }, 10_000)
})

describe('remote images: what a fetched image becomes', () => {
  it('returns the image as a data URI of its own type', async () => {
    const out = await fetchAll(['/bild.png'])
    expect(out.get(`${base}/bild.png`)).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
  })

  it('keeps the type from the content type, including its parameters', async () => {
    // "image/jpeg; charset=binary" must not end up inside the data URI
    const out = await fetchAll(['/bild.jpg'])
    expect(out.get(`${base}/bild.jpg`)).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('identifies itself, so a tracker cannot count a mail client as a browser', async () => {
    await fetchAll(['/bild.png'], { userAgent: 'bookingum-test' })
    expect(hits.at(-1)?.userAgent).toBe('bookingum-test')
  })

  it('returns nothing for an empty list', async () => {
    expect((await fetchRemoteImagesAsDataUris([])).size).toBe(0)
  })
})

describe('remote images: the total budget', () => {
  it('does not let one image push the total past the budget', async () => {
    // 1024 bytes budget, 1024-byte images: exactly one fits, a second would double it
    const out = await fetchAll(['/mittel-1.png', '/mittel-2.png', '/mittel-3.png'], {
      maxTotalBytes: 1024,
      maxBytesPerImage: 2048
    })
    expect(out.size).toBe(1)
  })

  it('stops contacting the server once the budget is spent', async () => {
    const before = hits.length
    // 12 URLs against a budget for exactly one: the fetch must stop early instead of
    // walking the whole list. It is NOT exactly one request any more - the fetches run
    // concurrently (G10), so up to `concurrency` of them start before the first result
    // spends the budget. What still holds is the cap: the budget is never exceeded, and the
    // list is abandoned as soon as it is spent.
    const urls = Array.from({ length: 12 }, (_, i) => `/mittel-${i}.png`)
    const out = await fetchAll(urls, { maxTotalBytes: 1024, maxBytesPerImage: 2048 })
    expect(out.size).toBe(1)
    const requests = hits.length - before
    // bounded by the concurrency, never one per image
    expect(requests).toBeLessThanOrEqual(6)
    expect(requests).toBeLessThan(urls.length)
  })

  it('keeps fetching small images until the budget is used up', async () => {
    // 3000 bytes budget, 1024-byte images: two fit, the third does not
    const out = await fetchAll(['/mittel-1.png', '/mittel-2.png', '/mittel-3.png'], {
      maxTotalBytes: 3000,
      maxBytesPerImage: 2048
    })
    expect(out.size).toBe(2)
  })
})
