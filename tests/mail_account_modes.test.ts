// One account kind (2026-10-28): the write guard as main enforces it, and the core that asks it.
//
// The pure rules first: no cleartext login off loopback, IMAP or SMTP, and the allowlist is
// loopback only (the docker-internal names resolved through DNS with certificate checks off). Then
// the core: an account reports 'read-only', 'sandbox' or 'live', an account the guard refuses is
// read-only whatever it was saved as, and a write is refused BEFORE it is journaled.
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

/** A real mailbox, off the loopback allowlist, with TLS on both sides */
const real = (over: Partial<WriteAccount> = {}): WriteAccount => ({
  id: 'postfach',
  readOnly: false,
  imapHost: 'imap.example.test',
  imapPort: 993,
  security: 'tls',
  smtpHost: 'smtp.example.test',
  smtpPort: 465,
  smtpSecurity: 'tls',
  ...over
})

const sandbox = (over: Partial<WriteAccount> = {}): WriteAccount => ({
  id: 'a',
  readOnly: false,
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

describe('settingsRefusal', () => {
  it('admits a real mailbox with encryption on both sides', () => {
    expect(settingsRefusal(real())).toBeNull()
    expect(settingsRefusal(real({ security: 'starttls', smtpSecurity: 'starttls' }))).toBeNull()
  })

  it('refuses a cleartext IMAP login to a real server', () => {
    expect(settingsRefusal(real({ security: 'none', smtpSecurity: 'tls' }))).toMatch(
      /echtes Postfach braucht eine Verschlüsselung/
    )
  })

  it('checks SMTP whether the account is read-only or not', () => {
    // the setting is a property of the server, and a read-only account may be made writable later
    for (const readOnly of [true, false]) {
      expect(settingsRefusal(real({ readOnly, smtpSecurity: 'none' }))).toMatch(/SMTP/)
    }
  })

  it('leaves the loopback test server alone', () => {
    expect(settingsRefusal(sandbox())).toBeNull()
  })
})

describe('writeRefusal', () => {
  it('lets a writable real mailbox write', () => {
    expect(writeRefusal(real())).toBeNull()
  })

  it('refuses an account set to Nur lesen first', () => {
    expect(writeRefusal(real({ readOnly: true, smtpSecurity: 'none' }))).toMatch(/Nur lesen/)
  })

  it('refuses an account stored with a cleartext SMTP login', () => {
    // an account saved before main checked this
    expect(writeRefusal(real({ smtpSecurity: 'none' }))).toMatch(/SMTP/)
  })

  it('keeps the loopback test server writable', () => {
    expect(writeRefusal(sandbox())).toBeNull()
  })
})

describe('I6: the allowlist is loopback only', () => {
  it('no longer trusts the docker-internal names', () => {
    for (const host of ['sandbox-dovecot', 'sandbox-mailpit']) {
      expect(isSandboxHost(host)).toBe(false)
      expect(tlsOptions(host).rejectUnauthorized).toBe(true)
      // and a cleartext login to them is a login across a network
      expect(writeRefusal(sandbox({ imapHost: host }))).toMatch(/Verschlüsselung/)
    }
  })
})

describe('the core asks the guard', () => {
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
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-modes-'))
    const api = createMailCore({
      dataDir,
      accounts: [
        {
          id: 'k',
          readOnly: false,
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

  it('reports the loopback test server as the sandbox', async () => {
    const { api } = core({})
    const [summary] = await api.listAccounts!()
    expect(summary.mode).toBe('sandbox')
  })

  it('reports a writable real mailbox as live', async () => {
    const { api } = core({
      host: REAL,
      security: 'tls',
      smtpHost: REAL,
      smtpPort: 1,
      smtpSecurity: 'tls'
    })
    const [summary] = await api.listAccounts!()
    expect(summary.mode).toBe('live')
  })

  it('runs an account set to Nur lesen read-only, and journals nothing', async () => {
    const { api, entry } = core({ readOnly: true, host: REAL, security: 'tls' })
    const [summary] = await api.listAccounts!()
    expect(summary.mode).toBe('read-only')
    expect(summary.canWrite).toBe(false)
    await expect(api.markRead([1], true, 'k')).rejects.toThrow(/WRITE GUARD/)
    expect(entry.store.journalCountByState()).toEqual({})
  })

  it('runs a real mailbox stored with a cleartext login read-only', async () => {
    const { api, entry } = core({
      host: REAL,
      security: 'tls',
      smtpHost: REAL,
      smtpSecurity: 'none'
    })
    const [summary] = await api.listAccounts!()
    expect(summary.mode).toBe('read-only')
    await expect(api.markRead([1], true, 'k')).rejects.toThrow(/WRITE GUARD/)
    expect(entry.store.journalCountByState()).toEqual({})
  })

  it('refuses a write the guard refuses before it is journaled', async () => {
    const { api, entry } = core({})
    // the account was admitted, then it was set to Nur lesen
    entry.writeAccount.readOnly = true
    await expect(api.markRead([1], true, 'k')).rejects.toThrow(/WRITE GUARD/)
    expect(entry.store.journalCountByState()).toEqual({})
  })
})
