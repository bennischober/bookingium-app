// I11: the main process hands out nothing a renderer could aim elsewhere.
//
// MR-33: the connection test used the stored password of an account for whatever host the form
// named, so a typo (or a compromised renderer) sent it to another server. It is now handed out only
// for the server, port and login it was saved for, and a save that moves the account elsewhere
// needs the password typed again.
//
// MR-34: `invoice:email` joined the renderer's file name into the folder, so "../x" wrote outside it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const dirs: string[] = []
let userData = ''

// The modules read the data folder through electron's app.getPath and encrypt with safeStorage,
// so both are stubbed - the code under test is the modules' own.
vi.mock('electron', () => ({
  app: { getPath: (): string => userData },
  clipboard: { writeText: (): void => undefined },
  shell: { openPath: async (): Promise<string> => '' },
  safeStorage: {
    isEncryptionAvailable: (): boolean => true,
    encryptString: (s: string): Buffer => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer): string => b.toString().replace(/^enc:/, '')
  }
}))

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-host-hardening-'))
  dirs.push(userData)
})

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const account = {
  readOnly: true,
  host: 'imap.example.test',
  port: 993,
  security: 'tls',
  user: 'konto@example.test',
  email: 'konto@example.test',
  password: 'geheim'
}

describe('MR-33: the stored password stays with its mailbox', () => {
  it('is handed out for the same server, port and login only', async () => {
    const { saveMailAccount, storedPasswordFor } = await import('../src/main/mailclient/accounts')
    const { id } = saveMailAccount(account as never)
    const same = { host: ' IMAP.example.test ', port: 993, user: 'konto@example.test ' }
    expect(storedPasswordFor(id, same)).toBe('geheim')
    expect(storedPasswordFor(id, { ...same, host: 'imap.example-typo.test' })).toBeUndefined()
    expect(storedPasswordFor(id, { ...same, port: 143 })).toBeUndefined()
    expect(storedPasswordFor(id, { ...same, user: 'andere@example.test' })).toBeUndefined()
    expect(storedPasswordFor('unbekannt', same)).toBeUndefined()
  })

  it('refuses to move an account to another server without the password', async () => {
    const { saveMailAccount, listMailAccounts } = await import('../src/main/mailclient/accounts')
    const { id } = saveMailAccount(account as never)
    const edit = { ...account, id, password: undefined }
    expect(() => saveMailAccount({ ...edit, host: 'imap.example-typo.test' } as never)).toThrow(
      'Passwort fehlt'
    )
    expect(() => saveMailAccount({ ...edit, port: 143 } as never)).toThrow('Passwort fehlt')
    expect(() => saveMailAccount({ ...edit, user: 'andere@example.test' } as never)).toThrow(
      'Passwort fehlt'
    )
    expect(listMailAccounts().map((a) => a.host)).toEqual(['imap.example.test'])
    // The same mailbox keeps its password; a new password may go anywhere
    expect(saveMailAccount({ ...edit, email: 'neu@example.test' } as never).id).toBe(id)
    const moved = saveMailAccount({
      ...edit,
      host: 'imap2.example.test',
      password: 'neu'
    } as never)
    expect(moved.id).not.toBe(id)
  })
})

describe('MR-34: the invoice mail files stay in their folder', () => {
  const draft = { to: 'kunde@example.test', subject: 'Rechnung', body: 'Hallo' }

  it('flattens a hostile file name', async () => {
    process.env.BOOKINGIUM_NO_LAUNCH = '1'
    const { openEmail } = await import('../src/main/mail/openEmail')
    for (const fileName of ['../../ausserhalb', '..\\..\\ausserhalb', '/abs/ausserhalb', '']) {
      const result = (await openEmail({
        draft,
        pdf: new Uint8Array([37, 80, 68, 70]),
        fileName,
        setting: 'files'
      })) as { pdfPath: string; folder: string }
      expect(path.dirname(result.pdfPath), fileName).toBe(result.folder)
      expect(fs.existsSync(result.pdfPath)).toBe(true)
      expect(fs.existsSync(result.pdfPath.replace(/\.pdf$/, '.eml'))).toBe(true)
    }
    expect(fs.readdirSync(userData)).toEqual(['E-Mail'])
  })
})
