// Loading remote images must not be one round-trip after another.
//
// Measured before this change: 10 images at 120 ms each took 1279 ms, i.e. exactly sequential. A
// marketing mail with 72 images spends most of its time waiting on nothing, which is the reported
// "super slow" button.
//
// These tests pin the three properties that make it fast without making it unsafe:
//   - images are fetched concurrently (bounded),
//   - one dead host costs its own timeout, not the whole batch,
//   - the size budget still holds under concurrency.
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchRemoteImagesAsDataUris } from '../src/main/mailclient/core/remote_images'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

let server: Server | null = null
afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()))
  server = null
})

/** A server that answers each image after `delayMs`, and counts the peak concurrent requests */
async function startServer(delayMs: number): Promise<{ base: string; peak: () => number }> {
  let inFlight = 0
  let peak = 0
  server = createServer((_req, res) => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    setTimeout(() => {
      inFlight -= 1
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(PNG.length) })
      res.end(PNG)
    }, delayMs)
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  const port = (server!.address() as { port: number }).port
  return { base: `http://127.0.0.1:${port}`, peak: () => peak }
}

describe('remote images: fetched concurrently, not one by one', () => {
  it('loads 10 images in roughly one delay, not ten', async () => {
    // The regression: a sequential loop makes this ~10 x 120 ms. Concurrency makes it ~120 ms.
    const { base } = await startServer(120)
    const urls = Array.from({ length: 10 }, (_, i) => `${base}/img${i}.png`)
    const t0 = performance.now()
    const got = await fetchRemoteImagesAsDataUris(urls)
    const elapsed = performance.now() - t0

    expect(got.size).toBe(10)
    // generous: one delay plus overhead, well under the sequential 1200 ms
    expect(elapsed).toBeLessThan(600)
  }, 30_000)

  it('keeps several requests in flight at once', () => {
    // the peak, observed by the server, proves the pool rather than trusting the timing
    return (async () => {
      const { base, peak } = await startServer(80)
      const urls = Array.from({ length: 12 }, (_, i) => `${base}/p${i}.png`)
      await fetchRemoteImagesAsDataUris(urls)
      expect(peak()).toBeGreaterThan(1)
      // and it stays bounded: never one socket per image
      expect(peak()).toBeLessThanOrEqual(6)
    })()
  }, 30_000)

  it('does not let one dead host stall the others', async () => {
    // A port nobody listens on: its fetch fails fast, the rest must still load
    const { base } = await startServer(20)
    const urls = [`${base}/ok1.png`, 'http://127.0.0.1:1/dead.png', `${base}/ok2.png`]
    const got = await fetchRemoteImagesAsDataUris(urls, { timeoutMs: 2000 })
    expect(got.size).toBe(2)
    expect(got.has(urls[0])).toBe(true)
    expect(got.has(urls[2])).toBe(true)
  }, 30_000)

  it('holds the size budget even when fetches finish out of order', async () => {
    // two images of 1 KB each with a 1.5 KB budget: exactly one may be stored
    const big = Buffer.alloc(1024, 1)
    server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(big.length) })
      res.end(big)
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
    const port = (server!.address() as { port: number }).port
    const urls = Array.from({ length: 8 }, (_, i) => `http://127.0.0.1:${port}/b${i}.png`)
    const got = await fetchRemoteImagesAsDataUris(urls, { maxTotalBytes: 1536 })
    expect(got.size).toBe(1)
  }, 30_000)

  it('reports progress after every image', async () => {
    // the UI needs to say "3 von 12", so progress must arrive per image, not once at the end
    const { base } = await startServer(10)
    const urls = Array.from({ length: 6 }, (_, i) => `${base}/q${i}.png`)
    const seen: number[] = []
    await fetchRemoteImagesAsDataUris(urls, { onProgress: (done) => seen.push(done) })
    expect(seen).toHaveLength(6)
    expect(seen[seen.length - 1]).toBe(6)
  }, 30_000)

  it('never inlines an SVG, which can carry script', async () => {
    // SVG is an active format; it stays blocked even when the server offers it
    server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
      res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
    const port = (server!.address() as { port: number }).port
    const got = await fetchRemoteImagesAsDataUris([`http://127.0.0.1:${port}/x.svg`])
    expect(got.size).toBe(0)
  }, 30_000)
})
