// "Zuordnen…" takes the account id from the renderer: mailLink.link refuses one that is not a
// configured account, and links as before for one that is.
import 'reflect-metadata'
import { afterAll, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { setupTestDb, getTestDb } from './helpers/setup'

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-link-account-'))

// accounts.ts reads the data folder through electron's app.getPath and stores the password
// through safeStorage; both are stubbed so the account list is a real file in a temp folder
vi.mock('electron', () => ({
  app: { getPath: (): string => userData },
  safeStorage: {
    isEncryptionAvailable: (): boolean => true,
    encryptString: (s: string): Buffer => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer): string => b.toString().replace(/^enc:/, '')
  }
}))

setupTestDb()

afterAll(() => fs.rmSync(userData, { recursive: true, force: true }))

describe('mailLink.link', () => {
  it('links a mail only into a configured account', async () => {
    const { saveMailAccount } = await import('../src/main/mailclient/accounts')
    const { mailLinkRouter } = await import('../src/main/api/routers/mail_link.router')
    const account = saveMailAccount({
      kind: 'sandbox',
      host: '127.0.0.1',
      port: 10143,
      security: 'none',
      user: 'zuordnen@example.test',
      email: 'zuordnen@example.test',
      password: 'pass'
    } as never) as { id: string }

    const sqlite = getTestDb().sqlite
    const contactId = Number(
      sqlite.prepare("INSERT INTO contact (email) VALUES ('erika@example.test')").run()
        .lastInsertRowid
    )
    const personId = Number(
      sqlite
        .prepare(
          "INSERT INTO person (first_name, last_name, contact_id) VALUES ('Erika','Musterfrau',?)"
        )
        .run(contactId).lastInsertRowid
    )
    const caller = mailLinkRouter.createCaller({})
    const input = {
      messageId: '<hand@example.test>',
      entityType: 'person' as const,
      entityId: personId
    }

    await expect(caller.link({ ...input, accountId: 'gibt-es-nicht' })).rejects.toThrow(
      'Das Mail-Konto gibt es nicht mehr'
    )
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM mail_link').get()).toEqual({ n: 0 })

    await expect(caller.link({ ...input, accountId: account.id })).resolves.toEqual({
      linked: true
    })
    expect(sqlite.prepare('SELECT mail_account_id FROM mail_link').all()).toEqual([
      { mail_account_id: account.id }
    ])
  })
})
