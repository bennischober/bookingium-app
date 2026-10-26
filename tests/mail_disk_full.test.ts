// Disk-full: the one write failure that must stop sync and say so, instead of retrying forever.
//
// A local-first client writes every body to disk and every row to SQLite, so a full disk is a matter
// of time. Before this, a failed write inside a folder sync was swallowed by the per-folder catch in
// syncAll, which only consulted the circuit breaker and the connection state - so a full disk either
// retried the same failing download forever or was reported as "offline", telling the user to check
// their network when the actual problem is their drive.
//
// Measured (probe): SQLite raises SQLITE_FULL (portably forced with `PRAGMA max_page_count`), and Node
// raises ENOSPC / EDQUOT from the filesystem side.
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { diskFullMessage, isDiskFullError } from '../src/main/mailclient/core/disk_full'
import { Store } from '../src/main/mailclient/core/store'
import { makeSandboxAccount, SyncEngine } from '../src/main/mailclient/core/sync'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

describe('disk-full: which failures count', () => {
  it('accepts the three codes that mean no room left', () => {
    // SQLITE_FULL from the database, ENOSPC/EDQUOT from the filesystem
    for (const code of ['SQLITE_FULL', 'ENOSPC', 'EDQUOT']) {
      expect(isDiskFullError({ code }), code).toBe(true)
    }
  })

  it('refuses every other failure, so a retryable error keeps its own handling', () => {
    // a full disk must not be confused with a transient problem: pausing sync for a BUSY
    // database or a permissions blip would hide a condition a retry actually fixes
    for (const code of [
      'SQLITE_BUSY',
      'SQLITE_CORRUPT',
      'SQLITE_NOTADB',
      'SQLITE_IOERR',
      'SQLITE_READONLY',
      'EACCES',
      'EPERM',
      'EBUSY',
      'EMFILE',
      'ETIMEDOUT'
    ]) {
      expect(isDiskFullError({ code }), code).toBe(false)
    }
    expect(isDiskFullError(new Error('no code'))).toBe(false)
    expect(isDiskFullError(null)).toBe(false)
    expect(isDiskFullError(undefined)).toBe(false)
    expect(isDiskFullError('SQLITE_FULL')).toBe(false) // a bare string is not an error object
  })

  it('names the cause and the way out, in German', () => {
    const message = diskFullMessage()
    expect(message).toContain('Speicherplatz')
    // "sync failed" on a full disk sends people to their mail server; the text must point at the disk
    expect(message).toMatch(/Speicherplatz voll/)
    expect(message).toMatch(/erneut versuchen/i)
  })
})

describe('disk-full: a real SQLITE_FULL from the database', () => {
  it('is raised as SQLITE_FULL, which is what the guard looks for', () => {
    // portable injection: cap the page count, then write more than fits
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-disk-full-'))
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
    const db = new Database(path.join(dir, 'full.db'))
    cleanups.push(() => {
      try {
        db.close()
      } catch {
        /* already closed */
      }
    })
    db.pragma('journal_mode = WAL')
    db.exec('CREATE TABLE t (a TEXT)')
    db.pragma('max_page_count = 10')

    let code: string | undefined
    const big = 'x'.repeat(4096)
    for (let i = 0; i < 200 && code === undefined; i++) {
      try {
        db.prepare('INSERT INTO t VALUES (?)').run(big)
      } catch (e) {
        code = (e as { code?: string }).code
      }
    }
    expect(code).toBe('SQLITE_FULL')
    // ...and the guard recognises the very error the database raises
    expect(isDiskFullError({ code })).toBe(true)
  })
})

// --- the sync engine's behaviour ------------------------------------------------

type FakeServer = { port: number; close: () => Promise<void> }

/** A fake IMAP server that lists INBOX and claims one message, so a pass reaches the write. */
async function fakeImapWithOneMessage(): Promise<FakeServer> {
  const net = await import('net')
  const sockets = new Set<import('net').Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.write('* OK [CAPABILITY IMAP4rev1] ready\r\n')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let end: number
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const [tag, rawCommand = ''] = line.split(' ')
        const command = rawCommand.toUpperCase()
        if (command === 'CAPABILITY') socket.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK\r\n`)
        else if (command === 'LOGIN') socket.write(`${tag} OK [CAPABILITY IMAP4rev1] ok\r\n`)
        else if (command === 'LIST' || command === 'LSUB')
          socket.write(`* ${command} (\\HasNoChildren) "/" "INBOX"\r\n${tag} OK\r\n`)
        else if (command === 'STATUS')
          socket.write(`* STATUS "INBOX" (MESSAGES 1)\r\n${tag} OK\r\n`)
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

function openStore(): { store: Store; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-diskfull-'))
  const store = new Store(dir, 'acc')
  cleanups.push(() => {
    try {
      store.close()
    } catch {
      /* already closed */
    }
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { store, dir }
}

describe('disk-full: sync stops and says so', () => {
  it('pauses with a disk-full state instead of reporting offline', async () => {
    const server = await fakeImapWithOneMessage()
    cleanups.push(() => void server.close())
    const { store } = openStore()
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
      { log: {} }
    )
    cleanups.push(() => void engine.close())

    // The write path is what fails on a full disk. downloadMessages is where a pass writes
    // the body and the row, so that is the boundary the error comes from.
    const diskFull = Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' })
    let attempts = 0
    ;(engine as unknown as { downloadMessages: () => Promise<number> }).downloadMessages = () => {
      attempts++
      throw diskFull
    }

    await engine.syncAll()

    // Read live status: syncAll's return value is assembled before its finally block settles.
    const status = engine.getStatus()
    // SC2: the pass stopped in the disk-full state, and the reason is available
    expect(status.phase).toBe('disk-full')
    expect(status.diskFull).toBe(diskFullMessage())
    // SC3: it is NOT a connection problem - the user must not be sent to check their network
    expect(status.connection).not.toBe('offline')
    expect(status.connectionError).toBeNull()
    // and it did not keep hammering the same folder
    expect(attempts).toBeLessThanOrEqual(1)
  }, 30_000)

  it('clears the state on resume, so the retry action can download again', async () => {
    const server = await fakeImapWithOneMessage()
    cleanups.push(() => void server.close())
    const { store } = openStore()
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
      { log: {} }
    )
    cleanups.push(() => void engine.close())
    ;(engine as unknown as { downloadMessages: () => Promise<number> }).downloadMessages = () => {
      throw Object.assign(new Error('full'), { code: 'SQLITE_FULL' })
    }
    await engine.syncAll()
    expect(engine.getStatus().phase).toBe('disk-full')

    // SC4: resume() is what the retry button calls
    engine.resume()
    const after = engine.getStatus()
    expect(after.diskFull).toBeNull()
    expect(after.phase).not.toBe('disk-full')
  }, 30_000)

  it('does not stop for an ordinary error, which a retry can fix', async () => {
    // the negative case: a BUSY database must keep today's behaviour, not pause the whole account
    const server = await fakeImapWithOneMessage()
    cleanups.push(() => void server.close())
    const { store } = openStore()
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
      { log: {} }
    )
    cleanups.push(() => void engine.close())
    ;(engine as unknown as { downloadMessages: () => Promise<number> }).downloadMessages = () => {
      throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' })
    }
    await engine.syncAll()

    expect(engine.getStatus().phase).not.toBe('disk-full')
    expect(engine.getStatus().diskFull ?? null).toBeNull()
  }, 30_000)
})
