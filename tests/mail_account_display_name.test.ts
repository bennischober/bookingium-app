// #211: the account's display name, the name in the From of every mail sent from it. Saved and
// read back through the DTO the renderer gets; omitted keeps it, '' clears it.
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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-display-name-'))
  dirs.push(userData)
})

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const account = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  readOnly: false,
  host: '127.0.0.1',
  port: 10143,
  security: 'none',
  user: 'anzeige@example.test',
  email: 'anzeige@example.test',
  password: 'pass',
  ...over
})

type WithName = { id: string; displayName?: string }

describe('#211: the account display name', () => {
  it('hands the saved name back, kept when omitted, cleared when emptied', async () => {
    const { saveMailAccount, listMailAccounts } = await import('../src/main/mailclient/accounts')
    const saved = saveMailAccount(
      account({ displayName: 'Erika Beispiel | Agentur' }) as never
    ) as WithName
    expect(saved.displayName).toBe('Erika Beispiel | Agentur')

    saveMailAccount(account({ id: saved.id }) as never)
    const kept = listMailAccounts().find((a) => a.id === saved.id) as WithName
    expect(kept.displayName).toBe('Erika Beispiel | Agentur')

    saveMailAccount(account({ id: saved.id, displayName: '' }) as never)
    const cleared = listMailAccounts().find((a) => a.id === saved.id) as WithName
    expect(cleared.displayName).toBeUndefined()
  })

  it('never stores a line break, which would start a header', async () => {
    const { saveMailAccount } = await import('../src/main/mailclient/accounts')
    const saved = saveMailAccount(
      account({ displayName: ' Erika\r\nBcc: x@example.test ' }) as never
    ) as WithName
    expect(saved.displayName).toBe('Erika Bcc: x@example.test')
  })
})
