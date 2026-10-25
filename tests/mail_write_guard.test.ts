// A7 part 1: writes go to THAT account's servers. The guard decides per account
// from the account itself - no global "the sandbox" anymore. The rules are pure, so
// they are tested directly; the two-account case runs against the real sandbox,
// which gives every user name its own maildir.
import { afterEach, describe, expect, it } from 'vitest'
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
const PORT = 10143
const SMTP_PORT = 1025
const PASS = 'testpass'

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
    expect(() =>
      assertWriteAllowed(sandbox({ kind: 'production-readonly' }))
    ).toThrow(/WRITE GUARD/)
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
    expect([...SANDBOX_ALLOWLIST].sort()).toEqual(
      ['127.0.0.1', '::1', 'localhost', 'sandbox-dovecot', 'sandbox-mailpit'].sort()
    )
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

describe('A7: two accounts write into their own mailbox', () => {
  const connections: { close: () => Promise<void> }[] = []
  afterEach(async () => {
    while (connections.length) await connections.pop()!.close()
  })

  /** The folder names a user's own mailbox has; the sandbox gives each user its own maildir */
  async function connect(user: string) {
    const account = sandbox({ id: user, imapHost: HOST, smtpHost: HOST })
    const client = await connectWriteImap(account, { user, pass: PASS })
    connections.push({ close: () => client.logout().catch(() => undefined) })
    return client
  }

  /** Appends one mail to a user's INBOX and returns how many it now holds */
  async function appendTo(user: string, subject: string): Promise<number> {
    const client = await connect(user)
    await client.append('INBOX', Buffer.from(
      `From: a7@example.test\r\nTo: ${user}\r\nSubject: ${subject}\r\n\r\nText\r\n`
    ))
    const status = await client.status('INBOX', { messages: true })
    return status.messages ?? 0
  }

  it('keeps each account on its own maildir', async () => {
    // The sandbox accepts any user name with its password and gives each its own maildir,
    // so a mail written by one must never show up in the other - that is what A7 means
    const first = 'a7-erste@example.test'
    const second = 'a7-zweite@example.test'
    const before = await appendTo(second, 'vorher')
    await appendTo(first, 'nur fuer den ersten')
    const after = await appendTo(second, 'nachher')

    // The second mailbox only grew by its own two mails
    expect(after).toBe(before + 1)
    expect(before).toBeGreaterThan(0)
  }, 60_000)
})
