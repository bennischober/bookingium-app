// #63: the first download of a large mailbox: its size from the server, a space check before it
// starts, the time it still needs, and a pause that outlives a restart.
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  downloadSpaceMessage,
  downloadSpaceNeeded,
  SWAP_SPACE_RESERVE
} from '../src/main/mailclient/core/disk_full'
import { secondsLeft } from '../src/main/mailclient/core/download_estimate'
import { Store } from '../src/main/mailclient/core/store'
import { makeSandboxAccount, SyncEngine } from '../src/main/mailclient/core/sync'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

describe('#63: the estimate', () => {
  it('needs some time and some messages before it says anything', () => {
    const start = { at: 0, done: 100 }
    expect(secondsLeft(start, { at: 10_000, done: 500 }, 10_000)).toBeNull()
    expect(secondsLeft(start, { at: 60_000, done: 110 }, 10_000)).toBeNull()
    expect(secondsLeft(start, { at: 60_000, done: 500 }, null)).toBeNull()
  })

  it('extrapolates the rate since the start to what is left', () => {
    // 400 messages a minute, 9.500 left: 23,75 minutes
    expect(secondsLeft({ at: 0, done: 100 }, { at: 60_000, done: 500 }, 10_000)).toBe(1425)
    expect(secondsLeft({ at: 0, done: 0 }, { at: 60_000, done: 500 }, 500)).toBeNull()
  })
})

describe('#63: the room the first download needs', () => {
  it('is what is not stored yet, with the share and reserve of a swap', () => {
    expect(downloadSpaceNeeded(1_000_000_000, 0)).toBe(1_200_000_000 + SWAP_SPACE_RESERVE)
    expect(downloadSpaceNeeded(1_000_000_000, 400_000_000)).toBe(720_000_000 + SWAP_SPACE_RESERVE)
    expect(downloadSpaceNeeded(100, 1_000)).toBe(SWAP_SPACE_RESERVE)
  })

  it('names both sizes, rounded up, and the way on', () => {
    const message = downloadSpaceMessage(3_210_000_000, 450_200_000)
    expect(message).toContain('bis zu 3,3 GB')
    expect(message).toContain('frei sind 451 MB')
    expect(message).toMatch(/trotzdem fortsetzen/)
  })
})

// --- the engine against a fake server ---------------------------------------------

type FakeServer = { port: number; close: () => Promise<void> }

/** INBOX with one message; `caps` adds STATUS=SIZE or QUOTA, with the sizes they report. */
async function fakeImap(opts: {
  caps: string
  statusSize?: number
  quotaKb?: number
}): Promise<FakeServer> {
  const net = await import('net')
  const sockets = new Set<import('net').Socket>()
  const caps = `IMAP4rev1 ${opts.caps}`.trim()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.write(`* OK [CAPABILITY ${caps}] ready\r\n`)
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let end: number
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const [tag, rawCommand = ''] = line.split(' ')
        const command = rawCommand.toUpperCase()
        if (command === 'CAPABILITY') socket.write(`* CAPABILITY ${caps}\r\n${tag} OK\r\n`)
        else if (command === 'LOGIN') socket.write(`${tag} OK [CAPABILITY ${caps}] ok\r\n`)
        else if (command === 'LIST' || command === 'LSUB')
          socket.write(`* ${command} (\\HasNoChildren) "/" "INBOX"\r\n${tag} OK\r\n`)
        else if (command === 'STATUS') {
          const size =
            / SIZE/i.test(line) && opts.statusSize !== undefined ? ` SIZE ${opts.statusSize}` : ''
          socket.write(`* STATUS "INBOX" (MESSAGES 1${size})\r\n${tag} OK\r\n`)
        } else if (command === 'GETQUOTAROOT')
          socket.write(
            `* QUOTAROOT INBOX ""\r\n* QUOTA "" (STORAGE ${opts.quotaKb ?? 0} 99999999)\r\n${tag} OK\r\n`
          )
        else if (command === 'SELECT' || command === 'EXAMINE')
          socket.write(
            `* 1 EXISTS\r\n* OK [UIDVALIDITY 1] ok\r\n* OK [UIDNEXT 2] ok\r\n${tag} OK [READ-WRITE] ok\r\n`
          )
        else if (command === 'LOGOUT') socket.end(`* BYE\r\n${tag} OK\r\n`)
        else socket.write(`${tag} OK\r\n`)
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as import('net').AddressInfo).port
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      })
  }
}

function openStore(): Store {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-large-'))
  const store = new Store(dir, 'acc')
  cleanups.push(() => {
    try {
      store.close()
    } catch {
      /* already closed */
    }
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return store
}

type Downloads = { pausedAtDownload: boolean[] }

/** A held pass waits at its next server contact, so these tests watch it instead of awaiting it */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function engineFor(
  server: FakeServer,
  store: Store,
  freeBytes: number | null
): SyncEngine & Downloads {
  const engine = new SyncEngine(
    makeSandboxAccount({
      id: 'acc',
      host: '127.0.0.1',
      port: server.port,
      security: 'none',
      user: 'u',
      pass: 'p',
      dataDir: store.dataDirResolved
    }),
    store,
    { log: {}, freeBytes: () => freeBytes }
  ) as SyncEngine & Downloads
  cleanups.push(() => void engine.close())
  // the real download waits at its first batch while paused; record whether it would have
  engine.pausedAtDownload = []
  ;(engine as unknown as { downloadMessages: () => Promise<number> }).downloadMessages =
    async () => {
      engine.pausedAtDownload.push(engine.getStatus().paused)
      return 0
    }
  return engine
}

describe('#63: the first download of a large mailbox', () => {
  it('reads the size from STATUS SIZE and holds the download when the drive is too small', async () => {
    const server = await fakeImap({ caps: 'STATUS=SIZE', statusSize: 5_000_000_000 })
    cleanups.push(() => void server.close())
    const store = openStore()
    const engine = engineFor(server, store, 2_000_000_000)

    const pass = engine.syncAll()
    await until(() => engine.getStatus().paused)
    const status = engine.getStatus()
    expect(status.bytesTotal).toBe(5_000_000_000)
    expect(status.phase).toBe('paused')
    expect(status.spaceWarning).toBe(
      downloadSpaceMessage(downloadSpaceNeeded(5_000_000_000, 0), 2_000_000_000)
    )
    // nothing downloaded while held
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(engine.pausedAtDownload).toEqual([])
    // a held download is not a pause the user chose: it is checked again after a restart
    expect(store.getFlag('sync_paused')).toBeNull()

    // continuing anyway: the download runs, and no second warning in this run
    engine.resume()
    expect(engine.getStatus().spaceWarning).toBeNull()
    await pass
    expect(engine.pausedAtDownload).toEqual([false])
    await engine.syncAll()
    expect(engine.getStatus().paused).toBe(false)
    expect(engine.pausedAtDownload).toEqual([false, false])
  }, 30_000)

  it('goes ahead when the drive has room, or cannot say', async () => {
    const server = await fakeImap({ caps: 'STATUS=SIZE', statusSize: 5_000_000_000 })
    cleanups.push(() => void server.close())
    for (const free of [10_000_000_000, null]) {
      const engine = engineFor(server, openStore(), free)
      await engine.syncAll()
      expect(engine.getStatus().spaceWarning, String(free)).toBeNull()
      expect(engine.pausedAtDownload).toEqual([false])
    }
  }, 30_000)

  it('falls back to the QUOTA usage without STATUS SIZE', async () => {
    const server = await fakeImap({ caps: 'QUOTA', quotaKb: 3_000_000 })
    cleanups.push(() => void server.close())
    const engine = engineFor(server, openStore(), 1_000_000_000)
    const pass = engine.syncAll()
    await until(() => engine.getStatus().paused)
    expect(engine.getStatus().bytesTotal).toBe(3_000_000 * 1024)
    expect(engine.getStatus().spaceWarning).toMatch(/Wenig Speicherplatz/)
    engine.resume()
    await pass
  }, 30_000)

  it('has no size and no check when the server says neither', async () => {
    const server = await fakeImap({ caps: '' })
    cleanups.push(() => void server.close())
    const engine = engineFor(server, openStore(), 1)
    await engine.syncAll()
    expect(engine.getStatus().bytesTotal).toBeNull()
    expect(engine.getStatus().spaceWarning).toBeNull()
    expect(engine.pausedAtDownload).toEqual([false])
  }, 30_000)
})

describe('#63: a paused first download and a restart', () => {
  it('stays paused after a restart while the first download is not done', async () => {
    const server = await fakeImap({ caps: '' })
    cleanups.push(() => void server.close())
    const store = openStore()
    engineFor(server, store, null).pause()
    expect(store.getFlag('sync_paused')).toBe('1')

    const restarted = engineFor(server, store, null)
    const pass = restarted.syncAll()
    await until(() => restarted.getStatus().paused)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(restarted.pausedAtDownload).toEqual([])
    expect(restarted.getStatus().spaceWarning).toBeNull()

    restarted.resume()
    expect(store.getFlag('sync_paused')).toBeNull()
    await pass
    expect(restarted.pausedAtDownload).toEqual([false])
  }, 30_000)

  it('lets go of the pause once every folder was downloaded', async () => {
    const server = await fakeImap({ caps: '' })
    cleanups.push(() => void server.close())
    const store = openStore()
    store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
    store.setFlag('sync_paused', '1')

    const engine = engineFor(server, store, null)
    await engine.syncAll()
    // new mail must not wait behind a pause the user meant for the first download
    expect(engine.getStatus().paused).toBe(false)
    expect(store.getFlag('sync_paused')).toBeNull()
  }, 30_000)
})
