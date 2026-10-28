// Connection limits of the mail core against a scripted IMAP server on 127.0.0.1:
// the one-shot account test and the stop after a rejected login
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifyConnectionError,
  testImapConnection
} from '../src/main/mailclient/core/connection_test'
import {
  allowsPlainLogin,
  imapSecurityOptions,
  isAuthFailure
} from '../src/main/mailclient/core/imap_options'
import { createMailCore } from '../src/main/mailclient/core/index'
import { Store } from '../src/main/mailclient/core/store'
import {
  makeReadOnlyAccount,
  makeSandboxAccount,
  SyncEngine
} from '../src/main/mailclient/core/sync'

type Mode = 'silent' | 'reject-login' | 'ok'

type FakeServer = {
  port: number
  logins: () => number
  connections: () => number
  close: () => Promise<void>
}

const FOLDERS = ['INBOX', 'Sent', 'Archive']

/** Just enough IMAP for imapflow: greeting, CAPABILITY, LOGIN, LIST, LOGOUT */
async function fakeImapServer(mode: Mode): Promise<FakeServer> {
  let logins = 0
  let connections = 0
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    connections++
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    if (mode === 'silent') return
    socket.write('* OK [CAPABILITY IMAP4rev1] fake server ready\r\n')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let end: number
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const [tag, rawCommand = ''] = line.split(' ')
        const command = rawCommand.toUpperCase()
        if (command === 'CAPABILITY') {
          socket.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK done\r\n`)
        } else if (command === 'LOGIN') {
          logins++
          socket.write(
            mode === 'reject-login'
              ? `${tag} NO [AUTHENTICATIONFAILED] Authentication failed.\r\n`
              : `${tag} OK [CAPABILITY IMAP4rev1] logged in\r\n`
          )
        } else if (command === 'LIST' || command === 'LSUB') {
          const lines = FOLDERS.map((f) => `* ${command} (\\HasNoChildren) "/" "${f}"\r\n`)
          socket.write(`${lines.join('')}${tag} OK done\r\n`)
        } else if (command === 'LOGOUT') {
          socket.end(`* BYE logging out\r\n${tag} OK done\r\n`)
        } else {
          socket.write(`${tag} OK done\r\n`)
        }
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as net.AddressInfo).port,
    logins: () => logins,
    connections: () => connections,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      })
  }
}

/** A port on 127.0.0.1 that nothing listens on */
async function closedPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as net.AddressInfo
  await new Promise((resolve) => server.close(resolve))
  return port
}

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

async function server(mode: Mode): Promise<FakeServer> {
  const s = await fakeImapServer(mode)
  cleanups.push(s.close)
  return s
}

const login = { user: 'tester', pass: 'secret' }

describe('testImapConnection', () => {
  it('counts the folders after a successful login', async () => {
    const s = await server('ok')
    const result = await testImapConnection({
      host: '127.0.0.1',
      port: s.port,
      security: 'none',
      ...login
    })
    expect(result).toMatchObject({ ok: true, folderCount: FOLDERS.length })
  })

  it('reports a closed port as refused, quickly', async () => {
    const result = await testImapConnection({
      host: '127.0.0.1',
      port: await closedPort(),
      security: 'none',
      ...login
    })
    expect(result).toMatchObject({ ok: false, stage: 'refused' })
    expect(result.ms).toBeLessThan(5000)
  })

  it('gives up on a server that never greets within the deadline', async () => {
    const s = await server('silent')
    const result = await testImapConnection(
      { host: '127.0.0.1', port: s.port, security: 'none', ...login },
      { timeoutMs: 1500 }
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(['greeting', 'timeout']).toContain(result.stage)
    expect(result.ms).toBeLessThan(4000)
  })

  it('reports TLS against a plain-text server as a TLS problem', async () => {
    const s = await server('ok')
    const result = await testImapConnection(
      { host: '127.0.0.1', port: s.port, security: 'tls', ...login },
      { timeoutMs: 3000 }
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(['tls', 'greeting', 'timeout']).toContain(result.stage)
    expect(s.logins()).toBe(0)
  })

  it('refuses STARTTLS when the server does not offer it, before logging in', async () => {
    const s = await server('ok')
    const result = await testImapConnection(
      { host: '127.0.0.1', port: s.port, security: 'starttls', ...login },
      { timeoutMs: 3000 }
    )
    expect(result).toMatchObject({ ok: false, stage: 'starttls' })
    expect(s.logins()).toBe(0)
  })

  it('tries a rejected password exactly once', async () => {
    const s = await server('reject-login')
    const result = await testImapConnection({
      host: '127.0.0.1',
      port: s.port,
      security: 'none',
      ...login
    })
    expect(result).toMatchObject({ ok: false, stage: 'auth' })
    expect(s.logins()).toBe(1)
  })
})

describe('classifyConnectionError', () => {
  const err = (props: Record<string, unknown>, message = 'failed') =>
    Object.assign(new Error(message), props)

  it.each([
    [err({ authenticationFailed: true }), 'auth'],
    [err({ tlsFailed: true }), 'starttls'],
    [err({ code: 'ENOTFOUND' }), 'dns'],
    [err({ code: 'ECONNREFUSED' }), 'refused'],
    [err({ code: 'CONNECT_TIMEOUT' }), 'unreachable'],
    [err({ code: 'EHOSTUNREACH' }), 'unreachable'],
    [err({ code: 'GREETING_TIMEOUT' }), 'greeting'],
    [err({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }), 'certificate'],
    [err({ code: 'ERR_SSL_WRONG_VERSION_NUMBER' }), 'tls'],
    [err({}, 'something odd'), 'other'],
    ['not an error', 'other']
  ])('%#: %s', (error, stage) => {
    expect(classifyConnectionError(error)).toBe(stage)
  })
})

describe('SyncEngine connection state', () => {
  function engineFor(port: number): { engine: SyncEngine; onAuthFailed: () => void } {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-test-'))
    const store = new Store(dataDir, 'acc')
    const account = makeSandboxAccount({
      id: 'acc',
      host: '127.0.0.1',
      port,
      security: 'none',
      ...login,
      dataDir
    })
    const engine = new SyncEngine(account, store)
    const onAuthFailed = vi.fn()
    engine.onAuthFailed = onAuthFailed
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }))
    cleanups.push(async () => {
      engine.stopPolling()
      engine.stopIdle()
      await engine.close()
      store.close()
    })
    return { engine, onAuthFailed }
  }

  it('stops for good after a rejected login', async () => {
    const s = await server('reject-login')
    const { engine, onAuthFailed } = engineFor(s.port)

    await engine.syncAll().catch(() => undefined)
    expect(engine.getStatus().connection).toBe('auth-failed')
    expect(onAuthFailed).toHaveBeenCalledOnce()

    // Nothing logs in again: not another pass, not polling, not IDLE
    await engine.syncAll().catch(() => undefined)
    await engine.startPolling(20)
    await engine.startIdle()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(s.logins()).toBe(1)
    expect(engine.getStatus().connection).toBe('auth-failed')
  })

  it('is offline with a next attempt when the server cannot be reached', async () => {
    const { engine } = engineFor(await closedPort())

    await engine.syncAll().catch(() => undefined)
    const status = engine.getStatus()
    expect(status.connection).toBe('offline')
    expect(status.connectionError).toBeTruthy()
    expect(status.running).toBe(false)

    await engine.startPolling(60_000)
    const retryAt = engine.getStatus().retryAt
    expect(retryAt).toBeTruthy()
    expect(new Date(retryAt!).getTime()).toBeGreaterThan(Date.now())
  })
})

describe('credentials from the host', () => {
  function engineWithoutPassword(port: number): SyncEngine {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-test-'))
    const store = new Store(dataDir, 'acc')
    const account = makeSandboxAccount({
      id: 'acc',
      host: '127.0.0.1',
      port,
      security: 'none',
      user: '',
      pass: '',
      dataDir
    })
    const engine = new SyncEngine(account, store)
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }))
    cleanups.push(async () => {
      await engine.close()
      store.close()
    })
    return engine
  }

  /** A core whose host hands out the credentials only when the test says so */
  function coreWithSlowCredentials(port: number, credentials: () => Promise<typeof login>) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-creds-'))
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }))
    const api = createMailCore({
      dataDir,
      accounts: [
        {
          id: 'acc',
          readOnly: false,
          email: 'a@example.test',
          host: '127.0.0.1',
          port,
          security: 'none' as const,
          credentials
        }
      ]
    })
    cleanups.push(() => api.close())
    const engine = (api as unknown as { entries: Map<string, { engine: SyncEngine }> }).entries.get(
      'acc'
    )!.engine
    return { api, engine }
  }

  it('does not stop the account when no password is there yet', async () => {
    const s = await server('ok')
    const engine = engineWithoutPassword(s.port)

    await engine.syncAll().catch(() => undefined)
    const status = engine.getStatus()
    expect(status.connection).toBe('offline')
    expect(s.connections()).toBe(0)
  })

  it("does not count imapflow's own refusal without a password as a rejected login", () => {
    const local = Object.assign(new Error('No password configured'), { authenticationFailed: true })
    const rejected = Object.assign(new Error('Authentication failed'), {
      authenticationFailed: true
    })
    expect(isAuthFailure(local)).toBe(false)
    expect(isAuthFailure(rejected)).toBe(true)
    // the account dialog still names an empty password as the login's problem
    expect(classifyConnectionError(local)).toBe('auth')
  })

  it('loads the credentials before a connection that does not come from start()', async () => {
    const s = await server('ok')
    let hand!: () => void
    const handed = new Promise<void>((resolve) => (hand = resolve))
    const credentials = vi.fn(async () => {
      await handed
      return login
    })
    const { engine } = coreWithSlowCredentials(s.port, credentials)

    // what polling, the repair sweep and the S1 download do: connect on the engine directly
    const sync = engine.syncAll().catch(() => undefined)
    const selected = engine.withSelected('INBOX', '1', async () => true).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(credentials).toHaveBeenCalled()
    expect(s.logins()).toBe(0)
    hand()
    await Promise.all([sync, selected])

    expect(engine.getStatus().connection).not.toBe('auth-failed')
    expect(s.logins()).toBeGreaterThanOrEqual(1)
  })

  it('is offline, not stopped, when the host cannot hand out the credentials', async () => {
    const s = await server('ok')
    const { engine } = coreWithSlowCredentials(s.port, async () => {
      throw new Error('keychain locked')
    })

    await engine.syncAll().catch(() => undefined)
    expect(engine.getStatus().connection).toBe('offline')
    expect(s.connections()).toBe(0)
  })
})

describe('production account settings', () => {
  it('refuses a production account without encryption', () => {
    expect(() =>
      makeReadOnlyAccount({
        id: 'prod',
        host: 'imap.example.test',
        port: 143,
        security: 'none',
        ...login,
        dataDir: os.tmpdir()
      })
    ).toThrow(/TLS or STARTTLS/)
  })

  it('allows a plain login only to this machine', () => {
    expect(allowsPlainLogin('127.0.0.1')).toBe(true)
    expect(allowsPlainLogin('localhost')).toBe(true)
    expect(allowsPlainLogin('::1')).toBe(true)
    expect(allowsPlainLogin('imap.ionos.de')).toBe(false)
    expect(allowsPlainLogin('192.168.1.10')).toBe(false)
    expect(allowsPlainLogin('sandbox-dovecot')).toBe(false)
  })
})

describe('imapSecurityOptions (F1)', () => {
  it('uses TLS from the first byte for tls', () => {
    expect(imapSecurityOptions('tls')).toEqual({ secure: true, doSTARTTLS: false })
  })

  it('requires STARTTLS for starttls instead of allowing a plain login', () => {
    // Opportunistic STARTTLS would fall back to a plain login when the server
    // does not offer it, which is exactly what this rule must prevent
    expect(imapSecurityOptions('starttls')).toEqual({ secure: false, doSTARTTLS: true })
  })

  it('never sets both at once, which imapflow cannot do', () => {
    for (const security of ['tls', 'starttls', 'none'] as const) {
      const opts = imapSecurityOptions(security)
      expect(opts.secure && opts.doSTARTTLS).toBe(false)
    }
  })
})
