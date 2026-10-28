// One account kind (2026-10-28): what main saves, and how accounts stored with a kind come back.
//
// Every account is writable unless the user sets "Nur lesen". What main still refuses on SAVE is a
// password in the clear across a network, on the IMAP or the SMTP side. Accounts stored before carry
// `kind` and maybe `canary`; they are read as writable and lose both fields on the next save.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const dirs: string[] = []
let userData = ''

vi.mock('electron', () => ({
  app: {
    getPath: (): string => userData,
    isPackaged: false
  },
  safeStorage: {
    isEncryptionAvailable: (): boolean => true,
    encryptString: (s: string): Buffer => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer): string => b.toString().replace(/^enc:/, '')
  }
}))

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-account-save-'))
  dirs.push(userData)
})

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

/** A real mailbox, TLS on both sides */
const real = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  readOnly: false,
  host: 'imap.example.test',
  port: 993,
  security: 'tls',
  user: 'postfach@example.test',
  email: 'postfach@example.test',
  password: 'pass',
  smtpHost: 'smtp.example.test',
  smtpPort: 465,
  smtpSecurity: 'tls',
  ...over
})

const accounts = () => import('../src/main/mailclient/accounts')

/** Writes accounts.json the way an older version left it */
function storeRaw(entries: Record<string, unknown>[]): void {
  fs.mkdirSync(path.join(userData, 'mail'), { recursive: true })
  fs.writeFileSync(path.join(userData, 'mail', 'accounts.json'), JSON.stringify(entries))
}

function storedRaw(): Record<string, unknown>[] {
  return JSON.parse(fs.readFileSync(path.join(userData, 'mail', 'accounts.json'), 'utf-8'))
}

describe('saving an account', () => {
  it('saves a real mailbox writable', async () => {
    const { saveMailAccount, listMailAccounts } = await accounts()
    const saved = saveMailAccount(real() as never)
    expect(saved.readOnly).toBe(false)
    expect(listMailAccounts()).toEqual([expect.objectContaining({ readOnly: false })])
  })

  it('keeps Nur lesen, and lifts it again when unchecked', async () => {
    const { saveMailAccount } = await accounts()
    const { id } = saveMailAccount(real({ readOnly: true }) as never)
    const lifted = saveMailAccount(real({ id, password: undefined, readOnly: false }) as never)
    expect(lifted.id).toBe(id)
    expect(lifted.readOnly).toBe(false)
  })

  it('stores neither a kind nor a canary flag', async () => {
    const { saveMailAccount } = await accounts()
    saveMailAccount(real() as never)
    const [stored] = storedRaw()
    expect(stored).not.toHaveProperty('kind')
    expect(stored).not.toHaveProperty('canary')
    expect(stored.readOnly).toBe(false)
  })
})

describe('accounts stored with a kind', () => {
  it('come back writable, the former canary and read-only mailbox included', async () => {
    const { listMailAccounts } = await accounts()
    storeRaw([
      {
        id: 'a',
        kind: 'sandbox',
        host: '127.0.0.1',
        port: 3143,
        security: 'none',
        user: 'u',
        email: 'a@example.test'
      },
      {
        id: 'b',
        kind: 'sandbox',
        canary: true,
        host: 'imap.example.test',
        port: 993,
        security: 'tls',
        user: 'u',
        email: 'b@example.test'
      },
      {
        id: 'c',
        kind: 'production-readonly',
        host: 'imap.example.test',
        port: 993,
        security: 'tls',
        user: 'u',
        email: 'c@example.test'
      }
    ])
    const listed = listMailAccounts()
    expect(listed.map((a) => [a.id, a.readOnly])).toEqual([
      ['a', false],
      ['b', false],
      ['c', false]
    ])
    for (const account of listed) {
      expect(account).not.toHaveProperty('kind')
      expect(account).not.toHaveProperty('canary')
    }
  })

  it('fill a missing encryption from the kind they had', async () => {
    const { normalizeStoredAccount } = await accounts()
    const base = { id: 'x', user: 'u', email: 'x@example.test' }
    expect(
      normalizeStoredAccount({ ...base, kind: 'sandbox', host: '127.0.0.1', port: 3143 } as never)
        .security
    ).toBe('none')
    expect(
      normalizeStoredAccount({
        ...base,
        kind: 'sandbox',
        host: 'imap.example.test',
        port: 143
      } as never).security
    ).toBe('starttls')
    expect(
      normalizeStoredAccount({
        ...base,
        kind: 'production-readonly',
        host: 'imap.example.test',
        port: 993
      } as never).security
    ).toBe('tls')
  })

  it('keep a stored Nur lesen', async () => {
    const { normalizeStoredAccount } = await accounts()
    const stored = {
      id: 'x',
      readOnly: true,
      host: 'imap.example.test',
      port: 993,
      security: 'tls',
      user: 'u',
      email: 'x@example.test'
    }
    expect(normalizeStoredAccount(stored as never).readOnly).toBe(true)
  })

  it('lose the old fields on the next save', async () => {
    const { saveMailAccount } = await accounts()
    storeRaw([
      {
        id: 'b',
        kind: 'sandbox',
        canary: true,
        host: 'imap.example.test',
        port: 993,
        security: 'tls',
        user: 'postfach@example.test',
        email: 'postfach@example.test',
        smtpHost: 'smtp.example.test',
        smtpPort: 465,
        smtpSecurity: 'tls',
        password: Buffer.from('enc:pass').toString('base64')
      }
    ])
    saveMailAccount(real({ id: 'b', password: undefined, signature: 'Gruß' }) as never)
    const [stored] = storedRaw()
    expect(stored).not.toHaveProperty('kind')
    expect(stored).not.toHaveProperty('canary')
    expect(stored.readOnly).toBe(false)
  })
})

describe('I6: encryption is checked in main', () => {
  it('refuses a cleartext IMAP login to a real server, and writes nothing', async () => {
    const { saveMailAccount, listMailAccounts } = await accounts()
    expect(() => saveMailAccount(real({ security: 'none', port: 143 }) as never)).toThrow(
      /echtes Postfach braucht eine Verschlüsselung/
    )
    expect(listMailAccounts()).toEqual([])
  })

  it('refuses a cleartext SMTP login to a real server, read-only or not', async () => {
    const { saveMailAccount, listMailAccounts } = await accounts()
    for (const readOnly of [true, false]) {
      expect(() => saveMailAccount(real({ readOnly, smtpSecurity: 'none' }) as never)).toThrow(
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
        host: '127.0.0.1',
        security: 'none',
        smtpHost: 'smtp.example.test'
      })
    ).toThrow(/SMTP-Server/)
  })

  it('allows a cleartext login on loopback only', async () => {
    const { checkMailAccountSettings } = await accounts()
    expect(() =>
      checkMailAccountSettings({
        host: '127.0.0.1',
        security: 'none',
        smtpHost: 'localhost',
        smtpSecurity: 'none'
      })
    ).not.toThrow()
  })
})

describe('I6: the router checks before the connection test', () => {
  it('throws what a save would throw, and writes nothing', async () => {
    const { checkMailAccountSave, listMailAccounts } = await accounts()
    expect(() => checkMailAccountSave(real({ smtpSecurity: 'none' }) as never)).toThrow(
      /SMTP-Server/
    )
    expect(() => checkMailAccountSave(real() as never)).not.toThrow()
    expect(listMailAccounts()).toEqual([])
  })
})
