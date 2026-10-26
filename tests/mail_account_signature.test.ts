// MR-13: the account signature was saved but never handed back.
//
// `saveMailAccount` stores `input.signature`, and `toDto` leaves it out - so the renderer read
// `account.signature` (MailPage, MailWindowPage, MailAccountsCard) and always got undefined:
// a new mail never carried a signature, and opening the account form and saving it WIPED the stored one
// (because the form had no value to send back).
//
// The round trip is the claim: save, read it back through the DTO the renderer actually receives.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const dirs: string[] = []
let userData = ''

// The module reads the data folder through electron's app.getPath and encrypts with safeStorage,
// so both are stubbed - the save/read path under test is the module's own.
vi.mock('electron', () => ({
  app: { getPath: (): string => userData },
  safeStorage: {
    isEncryptionAvailable: (): boolean => true,
    encryptString: (s: string): Buffer => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer): string => b.toString().replace(/^enc:/, '')
  }
}))

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-signature-'))
  dirs.push(userData)
})

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const account = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'sandbox',
  host: '127.0.0.1',
  port: 10143,
  security: 'none',
  user: 'signatur@example.test',
  email: 'signatur@example.test',
  password: 'pass',
  ...over
})

describe('MR-13: the account signature survives the DTO', () => {
  it('hands the saved signature back to the renderer', async () => {
    const { saveMailAccount } = await import('../src/main/mailclient/accounts')
    const saved = saveMailAccount(account({ signature: 'Viele Gruesse' }) as never)
    // The renderer reads this field; without it, no new mail can carry a signature.
    expect((saved as { signature?: string }).signature).toBe('Viele Gruesse')
  })

  it('keeps the signature when the form is saved without one', async () => {
    // The second half of MR-13: opening the account form and saving it wiped the signature, because
    // the form sent nothing back. A save without a signature must leave the stored one alone.
    const { saveMailAccount, listMailAccounts } = await import('../src/main/mailclient/accounts')
    const saved = saveMailAccount(account({ signature: 'Viele Gruesse' }) as never) as {
      id: string
    }

    saveMailAccount(account({ id: saved.id }) as never)

    const after = listMailAccounts().find((a) => a.id === saved.id)
    expect((after as { signature?: string }).signature).toBe('Viele Gruesse')
  })

  it('still clears it when the user empties the field', async () => {
    // The negative half: "keep it when absent" must not become "never clear it", or the user cannot
    // remove a signature at all.
    const { saveMailAccount, listMailAccounts } = await import('../src/main/mailclient/accounts')
    const saved = saveMailAccount(account({ signature: 'Viele Gruesse' }) as never) as {
      id: string
    }

    saveMailAccount(account({ id: saved.id, signature: '' }) as never)

    const after = listMailAccounts().find((a) => a.id === saved.id)
    expect((after as { signature?: string }).signature).toBeUndefined()
  })
})
