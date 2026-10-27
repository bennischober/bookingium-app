// A7 part 1: writes go to THAT account's servers. The guard decides per account
// from the account itself - no global "the sandbox" anymore. The rules are pure, so
// they are tested directly; the two-account case runs against two fake IMAP servers,
// which record each connection's LOGIN and keep a mailbox per user.
import net from 'net'
import { afterEach, describe, expect, it } from 'vitest'
import { boxOf, startFakeImap, type FakeImap } from './helpers/fakeImap'
import {
  SANDBOX_ALLOWLIST,
  assertWriteAllowed,
  connectWriteImap,
  isSandboxHost,
  smtpSecurityOf,
  tlsOptions,
  writeRefusal,
  type WriteAccount
} from '../src/main/mailclient/core/write_guard'

const HOST = '127.0.0.1'
// only used by the pure-rule cases: the two-account case gets its ports from the fake server
const PORT = 10143
const SMTP_PORT = 1025

const sandbox = (over: Partial<WriteAccount> = {}): WriteAccount => ({
  id: 'a',
  kind: 'sandbox',
  imapHost: HOST,
  imapPort: PORT,
  security: 'none',
  smtpHost: HOST,
  smtpPort: SMTP_PORT,
  ...over
})

describe('A7: the write guard decides per account', () => {
  it('allows a sandbox account on the loopback allowlist', () => {
    expect(writeRefusal(sandbox())).toBeNull()
    expect(() => assertWriteAllowed(sandbox())).not.toThrow()
  })

  it('refuses a production account, whatever its host', () => {
    // A real mailbox is read-only by design: the guard is not what stops it there
    expect(writeRefusal(sandbox({ kind: 'production-readonly' }))).toMatch(/schreibgeschützt/)
    expect(() => assertWriteAllowed(sandbox({ kind: 'production-readonly' }))).toThrow(
      /WRITE GUARD/
    )
  })

  it('refuses a sandbox account whose IMAP host is not on the allowlist', () => {
    expect(writeRefusal(sandbox({ imapHost: 'imap.example.com' }))).toMatch(/lokalen Testserver/)
    expect(() => assertWriteAllowed(sandbox({ imapHost: 'imap.example.com' }))).toThrow(
      /WRITE GUARD/
    )
  })

  it('refuses a sandbox account whose SMTP host is not on the allowlist', () => {
    // Sending is a write too: a loopback IMAP does not make a real SMTP server safe
    expect(writeRefusal(sandbox({ smtpHost: 'smtp.example.com' }))).toMatch(/lokalen Testserver/)
    expect(() => assertWriteAllowed(sandbox({ smtpHost: 'smtp.example.com' }))).toThrow(
      /WRITE GUARD/
    )
  })

  it('keeps the allowlist fixed and small', () => {
    // Never widen this: it is the only thing standing between a write and a real server
    expect([...SANDBOX_ALLOWLIST].sort()).toEqual(['127.0.0.1', '::1', 'localhost'].sort())
    expect(isSandboxHost('LOCALHOST')).toBe(true)
    expect(isSandboxHost(' 127.0.0.1 ')).toBe(true)
    expect(isSandboxHost('imap.example.com')).toBe(false)
  })

  it('relaxes TLS only on the allowlist', () => {
    expect(tlsOptions('127.0.0.1').rejectUnauthorized).toBe(false)
    expect(tlsOptions('localhost').rejectUnauthorized).toBe(false)
    // everywhere else the certificate is verified
    expect(tlsOptions('imap.example.com').rejectUnauthorized).toBe(true)
  })

  it('takes the SMTP encryption from its own setting, not the IMAP one', () => {
    // A real mailbox is IMAPS 993 plus submission 587 with STARTTLS. Borrowing the
    // IMAP value would open a cleartext session to a server that wants TLS.
    expect(smtpSecurityOf({ security: 'tls', smtpSecurity: 'starttls' })).toBe('starttls')
    expect(smtpSecurityOf({ security: 'none', smtpSecurity: 'starttls' })).toBe('starttls')
    // an older account without the setting falls back to the IMAP value
    expect(smtpSecurityOf({ security: 'tls' })).toBe('tls')
    expect(smtpSecurityOf({ security: 'none' })).toBe('none')
  })
})

/** The minimal write account these fake-server cases need */
function account(imapPort: number): WriteAccount {
  return sandbox({ id: 'a7-fake', imapPort })
}

describe('A7: two accounts write into their own mailbox', () => {
  // The sandbox gave every user name its own maildir, so the old version of this test proved
  // Dovecot's isolation - not our wiring - and it needed a live container on 127.0.0.1:10143,
  // which CI does not have. The fake server records the LOGIN of every connection and keeps one
  // message list per user, so the claim is proven from our side: a write for account A reaches A's
  // mailbox with A's credentials, and never B's.
  let server: FakeImap
  const connections: { close: () => Promise<void> }[] = []

  afterEach(async () => {
    while (connections.length) await connections.pop()!.close()
    if (server) await server.close()
  })

  /** Connects the way the write path does: this account's endpoint and credentials */
  async function connect(account: WriteAccount, user: string, pass: string) {
    const client = await connectWriteImap(account, { user, pass })
    connections.push({ close: () => client.logout().catch(() => undefined) })
    return client
  }

  it('sends each account to its own endpoint with its own credentials', async () => {
    server = await startFakeImap()
    // Two accounts on two DIFFERENT ports, so the endpoint each write uses is observable
    const second = await startFakeImap()
    const firstAccount = sandbox({ id: 'a7-erste', imapPort: server.port })
    const secondAccount = sandbox({ id: 'a7-zweite', imapPort: second.port })

    const first = await connect(firstAccount, 'a7-erste@example.test', 'pass-eins')
    await first.append(
      'INBOX',
      Buffer.from('From: a7@example.test\r\nSubject: nur fuer den ersten\r\n\r\nText\r\n')
    )

    const other = await connect(secondAccount, 'a7-zweite@example.test', 'pass-zwei')
    await other.append(
      'INBOX',
      Buffer.from('From: a7@example.test\r\nSubject: nur fuer den zweiten\r\n\r\nText\r\n')
    )

    // Each server saw exactly its own account, with its own credentials
    expect(server.logins).toEqual([{ user: 'a7-erste@example.test', pass: 'pass-eins' }])
    expect(second.logins).toEqual([{ user: 'a7-zweite@example.test', pass: 'pass-zwei' }])

    // And each mailbox holds exactly its own mail - the first one's mail is not in the second
    expect(boxOf(server, 'a7-erste@example.test', 'INBOX')).toHaveLength(1)
    expect(boxOf(second, 'a7-zweite@example.test', 'INBOX')).toHaveLength(1)
    expect(boxOf(second, 'a7-erste@example.test', 'INBOX')).toHaveLength(0)

    // MR-17: the clients must be logged out BEFORE a server is closed. Closing a server while
    // a client still holds its socket makes the read fail with ECONNRESET, which no listener
    // catches - it escapes as an unhandled error and turns the whole gate red (exit 1), even
    // though every assertion passed. The connection list is drained here, and the server closes
    // afterwards in afterEach.
    while (connections.length) await connections.pop()!.close()
    await second.close()
  }, 30_000)
})

/** One raw IMAP command, so the server's own answer is observable (imapflow hides a BAD). */
function rawCommand(port: number, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    let seen = ''
    socket.setTimeout(5000, () => {
      socket.destroy()
      reject(new Error('timeout'))
    })
    socket.on('data', (chunk) => {
      seen += chunk.toString('utf8')
      const line = seen.split('\r\n').find((l) => l.startsWith(command.split(' ')[0] + ' '))
      if (line !== undefined) {
        socket.destroy()
        resolve(line)
      }
    })
    socket.on('error', reject)
    socket.on('connect', () => socket.write(`${command}\r\n`))
  })
}

describe('fakeImap: it refuses what it does not implement (MR-17 follow-up)', () => {
  let server: FakeImap
  const connections: { close: () => Promise<void> }[] = []

  afterEach(async () => {
    while (connections.length) await connections.pop()!.close()
    if (server) await server.close()
  })

  async function connect(account: WriteAccount, user: string, pass: string) {
    const client = await connectWriteImap(account, { user, pass })
    connections.push({ close: () => client.logout().catch(() => undefined) })
    return client
  }

  it('advertises only the capabilities it really implements', async () => {
    // It used to claim UIDPLUS and MOVE and implement neither, so a move test would have
    // "passed" against a command that did nothing. The advertised list is the contract.
    server = await startFakeImap()
    const client = await connect(account(server.port), 'a7-fake@example.test', 'pass')
    expect(client.capabilities.has('UIDPLUS')).toBe(false)
    expect(client.capabilities.has('MOVE')).toBe(false)
  }, 30_000)

  it('answers BAD for a command it does not implement', async () => {
    // The property that matters: a command this server cannot perform must not answer OK, or a
    // future move test would pass while nothing moved.
    //
    // Asserted on the PROTOCOL, not through imapflow: measured, imapflow's messageMove() RESOLVES
    // (undefined) even when the server answers BAD. A test that only checked "does not throw" would
    // therefore pass against a server that refused the move - the exact false confidence this card
    // is about. A raw socket is the only place the answer is visible.
    server = await startFakeImap()
    const reply = await rawCommand(server.port, 'a1 MOVE 1 INBOX')
    expect(reply).toMatch(/^a1 BAD /)
  }, 30_000)

  it('still accepts the commands it does implement', async () => {
    // The negative half: BAD must not become "refuse everything", or the real users of this
    // helper (the endpoint/credential cases) would start failing for the wrong reason.
    server = await startFakeImap()
    const reply = await rawCommand(server.port, 'a2 NOOP')
    expect(reply).toMatch(/^a2 OK /)
  }, 30_000)
})
