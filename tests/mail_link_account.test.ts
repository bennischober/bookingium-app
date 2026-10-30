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

  it('pages past links without a date and gives them their mail’s date', async () => {
    const { mailLinkRouter } = await import('../src/main/api/routers/mail_link.router')
    const { mailClient } = await import('../src/main/mailclient/MailClientService')
    const sqlite = getTestDb().sqlite
    const personId = Number(
      sqlite.prepare("INSERT INTO person (first_name, last_name) VALUES ('Lea','Beispiel')").run()
        .lastInsertRowid
    )
    const insert = sqlite.prepare(
      "INSERT INTO mail_link (mail_account_id, message_id, entity_type, entity_id, source, mail_date) VALUES ('acc',?,'person',?,'address',?)"
    )
    const link = (messageId: string, date: string | null): number =>
      Number(insert.run(messageId, personId, date).lastInsertRowid)
    // Two links from before mail_date existed, between two dated ones
    const undatedA = link('a@example.test', null)
    const march = link('march@example.test', '2026-03-01T10:00:00.000Z')
    const undatedB = link('b@example.test', null)
    const may = link('may@example.test', '2026-05-01T10:00:00.000Z')
    // The store knows only the first undated mail
    const call = vi
      .spyOn(mailClient, 'call')
      .mockImplementation(
        async (_method, args) =>
          ((args as [string[]])[0].includes('a@example.test')
            ? [{ id: 1, messageId: 'a@example.test', date: '2026-04-01T10:00:00.000Z' }]
            : []) as never
      )
    const caller = mailLinkRouter.createCaller({})

    const ids: number[] = []
    let cursor: { mailDate: string | null; id: number } | undefined
    for (let page = 0; page < 10; page++) {
      const result = await caller.listByEntity({
        entityType: 'person',
        entityId: personId,
        limit: 1,
        cursor
      })
      ids.push(...result.rows.map((row) => row.id))
      if (!result.nextCursor) break
      cursor = result.nextCursor
    }
    // Every link is reached, the dated ones first, newest first
    expect(ids).toEqual([may, march, undatedB, undatedA])

    expect(sqlite.prepare('SELECT mail_date FROM mail_link WHERE id = ?').get(undatedA)).toEqual({
      mail_date: '2026-04-01T10:00:00.000Z'
    })
    expect(sqlite.prepare('SELECT mail_date FROM mail_link WHERE id = ?').get(undatedB)).toEqual({
      mail_date: null
    })
    // The next visit sorts the backfilled link where its mail belongs
    const again = await caller.listByEntity({ entityType: 'person', entityId: personId, limit: 10 })
    expect(again.rows.map((row) => row.id)).toEqual([may, undatedA, march, undatedB])
    call.mockRestore()
  })
})

describe('restored mail links (#55)', () => {
  it('follow the re-created account with the same address', async () => {
    const { MailLinkService, ACCOUNT_ADDRESSES_KEY } =
      await import('../src/main/services/MailLinkService')
    const { container } = await import('tsyringe')
    const service = container.resolve(MailLinkService)
    const sqlite = getTestDb().sqlite
    const personId = Number(
      sqlite.prepare("INSERT INTO person (first_name, last_name) VALUES ('Ole','Beispiel')").run()
        .lastInsertRowid
    )
    const link = sqlite.prepare(
      "INSERT INTO mail_link (mail_account_id, message_id, entity_type, entity_id, source) VALUES (?,?,'person',?,'address')"
    )
    // The backup's computer had two accounts; this one has new ids for them
    service.rememberAccounts([
      { id: 'alt-büro', email: 'Buero@example.test' },
      { id: 'alt-privat', email: 'privat@example.test' }
    ])
    link.run('alt-büro', '<1@example.test>', personId)
    link.run('alt-privat', '<2@example.test>', personId)
    const documentId = Number(
      sqlite
        .prepare(
          "INSERT INTO document (owner_type, owner_id, file_name, file_type, file_path, file_size, source_mail_account_id) VALUES ('person', ?, 'a.pdf', 'pdf', 'a.pdf', 1, 'alt-büro')"
        )
        .run(personId).lastInsertRowid
    )

    const accounts = [{ id: 'neu-büro', email: 'buero@example.test' }]
    expect(service.adoptRestoredLinks(accounts[0], accounts)).toBe(2)
    expect(
      sqlite
        .prepare('SELECT mail_account_id FROM mail_link WHERE entity_id = ? ORDER BY message_id')
        .all(personId)
    ).toEqual([{ mail_account_id: 'neu-büro' }, { mail_account_id: 'alt-privat' }])
    expect(
      sqlite.prepare('SELECT source_mail_account_id FROM document WHERE id = ?').get(documentId)
    ).toEqual({ source_mail_account_id: 'neu-büro' })
    const known = sqlite
      .prepare('SELECT value FROM app_setting WHERE key = ?')
      .get(ACCOUNT_ADDRESSES_KEY) as { value: string }
    expect(JSON.parse(known.value)).toEqual({
      'neu-büro': 'buero@example.test',
      'alt-privat': 'privat@example.test'
    })
    // Saving it again moves nothing more
    expect(service.adoptRestoredLinks(accounts[0], accounts)).toBe(0)
  })

  it('takes the only unknown account for a backup from before addresses were kept', async () => {
    const { MailLinkService, ACCOUNT_ADDRESSES_KEY } =
      await import('../src/main/services/MailLinkService')
    const { container } = await import('tsyringe')
    const service = container.resolve(MailLinkService)
    const sqlite = getTestDb().sqlite
    sqlite.prepare('DELETE FROM app_setting WHERE key = ?').run(ACCOUNT_ADDRESSES_KEY)
    sqlite.prepare('DELETE FROM mail_link').run()
    sqlite.prepare('DELETE FROM document').run()
    const personId = Number(
      sqlite.prepare("INSERT INTO person (first_name, last_name) VALUES ('Ida','Beispiel')").run()
        .lastInsertRowid
    )
    sqlite
      .prepare(
        "INSERT INTO mail_link (mail_account_id, message_id, entity_type, entity_id, source) VALUES ('alt',?,'person',?,'address')"
      )
      .run('<3@example.test>', personId)

    // Two accounts: no way to tell, nothing moves
    const two = [
      { id: 'neu', email: 'neu@example.test' },
      { id: 'zweit', email: 'zweit@example.test' }
    ]
    expect(service.adoptRestoredLinks(two[0], two)).toBe(0)
    const one = [two[0]]
    expect(service.adoptRestoredLinks(one[0], one)).toBe(1)
    expect(sqlite.prepare('SELECT mail_account_id FROM mail_link').all()).toEqual([
      { mail_account_id: 'neu' }
    ])
  })
})
