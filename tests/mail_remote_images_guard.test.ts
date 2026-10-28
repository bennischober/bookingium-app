// I11 (MR-22): "Bilder laden" fetches what a stranger's mail names, so the fetch is fenced in.
//
// Before: `fetch(url, { redirect: 'follow' })` with the timer cleared once the headers arrived and
// an unbounded `arrayBuffer()`. A mail could point it at the router or a service on localhost
// (directly or through a redirect), and a server that sent headers and then trickled, or sent a
// gigabyte, held the slot and the memory for as long as it liked.
//
// The test server is on loopback, which the fetcher refuses by default - so the tests that need
// it through replace `blockedAddress`, and the ones about the default use it as it ships.
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchRemoteImagesAsDataUris,
  isPrivateAddress
} from '../src/main/mailclient/core/remote_images'

// One name answers with a loopback AND a public address (192.0.2.1, TEST-NET, never routed), the
// way a rebinding resolver would; every other name resolves for real
type Answer = { address: string; family: number }
vi.mock('dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dns')>()
  const lookup = (
    hostname: string,
    options: object,
    callback: (...args: unknown[]) => void
  ): void => {
    if (hostname === 'gemischt.example.test') {
      const answers: Answer[] = [
        { address: '127.0.0.1', family: 4 },
        { address: '192.0.2.1', family: 4 }
      ]
      callback(null, answers)
      return
    }
    ;(actual.lookup as unknown as typeof lookup)(hostname, options, callback)
  }
  return { ...actual, default: { ...actual, lookup }, lookup }
})

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

let server: Server
let port = 0
let base = ''
const hits: string[] = []
const open = new Set<import('http').ServerResponse>()
// A second server on 127.0.0.2, the "private host" a redirect points at: a hop that reaches it
// shows up here, so a refused hop cannot pass for an unreachable one
let other: Server
const otherHits: string[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    hits.push(url.pathname)
    if (url.pathname === '/ok.png') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(PNG.length) })
      res.end(PNG)
    } else if (url.pathname === '/to') {
      res.writeHead(302, { Location: url.searchParams.get('target') ?? '/' }).end()
    } else if (url.pathname === '/loop') {
      res.writeHead(302, { Location: '/loop' }).end()
    } else if (url.pathname === '/big-chunked') {
      // No Content-Length: the size is only known while reading
      res.writeHead(200, { 'Content-Type': 'image/png' })
      for (let i = 0; i < 8; i++) res.write(Buffer.alloc(512))
      res.end()
    } else if (url.pathname === '/endless') {
      // A body that never ends on its own: only the byte cap stops the reader before the timeout
      res.writeHead(200, { 'Content-Type': 'image/png' })
      const timer = setInterval(() => res.write(Buffer.alloc(512)), 5)
      res.on('close', () => clearInterval(timer))
      open.add(res)
    } else if (url.pathname === '/big-declared') {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': String(10 * 1024 * 1024)
      })
      res.write(Buffer.alloc(16))
      open.add(res)
    } else if (url.pathname === '/stall') {
      // Headers and a first chunk, then nothing - the body never ends
      res.writeHead(200, { 'Content-Type': 'image/png' })
      res.write(PNG.subarray(0, 8))
      open.add(res)
    } else {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
  base = `http://127.0.0.1:${port}`
  other = createServer((req, res) => {
    otherHits.push(req.url ?? '')
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(PNG.length) })
    res.end(PNG)
  })
  await new Promise<void>((resolve) => other.listen(port, '127.0.0.2', resolve))
})

afterAll(async () => {
  for (const res of open) res.destroy()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await new Promise<void>((resolve) => other.close(() => resolve()))
})

beforeEach(() => {
  hits.length = 0
  otherHits.length = 0
})

const LOCAL = { blockedAddress: (): boolean => false }

describe('I11 (MR-22): private addresses', () => {
  it('classifies loopback, private, link-local and multicast as private', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.5.4',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fd12:3456::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      'kein-ip'
    ]) {
      expect(isPrivateAddress(address), address).toBe(true)
    }
    for (const address of [
      '8.8.8.8',
      '93.184.215.14',
      '172.32.0.1',
      '100.128.0.1',
      '2a00:1450:4001::1',
      '::ffff:8.8.8.8'
    ]) {
      expect(isPrivateAddress(address), address).toBe(false)
    }
  })

  it('never connects to a loopback address by default', async () => {
    const out = await fetchRemoteImagesAsDataUris([`${base}/ok.png`, `http://[::1]:${port}/ok.png`])
    expect(out.size).toBe(0)
    expect(hits).toEqual([])
  })

  it('checks the address a host NAME resolves to', async () => {
    // "localhost" is not a literal, so only the guarded lookup can catch it
    const out = await fetchRemoteImagesAsDataUris([`http://localhost:${port}/ok.png`])
    expect(out.size).toBe(0)
    expect(hits).toEqual([])
  })
})

describe('I11 (MR-22): every DNS answer', () => {
  it('refuses a name when any of its addresses is private', async () => {
    const out = await fetchRemoteImagesAsDataUris([`http://gemischt.example.test:${port}/ok.png`])
    expect(out.size).toBe(0)
    expect(hits).toEqual([])
  })
})

describe('I11 (MR-22): redirects', () => {
  // 127.0.0.2 stands in for "a private host": it is refused, 127.0.0.1 is the allowed start
  const only2 = { blockedAddress: (address: string): boolean => address === '127.0.0.2' }

  it('checks every hop, not just the first', async () => {
    const target = encodeURIComponent(`http://127.0.0.2:${port}/ok.png`)
    const out = await fetchRemoteImagesAsDataUris([`${base}/to?target=${target}`], only2)
    expect(out.size).toBe(0)
    expect(hits).toEqual(['/to'])
    expect(otherHits).toEqual([])
    // Reachable when allowed, so the refusal above was the guard and not the network
    const allowed = await fetchRemoteImagesAsDataUris([`${base}/to?target=${target}`], LOCAL)
    expect(allowed.size).toBe(1)
    expect(otherHits).toEqual(['/ok.png'])
  })

  it('follows a redirect to an allowed host', async () => {
    const target = encodeURIComponent(`${base}/ok.png`)
    const out = await fetchRemoteImagesAsDataUris([`${base}/to?target=${target}`], only2)
    expect(out.size).toBe(1)
    expect(hits).toEqual(['/to', '/ok.png'])
  })

  it('refuses a redirect off http(s) and gives up on a loop', async () => {
    const file = encodeURIComponent('file:///C:/Windows/win.ini')
    expect((await fetchRemoteImagesAsDataUris([`${base}/to?target=${file}`], LOCAL)).size).toBe(0)
    hits.length = 0
    expect((await fetchRemoteImagesAsDataUris([`${base}/loop`], LOCAL)).size).toBe(0)
    // The first request and five redirects, then it stops
    expect(hits.length).toBe(6)
  })
})

describe('I11 (MR-22): size and time', () => {
  it('stops reading a body that grows past the cap', async () => {
    // Without the streaming cap this would read until the timeout and hold every byte
    const started = Date.now()
    const endless = await fetchRemoteImagesAsDataUris([`${base}/endless`], {
      ...LOCAL,
      maxBytesPerImage: 4096,
      timeoutMs: 5000
    })
    expect(endless.size).toBe(0)
    expect(Date.now() - started).toBeLessThan(2000)

    const out = await fetchRemoteImagesAsDataUris([`${base}/big-chunked`], {
      ...LOCAL,
      maxBytesPerImage: 1024
    })
    expect(out.size).toBe(0)
    // The same body under a larger cap is an image, so the cap is what refused it
    const fits = await fetchRemoteImagesAsDataUris([`${base}/big-chunked`], {
      ...LOCAL,
      maxBytesPerImage: 8192
    })
    expect(fits.size).toBe(1)
  })

  it('refuses a declared length over the cap without waiting for the body', async () => {
    const started = Date.now()
    const out = await fetchRemoteImagesAsDataUris([`${base}/big-declared`], {
      ...LOCAL,
      timeoutMs: 5000
    })
    expect(out.size).toBe(0)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('ends a body that stalls after the headers at the timeout', async () => {
    const started = Date.now()
    const out = await fetchRemoteImagesAsDataUris([`${base}/stall`], { ...LOCAL, timeoutMs: 300 })
    expect(out.size).toBe(0)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
