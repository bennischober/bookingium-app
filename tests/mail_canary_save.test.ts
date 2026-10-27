// I6 (MR-20): main enforces the canary admission when an account is SAVED.
//
// The renderer offers the sandbox kind only in a development build, but main accepted whatever it
// was sent: a sandbox-kind account on a real host, a cleartext SMTP login, and a canary flag the form
// simply sent back after the server, login or address had changed. The rules now live in main:
//   - a sandbox kind on a real host is accepted only as the canary;
//   - the flag ends when the mailbox it names changes, and the account is saved read-only;
//   - unchecking the flag revokes it the same way;
//   - SMTP needs encryption off loopback, for every kind;
//   - a packaged build admits a canary only with BOOKINGIUM_ALLOW_CANARY=1.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const dirs: string[] = []
let userData = ''
const electron = { isPackaged: false }

vi.mock('electron', () => ({
  app: {
    getPath: (): string => userData,
    get isPackaged(): boolean {
      return electron.isPackaged
    }
  },
  safeStorage: {
    isEncryptionAvailable: (): boolean => true,
    encryptString: (s: string): Buffer => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer): string => b.toString().replace(/^enc:/, '')
  }
}))

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-canary-save-'))
  dirs.push(userData)
  electron.isPackaged = false
  vi.stubEnv('BOOKINGIUM_ALLOW_CANARY', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

/** A real mailbox admitted as the canary, TLS on both sides */
const canary = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'sandbox',
  host: 'imap.example.test',
  port: 993,
  security: 'tls',
  user: 'canary@example.test',
  email: 'canary@example.test',
  password: 'pass',
  smtpHost: 'smtp.example.test',
  smtpPort: 465,
  smtpSecurity: 'tls',
  canary: true,
  ...over
})

const accounts = () => import('../src/main/mailclient/accounts')

describe('I6: a sandbox kind on a real host', () => {
  it('is refused without the canary flag, and nothing is written', async () => {
    const { saveMailAccount, listMailAccounts } = await accounts()
    expect(() => saveMailAccount(canary({ canary: false }) as never)).toThrow(/Nur lesen/)
    expect(listMailAccounts()).toEqual([])
  })

  it('is refused when only its SMTP host is real', async () => {
    const { saveMailAccount } = await accounts()
    const input = canary({ canary: false, host: '127.0.0.1', port: 10143, security: 'none' })
    expect(() => saveMailAccount(input as never)).toThrow(/Nur lesen/)
  })

  it('is accepted as the canary in a development build', async () => {
    const { saveMailAccount } = await accounts()
    const saved = saveMailAccount(canary() as never)
    expect(saved.kind).toBe('sandbox')
    expect(saved.canary).toBe(true)
  })

  it('leaves the loopback sandbox as it was', async () => {
    const { saveMailAccount } = await accounts()
    const saved = saveMailAccount(
      canary({
        canary: false,
        host: '127.0.0.1',
        port: 10143,
        security: 'none',
        smtpHost: '127.0.0.1',
        smtpPort: 1025,
        smtpSecurity: 'none'
      }) as never
    )
    expect(saved.kind).toBe('sandbox')
    expect(saved.canary).toBe(false)
  })

  it('keeps a real read-only mailbox what it is', async () => {
    const { saveMailAccount } = await accounts()
    const saved = saveMailAccount(canary({ kind: 'production-readonly', canary: false }) as never)
    expect(saved.kind).toBe('production-readonly')
  })
})

describe('I6: the flag names one mailbox', () => {
  // host, port and user change the mailbox (MR-33), so those saves carry the password again
  const changes: [string, Record<string, unknown>][] = [
    ['IMAP host', { host: 'imap.other.test' }],
    ['IMAP port', { port: 143, security: 'starttls' }],
    ['user', { user: 'other@example.test' }],
    ['address', { email: 'other@example.test' }],
    ['SMTP host', { smtpHost: 'smtp.other.test' }],
    ['SMTP port', { smtpPort: 587, smtpSecurity: 'starttls' }]
  ]

  for (const [what, change] of changes) {
    it(`ends when the ${what} changes, and the account is saved read-only`, async () => {
      const { saveMailAccount, listMailAccounts } = await accounts()
      const { id } = saveMailAccount(canary() as never)
      // the form sends back the flag it loaded
      const saved = saveMailAccount(canary({ id, ...change }) as never)
      expect(saved.canary).toBe(false)
      expect(saved.kind).toBe('production-readonly')
      expect(listMailAccounts().filter((a) => a.canary)).toEqual([])
    })
  }

  it('stays when nothing about the mailbox changes', async () => {
    const { saveMailAccount } = await accounts()
    const { id } = saveMailAccount(canary() as never)
    // case and surrounding spaces do not make another mailbox; the password is not resent
    const saved = saveMailAccount(
      canary({
        id,
        password: undefined,
        host: ' IMAP.example.test ',
        email: 'Canary@Example.test',
        signature: 'Gruß'
      }) as never
    )
    expect(saved.canary).toBe(true)
    expect(saved.kind).toBe('sandbox')
    expect(saved.id).toBe(id)
  })

  it('may be set again on purpose after it ended', async () => {
    const { saveMailAccount } = await accounts()
    const { id } = saveMailAccount(canary() as never)
    const moved = saveMailAccount(canary({ id, email: 'other@example.test' }) as never)
    expect(moved.canary).toBe(false)
    // admitting it again is a new step from a read-only account, not a carried-over flag
    const admitted = saveMailAccount(canary({ id: moved.id, email: 'other@example.test' }) as never)
    expect(admitted.canary).toBe(true)
    expect(admitted.kind).toBe('sandbox')
  })

  it('is revoked by unchecking it, leaving a read-only mailbox', async () => {
    const { saveMailAccount } = await accounts()
    const { id } = saveMailAccount(canary() as never)
    const saved = saveMailAccount(canary({ id, password: undefined, canary: false }) as never)
    expect(saved.canary).toBe(false)
    expect(saved.kind).toBe('production-readonly')
  })

  it('is revoked by switching the kind to read-only', async () => {
    const { saveMailAccount } = await accounts()
    const { id } = saveMailAccount(canary() as never)
    const saved = saveMailAccount(
      canary({ id, password: undefined, kind: 'production-readonly' }) as never
    )
    expect(saved.canary).toBe(false)
    expect(saved.kind).toBe('production-readonly')
  })
})

describe('I6: SMTP security is checked in main', () => {
  it('refuses a cleartext SMTP login to a real server, whatever the kind', async () => {
    const { saveMailAccount, listMailAccounts } = await accounts()
    for (const kind of ['production-readonly', 'sandbox']) {
      expect(() => saveMailAccount(canary({ kind, smtpSecurity: 'none' }) as never)).toThrow(
        /SMTP-Server braucht eine Verschlüsselung/
      )
    }
    expect(listMailAccounts()).toEqual([])
  })

  it('refuses it when the SMTP side inherits a cleartext IMAP setting', async () => {
    const { checkMailAccountSettings } = await accounts()
    // the IMAP side is loopback, the SMTP side is not, and SMTP falls back to 'none'
    expect(() =>
      checkMailAccountSettings({
        kind: 'sandbox',
        host: '127.0.0.1',
        security: 'none',
        smtpHost: 'smtp.example.test'
      })
    ).toThrow(/SMTP-Server/)
  })

  it('allows a cleartext SMTP login on loopback only', async () => {
    const { checkMailAccountSettings } = await accounts()
    expect(() =>
      checkMailAccountSettings({
        kind: 'sandbox',
        host: '127.0.0.1',
        security: 'none',
        smtpHost: 'localhost',
        smtpSecurity: 'none'
      })
    ).not.toThrow()
  })
})

describe('I6: a packaged build', () => {
  it('refuses to admit a canary without the main-side switch', async () => {
    const { saveMailAccount, canaryAllowed, listMailAccounts } = await accounts()
    electron.isPackaged = true
    expect(canaryAllowed()).toBe(false)
    expect(() => saveMailAccount(canary() as never)).toThrow(/Entwicklerversion/)
    expect(listMailAccounts()).toEqual([])
  })

  it('admits it when started with BOOKINGIUM_ALLOW_CANARY=1', async () => {
    const { saveMailAccount, canaryAllowed } = await accounts()
    electron.isPackaged = true
    vi.stubEnv('BOOKINGIUM_ALLOW_CANARY', '1')
    expect(canaryAllowed()).toBe(true)
    expect(saveMailAccount(canary() as never).canary).toBe(true)
  })

  it('still saves a read-only account', async () => {
    const { saveMailAccount } = await accounts()
    electron.isPackaged = true
    const saved = saveMailAccount(canary({ kind: 'production-readonly', canary: false }) as never)
    expect(saved.kind).toBe('production-readonly')
  })
})

describe('I6: the router checks before the connection test', () => {
  it('throws what a save would throw, and writes nothing', async () => {
    const { checkMailAccountSave, listMailAccounts } = await accounts()
    expect(() => checkMailAccountSave(canary({ canary: false }) as never)).toThrow(/Nur lesen/)
    expect(() => checkMailAccountSave(canary({ smtpSecurity: 'none' }) as never)).toThrow(
      /SMTP-Server/
    )
    expect(() => checkMailAccountSave(canary() as never)).not.toThrow()
    expect(listMailAccounts()).toEqual([])
  })
})
