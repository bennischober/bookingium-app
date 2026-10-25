// A7 part 2: the canary mailbox - the ONE real mailbox writes may reach.
//
// The admission is deliberately narrow: one named account id, never a third account kind.
// `MailAccountKind` is read in 22 places and every one of them would be a place a real
// account could slip through; this is auditable on one screen and revoked by deleting one
// constant. The rules are pure, so they are tested directly.
import { describe, expect, it } from 'vitest'
import {
  CANARY_ACCOUNT_ID,
  SANDBOX_ALLOWLIST,
  isCanary,
  isSandboxHost,
  sendRefusal,
  tlsOptions,
  writeRefusal,
  type WriteAccount
} from '../src/main/mailclient/core/write_guard'

/** A real mailbox, off the loopback allowlist, with TLS on both sides */
const canary = (over: Partial<WriteAccount> = {}): WriteAccount => ({
  id: CANARY_ACCOUNT_ID,
  kind: 'sandbox',
  imapHost: 'imap.ionos.de',
  imapPort: 993,
  security: 'tls',
  smtpHost: 'smtp.ionos.de',
  smtpPort: 587,
  smtpSecurity: 'starttls',
  email: 'testpostfach@example.test',
  ...over
})

const sandbox = (over: Partial<WriteAccount> = {}): WriteAccount => ({
  id: 'a',
  kind: 'sandbox',
  imapHost: '127.0.0.1',
  imapPort: 10143,
  security: 'none',
  smtpHost: '127.0.0.1',
  smtpPort: 1025,
  ...over
})

describe('A7 part 2: the canary is admitted by name', () => {
  it('may be written to, although it is not on the loopback allowlist', () => {
    // The whole point: a real mailbox the write path may reach
    expect(writeRefusal(canary())).toBeNull()
    expect(isSandboxHost(canary().imapHost)).toBe(false)
  })

  it('is admitted whatever its hosts are, because the id is the admission', () => {
    // A canary on any server: the admission is the id, not the endpoint
    expect(writeRefusal(canary({ imapHost: 'imap.other.test' }))).toBeNull()
    expect(writeRefusal(canary({ smtpHost: 'smtp.other.test' }))).toBeNull()
  })

  it('keeps its TLS verified, because it is off the loopback allowlist', () => {
    // The one thing that must NOT be relaxed for a real mailbox
    expect(tlsOptions(canary().imapHost).rejectUnauthorized).toBe(true)
    expect(tlsOptions(canary().smtpHost).rejectUnauthorized).toBe(true)
  })

  it('does not widen the sandbox allowlist', () => {
    // A second, separate admission path - never a wider allowlist
    expect([...SANDBOX_ALLOWLIST].sort()).toEqual(
      ['127.0.0.1', '::1', 'localhost', 'sandbox-dovecot', 'sandbox-mailpit'].sort()
    )
    expect(isSandboxHost('imap.ionos.de')).toBe(false)
  })

  it('is exactly one account: any other real account stays refused', () => {
    // Same hosts, same kind, different id - refused. This is the whole admission.
    expect(writeRefusal(canary({ id: 'other-real' }))).toMatch(/lokalen Testserver/)
    expect(isCanary(canary())).toBe(true)
    expect(isCanary(canary({ id: 'other-real' }))).toBe(false)
  })

  it('does not admit a read-only account even if it carries the canary id', () => {
    // kind stays the outer gate: the canary is saved as a sandbox account
    expect(writeRefusal(canary({ kind: 'production-readonly' }))).toMatch(/schreibgeschützt/)
  })

  it('leaves the sandbox rules exactly as they were', () => {
    expect(writeRefusal(sandbox())).toBeNull()
    expect(writeRefusal(sandbox({ imapHost: 'imap.example.com' }))).toMatch(/lokalen Testserver/)
    expect(writeRefusal(sandbox({ kind: 'production-readonly' }))).toMatch(/schreibgeschützt/)
  })
})

describe('A7 part 2: the canary sends only to its own address', () => {
  it('refuses a send to another person', () => {
    // Phase 1 is the user's own address only - never a stranger
    const refusal = sendRefusal(canary(), ['fremd@example.test'])
    expect(refusal).toMatch(/nur an die eigene Adresse/)
  })

  it('allows a send to its own address', () => {
    expect(sendRefusal(canary(), ['testpostfach@example.test'])).toBeNull()
  })

  it('ignores case and surrounding spaces in both addresses', () => {
    expect(sendRefusal(canary(), ['  TestPostfach@Example.Test  '])).toBeNull()
    expect(sendRefusal(canary({ email: ' TestPostfach@Example.Test ' }), ['testpostfach@example.test']))
      .toBeNull()
  })

  it('refuses when one of several recipients is foreign', () => {
    // A single foreign recipient in To, Cc or Bcc is enough to refuse
    const own = 'testpostfach@example.test'
    expect(sendRefusal(canary(), [own, 'fremd@example.test'])).toMatch(/nur an die eigene/)
    expect(sendRefusal(canary(), [own, own, 'fremd@example.test'])).toMatch(/nur an die eigene/)
  })

  it('refuses a canary with no own address, rather than sending anywhere', () => {
    // Fail closed: without an address there is nothing this account may mail
    expect(sendRefusal(canary({ email: undefined }), ['irgendwer@example.test']))
      .toMatch(/eigene Adresse fehlt/)
    expect(sendRefusal(canary({ email: '   ' }), ['irgendwer@example.test']))
      .toMatch(/eigene Adresse fehlt/)
  })

  it('does not restrict a sandbox account, which reaches a local sink', () => {
    // The sandbox keeps its old freedom: Mailpit keeps nothing
    expect(sendRefusal(sandbox(), ['irgendwer@example.test'])).toBeNull()
  })
})
