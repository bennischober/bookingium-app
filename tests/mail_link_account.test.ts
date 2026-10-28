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
      readOnly: false,
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

describe('mailLink.listByEntity', () => {
  it('says the mailbox is unavailable when the lookup fails, rather than calling the mails gone', async () => {
    const { mailLinkRouter } = await import('../src/main/api/routers/mail_link.router')
    const { mailClient } = await import('../src/main/mailclient/MailClientService')
    const sqlite = getTestDb().sqlite
    const personId = Number(
      sqlite.prepare("INSERT INTO person (first_name, last_name) VALUES ('Max','Mustermann')").run()
        .lastInsertRowid
    )
    sqlite
      .prepare(
        "INSERT INTO mail_link (mail_account_id, message_id, entity_type, entity_id, source) VALUES ('acc','<x@example.test>','person',?,'address')"
      )
      .run(personId)
    const caller = mailLinkRouter.createCaller({})
    const input = { entityType: 'person' as const, entityId: personId, limit: 20 }

    const call = vi.spyOn(mailClient, 'call').mockRejectedValueOnce(new Error('worker down'))
    const down = await caller.listByEntity(input)
    expect(down.unavailable).toBe(true)
    expect(down.rows).toHaveLength(1)

    call.mockResolvedValueOnce([])
    const gone = await caller.listByEntity(input)
    expect(gone.unavailable).toBe(false)
    expect(gone.rows[0].storeId).toBeNull()
    call.mockRestore()
  })

  it('shows a dismissed link again after "Rückgängig"', async () => {
    const { mailLinkRouter } = await import('../src/main/api/routers/mail_link.router')
    const { mailClient } = await import('../src/main/mailclient/MailClientService')
    const sqlite = getTestDb().sqlite
    const personId = Number(
      sqlite.prepare("INSERT INTO person (first_name, last_name) VALUES ('Erika','Beispiel')").run()
        .lastInsertRowid
    )
    const linkId = Number(
      sqlite
        .prepare(
          "INSERT INTO mail_link (mail_account_id, message_id, entity_type, entity_id, source) VALUES ('acc','<y@example.test>','person',?,'address')"
        )
        .run(personId).lastInsertRowid
    )
    const call = vi.spyOn(mailClient, 'call').mockResolvedValue([])
    const caller = mailLinkRouter.createCaller({})
    const input = { entityType: 'person' as const, entityId: personId, limit: 20 }

    await caller.dismiss({ id: linkId })
    expect((await caller.listByEntity(input)).rows).toHaveLength(0)
    await caller.restore({ id: linkId })
    expect((await caller.listByEntity(input)).rows.map((row) => row.id)).toEqual([linkId])
    call.mockRestore()
  })
})
