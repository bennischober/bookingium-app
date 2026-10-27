// I6 (MR-18, MR-20): the write guard as main enforces it, and the core that asks it.
//
// The pure rules first: SMTP needs encryption off loopback, a sandbox kind on a real host is
// saved only as the canary, and the allowlist is loopback only (the docker-internal names resolved
// through DNS with certificate checks off). Then the core: an account the guard refuses is read-only
// whatever kind it was saved as, a write is refused BEFORE it is journaled, and the canary reports
// itself as 'canary' (MR-18: the sync config never carried the flag, so it said 'sandbox').
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMailCore } from '../src/main/mailclient/core/index'
import type { Store } from '../src/main/mailclient/core/store'
import {
  isSandboxHost,
  settingsRefusal,
  smtpRefusal,
  tlsOptions,
  writeRefusal,
  type WriteAccount
} from '../src/main/mailclient/core/write_guard'

const canary = (over: Partial<WriteAccount> = {}): WriteAccount => ({
  id: 'testpostfach',
  canary: true,
  kind: 'sandbox',
  imapHost: 'imap.example.test',
  imapPort: 993,
  security: 'tls',
  smtpHost: 'smtp.example.test',
  smtpPort: 465,
  smtpSecurity: 'tls',
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

describe('I6: smtpRefusal', () => {
  it('refuses a cleartext login to a real SMTP server', () => {
    expect(
      smtpRefusal({ smtpHost: 'smtp.example.test', security: 'tls', smtpSecurity: 'none' })
    ).toMatch(/Verschlüsselung/)
  })

  it('refuses it when the SMTP setting falls back to a cleartext IMAP one', () => {
    expect(smtpRefusal({ smtpHost: 'smtp.example.test', security: 'none' })).toMatch(
      /Verschlüsselung/
    )
  })

  it('allows encryption anywhere and cleartext on loopback', () => {
    expect(
      smtpRefusal({ smtpHost: 'smtp.example.test', security: 'none', smtpSecurity: 'starttls' })
    ).toBeNull()
    expect(smtpRefusal({ smtpHost: '127.0.0.1', security: 'none' })).toBeNull()
  })
})

describe('I6: settingsRefusal', () => {
  it('admits a sandbox kind on a real host as the canary only', () => {
    expect(settingsRefusal(canary())).toBeNull()
    expect(settingsRefusal(canary({ canary: undefined }))).toMatch(/Nur lesen/)
    expect(settingsRefusal(canary({ canary: undefined, imapHost: '127.0.0.1' }))).toMatch(
      /Nur lesen/
    )
  })

  it('leaves a read-only account and the loopback sandbox alone', () => {
    expect(settingsRefusal(canary({ kind: 'production-readonly', canary: undefined }))).toBeNull()
    expect(settingsRefusal(sandbox())).toBeNull()
  })

  it('checks SMTP for every kind, the canary included', () => {
    for (const kind of ['production-readonly', 'sandbox'] as const) {
      expect(settingsRefusal(canary({ kind, smtpSecurity: 'none' }))).toMatch(/SMTP/)
    }
  })
})

describe('I6: writeRefusal', () => {
  it('refuses a canary stored with a cleartext SMTP login', () => {
    // an account saved before main checked this
    expect(writeRefusal(canary({ smtpSecurity: 'none' }))).toMatch(/SMTP/)
  })

  it('names the real host first for a non-canary account', () => {
    expect(writeRefusal(canary({ canary: undefined, smtpSecurity: 'none' }))).toMatch(
      /lokalen Testserver/
    )
  })

  it('keeps the loopback sandbox writable', () => {
    expect(writeRefusal(sandbox())).toBeNull()
  })
})

describe('I6: the allowlist is loopback only', () => {
  it('no longer trusts the docker-internal names', () => {
    for (const host of ['sandbox-dovecot', 'sandbox-mailpit']) {
      expect(isSandboxHost(host)).toBe(false)
      expect(tlsOptions(host).rejectUnauthorized).toBe(true)
      expect(writeRefusal(sandbox({ imapHost: host }))).toMatch(/lokalen Testserver/)
    }
  })
})

describe('I6: the core asks the guard', () => {
  const cleanups: (() => unknown)[] = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!()
  })

  type Internals = {
    entries: Map<string, { writeAccount: WriteAccount; store: Store }>
  }

  // 127.0.0.2 is off the loopback allowlist but never leaves the machine, and port 1 refuses
  const REAL = '127.0.0.2'

  function core(account: Record<string, unknown>) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-canary-main-'))
    const api = createMailCore({
      dataDir,
      accounts: [
        {
          id: 'k',
          kind: 'sandbox',
          email: 'k@example.test',
          host: '127.0.0.1',
          port: 1,
          security: 'none',
          credentials: async () => ({ user: 'k@example.test', pass: 'x' }),
          ...account
        } as never
      ]
    })
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }))
    cleanups.push(() => api.close())
    const entry = (api as unknown as Internals).entries.get('k')!
    return { api, entry }
  }

  it('reports the canary as a canary (MR-18)', async () => {
    const { api } = core({
      host: REAL,
      security: 'tls',
      smtpHost: REAL,
      smtpPort: 1,
      smtpSecurity: 'tls',
      canary: true
    })
    const [summary] = await api.listAccounts!()
    expect(summary.mode).toBe('canary')
    expect(summary.canWrite).toBe(true)
  })

  it('runs a sandbox kind on a real host without the flag read-only', async () => {
    const { api, entry } = core({ host: REAL, security: 'tls', smtpSecurity: 'tls' })
    const [summary] = await api.listAccounts!()
    expect(summary.mode).toBe('production-readonly')
    expect(summary.canWrite).toBe(false)
    await expect(api.markRead([1], true, 'k')).rejects.toThrow(/WRITE GUARD/)
    expect(entry.store.journalCountByState()).toEqual({})
  })

  it('refuses a write the guard refuses before it is journaled', async () => {
    const { api, entry } = core({})
    // the account was admitted, then its endpoint is no longer one the guard accepts
    entry.writeAccount.imapHost = REAL
    await expect(api.markRead([1], true, 'k')).rejects.toThrow(/WRITE GUARD/)
    expect(entry.store.journalCountByState()).toEqual({})
  })
})
