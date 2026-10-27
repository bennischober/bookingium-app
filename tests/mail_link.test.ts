// C2: the linker decides which mails belong to which record. The resolution is a pure
// function, so the rules are testable without a mailbox; the repository side runs against
// the real in-memory app database.
import 'reflect-metadata'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { setupTestDb, getTestDb } from './helpers/setup'
import { container } from 'tsyringe'
import {
  linkableFolder,
  mailAddresses,
  mailLinkRunner,
  mailLinkTrigger,
  ownMailAddresses,
  resolveLinks,
  threadParents,
  type AddressLookup,
  type LinkableHeader,
  type ThreadLookup
} from '../src/main/services/MailLinkService'
import { SettingsRepository } from '../src/main/repositories/SettingsRepository'
import { MailLinkService } from '../src/main/services/MailLinkService'

setupTestDb()

// One in-memory DB for the whole file: each test starts from empty tables
beforeEach(() => {
  const sqlite = getTestDb().sqlite
  for (const table of ['mail_link', 'person', 'contact_email', 'contact', 'app_setting']) {
    sqlite.prepare(`DELETE FROM ${table}`).run()
  }
})

const header = (over: Partial<LinkableHeader> = {}): LinkableHeader => ({
  messageId: '<a@example.test>',
  fallbackKey: 'fb',
  inReplyTo: null,
  references: [],
  fromEmail: 'erika@example.test',
  toEmails: ['ich@example.test'],
  ccEmails: [],
  ...over
})

const noneAddress: AddressLookup = () => []
const noneThread: ThreadLookup = () => []

describe('linker resolution (C2)', () => {
  it('links a mail by the address of its sender', () => {
    const links = resolveLinks(
      header(),
      ['ich@example.test'],
      (address) =>
        address === 'erika@example.test' ? [{ entityType: 'person', entityId: 7 }] : [],
      noneThread
    )
    expect(links).toEqual([{ owner: { entityType: 'person', entityId: 7 }, source: 'address' }])
  })

  it('matches addresses case-insensitively and ignores surrounding spaces', () => {
    const lookup: AddressLookup = (address) =>
      address === 'erika@example.test' ? [{ entityType: 'person', entityId: 7 }] : []
    // The store may hold any casing and padding
    const links = resolveLinks(
      header({ fromEmail: '  Erika@Example.TEST ' }),
      ['ich@example.test'],
      lookup,
      noneThread
    )
    expect(links).toHaveLength(1)
  })

  it('never links the account’s own address', () => {
    expect(mailAddresses(header(), ['ICH@example.test'])).toEqual(['erika@example.test'])
  })

  it('never links any of the user’s own addresses (host L3)', () => {
    const mail = header({
      toEmails: ['ich@example.test', 'Buero@example.test'],
      ccEmails: ['kollege@example.test']
    })
    expect(mailAddresses(mail, ['ich@example.test', 'buero@example.test'])).toEqual([
      'erika@example.test',
      'kollege@example.test'
    ])
  })

  it('takes every account’s address and address-shaped login as the user’s own (host L3)', () => {
    expect(
      ownMailAddresses([
        { email: ' Ich@Example.test', user: 'ich@example.test' },
        { email: 'buero@example.test', user: 'login-ohne-adresse' },
        { email: 'ich@example.test', user: 'Postfach@example.test' }
      ])
    ).toEqual(['ich@example.test', 'buero@example.test', 'postfach@example.test'])
  })

  it('takes an account’s further own addresses as the user’s own too', () => {
    expect(
      ownMailAddresses([
        {
          email: 'ich@example.test',
          user: 'ich@example.test',
          aliases: [' Info@Example.test', 'kein-at', 'ich@example.test']
        },
        { email: 'buero@example.test', user: 'buero' }
      ])
    ).toEqual(['ich@example.test', 'info@example.test', 'buero@example.test'])
  })

  it('inherits the links of the mail it answers', () => {
    const lookupThread: ThreadLookup = (id) =>
      id === 'parent@example.test' ? [{ entityType: 'company', entityId: 3 }] : []
    const links = resolveLinks(
      header({ inReplyTo: '<parent@example.test>' }),
      ['ich@example.test'],
      noneAddress,
      lookupThread
    )
    expect(links).toEqual([{ owner: { entityType: 'company', entityId: 3 }, source: 'thread' }])
  })

  it('inherits through any reference, not only the direct parent', () => {
    const links = resolveLinks(
      header({ references: ['<older@example.test>', '<parent@example.test>'] }),
      ['ich@example.test'],
      noneAddress,
      (id) => (id === 'older@example.test' ? [{ entityType: 'band', entityId: 5 }] : [])
    )
    expect(links).toEqual([{ owner: { entityType: 'band', entityId: 5 }, source: 'thread' }])
  })

  it('never links a mail twice, address wins over thread', () => {
    const links = resolveLinks(
      header({ inReplyTo: '<parent@example.test>' }),
      ['ich@example.test'],
      () => [{ entityType: 'person', entityId: 7 }],
      () => [{ entityType: 'person', entityId: 7 }]
    )
    expect(links).toEqual([{ owner: { entityType: 'person', entityId: 7 }, source: 'address' }])
  })

  it('strips the angle brackets of Message-IDs', () => {
    expect(threadParents({ inReplyTo: '<a@b.test>', references: ['<c@d.test>'] })).toEqual([
      'a@b.test',
      'c@d.test'
    ])
    // An already-bare id stays as it is
    expect(threadParents({ inReplyTo: 'a@b.test', references: [] })).toEqual(['a@b.test'])
  })

  it('links nothing when no address and no parent matches', () => {
    expect(resolveLinks(header(), ['ich@example.test'], noneAddress, noneThread)).toEqual([])
  })
})

describe('linker trigger (MR-28)', () => {
  const folderDone = (accountId: string, path: string, specialUse: string | null) => ({
    type: 'sync-event',
    accountId,
    event: {
      type: 'folder-done',
      path,
      newCount: 1,
      flagChanges: 0,
      expunged: 0,
      moved: 0,
      specialUse
    }
  })
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  it('finds Sent by its special-use, not by its name', () => {
    expect(linkableFolder({ path: 'INBOX', specialUse: null })).toBe(true)
    expect(linkableFolder({ path: 'Gesendete Objekte', specialUse: '\\Sent' })).toBe(true)
    // A folder that is only called Sent is not the Sent folder
    expect(linkableFolder({ path: 'Archiv/SENT', specialUse: null })).toBe(false)
    expect(linkableFolder({ path: 'Archiv', specialUse: '\\Archive' })).toBe(false)
  })

  it('links after a Sent folder of any name and ignores other folders', async () => {
    const link = vi.fn(async () => undefined)
    const trigger = mailLinkTrigger({ link, log: vi.fn() })
    trigger(folderDone('acc', 'Gesendete Objekte', '\\Sent'))
    await settle()
    trigger(folderDone('acc', 'Archiv', null))
    trigger({
      type: 'sync-event',
      accountId: 'acc',
      event: { type: 'folder-start', path: 'INBOX' }
    })
    await settle()
    expect(link.mock.calls).toEqual([['acc']])
  })

  it('logs a failed run and still runs the pass that was asked for during it', async () => {
    let fail: (error: Error) => void = () => undefined
    const link = vi
      .fn<(accountId: string) => Promise<unknown>>()
      .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
      .mockResolvedValue(undefined)
    const log = vi.fn()
    const trigger = mailLinkTrigger({ link, log })
    trigger(folderDone('acc', 'INBOX', null))
    await settle()
    // A second folder finishes while the first run is still going
    trigger(folderDone('acc', 'INBOX', null))
    await settle()
    expect(link).toHaveBeenCalledTimes(1)
    const error = new Error('Store gesperrt')
    fail(error)
    await settle()
    expect(log).toHaveBeenCalledWith(error)
    expect(link).toHaveBeenCalledTimes(2)
  })

  it('runs an account on request and folds a request during a folder run into one more pass', async () => {
    let finish: () => void = () => undefined
    const link = vi
      .fn<(accountId: string) => Promise<unknown>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
      .mockResolvedValue(undefined)
    const runner = mailLinkRunner({ link, log: vi.fn() })
    runner.onEvent(folderDone('acc', 'INBOX', null))
    await settle()
    // A contact gained an address while the folder run is still going, twice
    runner.run('acc')
    runner.run('acc')
    runner.run('other')
    await settle()
    expect(link.mock.calls).toEqual([['acc'], ['other']])
    finish()
    await settle()
    expect(link.mock.calls).toEqual([['acc'], ['other'], ['acc']])
  })

  it('logs a link function that throws instead of crashing the event handler', async () => {
    const error = new Error('sofort')
    const log = vi.fn()
    const trigger = mailLinkTrigger({
      link: () => {
        throw error
      },
      log
    })
    expect(() => trigger(folderDone('acc', 'INBOX', null))).not.toThrow()
    await settle()
    expect(log).toHaveBeenCalledWith(error)
  })
})

describe('mail_link repository (C2)', () => {
  const service = () => container.resolve(MailLinkService)

  /** One contact plus the person that owns it */
  function seedPerson(email: string): { contactId: number; personId: number } {
    const db = getTestDb().sqlite
    const contactId = Number(
      db.prepare('INSERT INTO contact (email) VALUES (?)').run(email).lastInsertRowid
    )
    const personId = Number(
      db
        .prepare('INSERT INTO person (first_name, last_name, contact_id) VALUES (?, ?, ?)')
        .run('Erika', 'Musterfrau', contactId).lastInsertRowid
    )
    return { contactId, personId }
  }

  /** One contact with `persons` people and `companies` companies on it */
  function seedSharedContact(email: string, persons: number, companies = 0): void {
    const db = getTestDb().sqlite
    const contactId = Number(
      db.prepare('INSERT INTO contact (email) VALUES (?)').run(email).lastInsertRowid
    )
    for (let i = 0; i < persons; i++) {
      db.prepare('INSERT INTO person (first_name, last_name, contact_id) VALUES (?, ?, ?)').run(
        'Max',
        `Muster ${i}`,
        contactId
      )
    }
    for (let i = 0; i < companies; i++) {
      db.prepare('INSERT INTO company (name, contact_id) VALUES (?, ?)').run(
        `Muster GmbH ${i}`,
        contactId
      )
    }
  }

  /** A header as the worker sends it: a linkable header with its store row id */
  const stored = (
    id: number,
    over: Partial<LinkableHeader> = {}
  ): LinkableHeader & { id: number } => ({
    ...header({ messageId: `<${id}@example.test>`, fallbackKey: `fb-${id}` }),
    ...over,
    id
  })

  /** Answers the worker's header query from `pages`, recording the cursor of each call */
  async function stubHeaders(
    answer: (cursor: number) => { generation: string; headers: (LinkableHeader & { id: number })[] }
  ): Promise<{ cursors: number[]; restore: () => void }> {
    const { mailClient } = await import('../src/main/mailclient/MailClientService')
    const call = mailClient.call.bind(mailClient)
    const cursors: number[] = []
    mailClient.call = (async (method: string, args: unknown[]) => {
      expect(method).toBe('listHeadersSince')
      const cursor = args[0] as number
      cursors.push(cursor)
      return answer(cursor)
    }) as never
    return { cursors, restore: () => (mailClient.call = call as never) }
  }

  it('inserts a link once and ignores the same link again', () => {
    const { personId } = seedPerson('erika@example.test')
    const svc = service()
    const first = svc.insertLink({
      accountId: 'acc',
      messageId: '<a@example.test>',
      fallbackKey: null,
      entityType: 'person',
      entityId: personId,
      source: 'address'
    })
    const second = svc.insertLink({
      accountId: 'acc',
      messageId: 'a@example.test',
      fallbackKey: null,
      entityType: 'person',
      entityId: personId,
      source: 'address'
    })
    expect(first).toBe(1)
    expect(second).toBe(0)
    const rows = getTestDb().sqlite.prepare('SELECT COUNT(*) AS n FROM mail_link').get() as {
      n: number
    }
    expect(rows.n).toBe(1)
  })

  it('treats a NULL Message-ID as distinct from another NULL, keyed by the fallback', () => {
    const { personId } = seedPerson('erika@example.test')
    const svc = service()
    const insert = (fallbackKey: string): number =>
      svc.insertLink({
        accountId: 'acc',
        messageId: null,
        fallbackKey,
        entityType: 'person',
        entityId: personId,
        source: 'address'
      })
    // Two mails without a Message-ID are two different mails
    expect(insert('fb-1')).toBe(1)
    expect(insert('fb-2')).toBe(1)
    // The same fallback key is the same mail
    expect(insert('fb-1')).toBe(0)
  })

  it('never re-adds a link the user dismissed', () => {
    const { personId } = seedPerson('erika@example.test')
    const svc = service()
    svc.insertLink({
      accountId: 'acc',
      messageId: '<a@example.test>',
      fallbackKey: null,
      entityType: 'person',
      entityId: personId,
      source: 'address'
    })
    const row = getTestDb().sqlite.prepare('SELECT id FROM mail_link').get() as { id: number }
    svc.dismissLink(row.id)
    // The linker sees the same mail again and must leave it alone
    const added = svc.insertLink({
      accountId: 'acc',
      messageId: '<a@example.test>',
      fallbackKey: null,
      entityType: 'person',
      entityId: personId,
      source: 'address'
    })
    expect(added).toBe(0)
    // The history panel does not show a dismissed link
    expect(svc.messagesFor('person', personId, 'acc')).toEqual([])
  })

  it('resolves an address to the records that own it', () => {
    const { personId } = seedPerson('Erika@Example.test')
    const owners = service().addressOwners('  erika@example.test ')
    expect(owners).toEqual([{ entityType: 'person', entityId: personId }])
  })

  it('counts the records behind one contact against the shared-address cap (host L3)', () => {
    seedSharedContact('team@example.test', 21)
    expect(service().addressOwners('team@example.test')).toEqual([])
    // People and companies both count
    seedSharedContact('buero@example.test', 20, 1)
    expect(service().addressOwners('buero@example.test')).toEqual([])
    seedSharedContact('kasse@example.test', 20)
    expect(service().addressOwners('kasse@example.test')).toHaveLength(20)
  })

  it('never auto-links a shared address', () => {
    // 21 contacts on the same address is a shared mailbox, not one person
    for (let i = 0; i < 21; i++) seedPerson('info@example.test')
    expect(service().addressOwners('info@example.test')).toEqual([])
    // 20 is still a normal address
    for (let i = 0; i < 20; i++) seedPerson('office@example.test')
    expect(service().addressOwners('office@example.test')).toHaveLength(20)
  })

  it('takes a deleted record’s links with it', () => {
    const { personId } = seedPerson('erika@example.test')
    const svc = service()
    svc.insertLink({
      accountId: 'acc',
      messageId: '<a@example.test>',
      fallbackKey: null,
      entityType: 'person',
      entityId: personId,
      source: 'address'
    })
    getTestDb().sqlite.prepare('DELETE FROM person WHERE id = ?').run(personId)
    const rows = getTestDb().sqlite.prepare('SELECT COUNT(*) AS n FROM mail_link').get() as {
      n: number
    }
    expect(rows.n).toBe(0)
  })

  it('keeps the cursor per account with its store and restarts at 0 when it is missing', () => {
    const svc = service()
    const start = { generation: null, id: 0 }
    expect(svc.cursorFor('acc')).toEqual(start)
    const settings = container.resolve(SettingsRepository)
    settings.setMany({ 'mailLinkCursor:acc': JSON.stringify({ generation: 'g1', id: 42 }) })
    expect(svc.cursorFor('acc')).toEqual({ generation: 'g1', id: 42 })
    expect(svc.cursorFor('other')).toEqual(start)
    // The bare number of earlier builds names no store and is not trusted (MR-28)
    settings.setMany({ 'mailLinkCursor:acc': '42' })
    expect(svc.cursorFor('acc')).toEqual(start)
    // A broken value never makes the linker start in the middle
    for (const broken of [
      'kaputt',
      'null',
      '{"generation":"g1","id":-1}',
      '{"generation":"g1","id":1.5}',
      '{"id":3}'
    ]) {
      settings.setMany({ 'mailLinkCursor:acc': broken })
      expect(svc.cursorFor('acc')).toEqual(start)
    }
  })

  it('restarts from 0 when the store is another one than the cursor’s (MR-28)', async () => {
    const { personId } = seedPerson('erika@example.test')
    // A rebuilt store numbers its rows again from 1, so the old position would skip
    // every mail for good
    const settings = container.resolve(SettingsRepository)
    settings.setMany({ 'mailLinkCursor:acc': JSON.stringify({ generation: 'alt', id: 9999 }) })
    const stub = await stubHeaders((cursor) => ({
      generation: 'neu',
      headers: [stored(1), stored(2)].filter((h) => h.id > cursor)
    }))
    try {
      const svc = service()
      expect(await svc.linkAccount('acc', ['ich@example.test'])).toEqual({ linked: 2, scanned: 2 })
      expect(stub.cursors).toEqual([9999, 0, 2])
      expect(svc.cursorFor('acc')).toEqual({ generation: 'neu', id: 2 })
      expect(svc.messagesFor('person', personId, 'acc')).toHaveLength(2)
    } finally {
      stub.restore()
    }
  })

  it('goes on from the cursor while the store stays the same (MR-28)', async () => {
    seedPerson('erika@example.test')
    const settings = container.resolve(SettingsRepository)
    settings.setMany({ 'mailLinkCursor:acc': JSON.stringify({ generation: 'g1', id: 5 }) })
    const stub = await stubHeaders((cursor) => ({
      generation: 'g1',
      headers: [stored(5), stored(6), stored(7)].filter((h) => h.id > cursor)
    }))
    try {
      const svc = service()
      expect(await svc.linkAccount('acc', ['ich@example.test'])).toEqual({ linked: 2, scanned: 2 })
      expect(stub.cursors).toEqual([5, 7])
      expect(svc.cursorFor('acc')).toEqual({ generation: 'g1', id: 7 })
    } finally {
      stub.restore()
    }
  })

  it('leaves no links and keeps the cursor when a batch fails (MR-28)', async () => {
    seedPerson('erika@example.test')
    const settings = container.resolve(SettingsRepository)
    settings.setMany({ 'mailLinkCursor:acc': JSON.stringify({ generation: 'g1', id: 0 }) })
    const stub = await stubHeaders((cursor) => ({
      generation: 'g1',
      headers: [stored(1), stored(2, { fromEmail: 'kaputt@example.test' })].filter(
        (h) => h.id > cursor
      )
    }))
    const svc = service()
    const owners = svc.addressOwners.bind(svc)
    // The first mail links; the second fails half-way through the batch
    vi.spyOn(svc, 'addressOwners').mockImplementation((address) => {
      if (address === 'kaputt@example.test') throw new Error('Kontakte gesperrt')
      return owners(address)
    })
    try {
      await expect(svc.linkAccount('acc', ['ich@example.test'])).rejects.toThrow(
        'Kontakte gesperrt'
      )
      const rows = getTestDb().sqlite.prepare('SELECT COUNT(*) AS n FROM mail_link').get() as {
        n: number
      }
      expect(rows.n).toBe(0)
      expect(svc.cursorFor('acc')).toEqual({ generation: 'g1', id: 0 })
    } finally {
      stub.restore()
    }
  })

  it('does not hand a dismissed link on to the replies (MR-28)', () => {
    const { personId } = seedPerson('erika@example.test')
    const svc = service()
    svc.insertLink({
      accountId: 'acc',
      messageId: '<eltern@example.test>',
      fallbackKey: null,
      entityType: 'person',
      entityId: personId,
      source: 'address'
    })
    expect(svc.threadOwners('<eltern@example.test>', 'acc')).toEqual([
      { entityType: 'person', entityId: personId }
    ])
    const row = getTestDb().sqlite.prepare('SELECT id FROM mail_link').get() as { id: number }
    svc.dismissLink(row.id)
    expect(svc.threadOwners('<eltern@example.test>', 'acc')).toEqual([])
    // A reply from an address nobody owns links nothing
    const reply = header({
      messageId: '<antwort@example.test>',
      fromEmail: 'fremd@example.test',
      inReplyTo: '<eltern@example.test>'
    })
    expect(svc.linkBatch('acc', ['ich@example.test'], [reply])).toBe(0)
  })

  it('links a batch of headers and counts only the new links', () => {
    const { personId } = seedPerson('erika@example.test')
    const svc = service()
    const headers: LinkableHeader[] = [
      header({ messageId: '<1@example.test>' }),
      header({ messageId: '<2@example.test>' })
    ]
    expect(svc.linkBatch('acc', ['ich@example.test'], headers)).toBe(2)
    // Running the same batch again adds nothing
    expect(svc.linkBatch('acc', ['ich@example.test'], headers)).toBe(0)
    expect(svc.messagesFor('person', personId, 'acc')).toHaveLength(2)
  })

  /** A further address on an existing contact, as the repositories store it */
  function addAddress(contactId: number, email: string, position = 0): void {
    getTestDb()
      .sqlite.prepare('INSERT INTO contact_email (contact_id, email, position) VALUES (?, ?, ?)')
      .run(contactId, email, position)
  }

  const linkCount = (): number =>
    (getTestDb().sqlite.prepare('SELECT COUNT(*) AS n FROM mail_link').get() as { n: number }).n

  it('resolves a further address of a contact to the records that own it', () => {
    const { contactId, personId } = seedPerson('erika@example.test')
    addAddress(contactId, 'privat@example.test')
    expect(service().addressOwners(' Privat@Example.TEST ')).toEqual([
      { entityType: 'person', entityId: personId }
    ])
    // The primary address still matches
    expect(service().addressOwners('erika@example.test')).toEqual([
      { entityType: 'person', entityId: personId }
    ])
  })

  it('links a mail from or to a further address', () => {
    const { contactId, personId } = seedPerson('erika@example.test')
    addAddress(contactId, 'privat@example.test')
    const svc = service()
    const headers = [
      header({ messageId: '<von@example.test>', fromEmail: 'privat@example.test' }),
      header({
        messageId: '<an@example.test>',
        fromEmail: 'ich@example.test',
        toEmails: ['privat@example.test']
      })
    ]
    expect(svc.linkBatch('acc', ['ich@example.test'], headers)).toBe(2)
    expect(svc.messagesFor('person', personId, 'acc')).toEqual(
      expect.arrayContaining([
        { messageId: 'von@example.test', source: 'address' },
        { messageId: 'an@example.test', source: 'address' }
      ])
    )
  })

  it('counts a record once when its contact holds the address twice', () => {
    const { contactId, personId } = seedPerson('erika@example.test')
    // The repositories never store this; a hand-edited database might
    addAddress(contactId, 'erika@example.test')
    expect(service().addressOwners('erika@example.test')).toEqual([
      { entityType: 'person', entityId: personId }
    ])
  })

  it('counts further addresses against the shared-address cap (host L3)', () => {
    // 21 contacts that each list the address as a further one: a shared mailbox
    for (let i = 0; i < 21; i++) {
      addAddress(seedPerson(`p${i}@example.test`).contactId, 'team@example.test')
    }
    expect(service().addressOwners('team@example.test')).toEqual([])
    // 20 primaries plus one further address are 21 records as well
    for (let i = 0; i < 20; i++) seedPerson('buero@example.test')
    addAddress(seedPerson('extra@example.test').contactId, 'buero@example.test')
    expect(service().addressOwners('buero@example.test')).toEqual([])
    // 20 in all is still a normal address
    for (let i = 0; i < 19; i++) seedPerson('kasse@example.test')
    addAddress(seedPerson('kasse2@example.test').contactId, 'kasse@example.test')
    expect(service().addressOwners('kasse@example.test')).toHaveLength(20)
  })

  it('hands a link made by a further address on to the replies', () => {
    const { contactId, personId } = seedPerson('erika@example.test')
    addAddress(contactId, 'privat@example.test')
    const svc = service()
    svc.linkBatch(
      'acc',
      ['ich@example.test'],
      [header({ messageId: '<eltern@example.test>', fromEmail: 'privat@example.test' })]
    )
    // A reply from an address nobody owns inherits the link of the mail it answers
    const reply = header({
      messageId: '<antwort@example.test>',
      fromEmail: 'fremd@example.test',
      inReplyTo: '<eltern@example.test>'
    })
    expect(svc.linkBatch('acc', ['ich@example.test'], [reply])).toBe(1)
    expect(svc.messagesFor('person', personId, 'acc')).toContainEqual({
      messageId: 'antwort@example.test',
      source: 'thread'
    })
  })

  it('rescans from 0 once a contact gained an address, and only then', async () => {
    const { contactId, personId } = seedPerson('erika@example.test')
    const mails = [
      stored(1),
      stored(2, { fromEmail: 'privat@example.test' }),
      stored(3, { fromEmail: 'fremd@example.test' })
    ]
    const stub = await stubHeaders((cursor) => ({
      generation: 'g1',
      headers: mails.filter((h) => h.id > cursor)
    }))
    try {
      const svc = service()
      // The first run stores the addresses it linked with; no digest yet is no change
      expect(await svc.linkAccount('acc', ['ich@example.test'])).toEqual({
        linked: 1,
        scanned: 3
      })
      // Nothing changed: the run goes on from the cursor
      expect(await svc.linkAccount('acc', ['ich@example.test'])).toEqual({
        linked: 0,
        scanned: 0
      })
      expect(stub.cursors).toEqual([0, 3, 3])

      addAddress(contactId, 'privat@example.test')
      stub.cursors.length = 0
      // The new address's older mail is found; the first mail is not linked twice
      expect(await svc.linkAccount('acc', ['ich@example.test'])).toEqual({
        linked: 1,
        scanned: 3
      })
      expect(stub.cursors).toEqual([0, 3])
      expect(svc.messagesFor('person', personId, 'acc')).toHaveLength(2)
    } finally {
      stub.restore()
    }
  })

  it('keeps the cursor of an account that has no address digest yet', async () => {
    seedPerson('erika@example.test')
    const settings = container.resolve(SettingsRepository)
    // An account linked by a build from before the digest
    settings.setMany({ 'mailLinkCursor:acc': JSON.stringify({ generation: 'g1', id: 5 }) })
    const stub = await stubHeaders((cursor) => ({
      generation: 'g1',
      headers: [stored(5), stored(6)].filter((h) => h.id > cursor)
    }))
    try {
      await service().linkAccount('acc', ['ich@example.test'])
      expect(stub.cursors).toEqual([5, 6])
      expect(settings.getAll()['mailLinkAddresses:acc']).toBeDefined()
    } finally {
      stub.restore()
    }
  })

  it('leaves a dismissed link dismissed when a new address rescans the mail', async () => {
    const { contactId, personId } = seedPerson('erika@example.test')
    const stub = await stubHeaders((cursor) => ({
      generation: 'g1',
      headers: [stored(1), stored(2, { fromEmail: 'privat@example.test' })].filter(
        (h) => h.id > cursor
      )
    }))
    try {
      const svc = service()
      await svc.linkAccount('acc', ['ich@example.test'])
      const row = getTestDb().sqlite.prepare('SELECT id FROM mail_link').get() as { id: number }
      svc.dismissLink(row.id)

      addAddress(contactId, 'privat@example.test')
      expect(await svc.linkAccount('acc', ['ich@example.test'])).toEqual({
        linked: 1,
        scanned: 2
      })
      // Only the new address's mail shows; the dismissed one stays gone
      expect(svc.messagesFor('person', personId, 'acc')).toEqual([
        { messageId: '2@example.test', source: 'address' }
      ])
    } finally {
      stub.restore()
    }
  })

  it('keeps the links of an address the contact no longer has', async () => {
    const { contactId, personId } = seedPerson('erika@example.test')
    addAddress(contactId, 'privat@example.test')
    const stub = await stubHeaders((cursor) => ({
      generation: 'g1',
      headers: [stored(1, { fromEmail: 'privat@example.test' })].filter((h) => h.id > cursor)
    }))
    try {
      const svc = service()
      await svc.linkAccount('acc', ['ich@example.test'])
      getTestDb().sqlite.prepare('DELETE FROM contact_email').run()
      await svc.linkAccount('acc', ['ich@example.test'])
      expect(svc.messagesFor('person', personId, 'acc')).toHaveLength(1)
    } finally {
      stub.restore()
    }
  })

  it('links a mail by hand, once', () => {
    const { personId } = seedPerson('erika@example.test')
    const svc = service()
    const input = {
      accountId: 'acc',
      messageId: '<hand@example.test>',
      entityType: 'person' as const,
      entityId: personId
    }
    expect(svc.linkManually(input)).toBe(1)
    expect(svc.linkManually(input)).toBe(0)
    expect(svc.messagesFor('person', personId, 'acc')).toEqual([
      { messageId: 'hand@example.test', source: 'manual' }
    ])
  })

  it('brings back a link the user dismissed when they link the mail by hand', () => {
    const { personId } = seedPerson('erika@example.test')
    const svc = service()
    svc.insertLink({
      accountId: 'acc',
      messageId: '<a@example.test>',
      fallbackKey: null,
      entityType: 'person',
      entityId: personId,
      source: 'address'
    })
    const row = getTestDb().sqlite.prepare('SELECT id FROM mail_link').get() as { id: number }
    svc.dismissLink(row.id)
    expect(
      svc.linkManually({
        accountId: 'acc',
        messageId: 'a@example.test',
        entityType: 'person',
        entityId: personId
      })
    ).toBe(1)
    expect(linkCount()).toBe(1)
    expect(svc.messagesFor('person', personId, 'acc')).toEqual([
      { messageId: 'a@example.test', source: 'manual' }
    ])
  })

  it('refuses to link a mail to a record that does not exist, or without a Message-ID', () => {
    const { personId } = seedPerson('erika@example.test')
    const svc = service()
    expect(() =>
      svc.linkManually({
        accountId: 'acc',
        messageId: '<a@example.test>',
        entityType: 'company',
        entityId: 999_999
      })
    ).toThrow('Der Datensatz existiert nicht mehr')
    expect(() =>
      svc.linkManually({
        accountId: 'acc',
        messageId: '<>',
        entityType: 'person',
        entityId: personId
      })
    ).toThrow('keine Message-ID')
    expect(linkCount()).toBe(0)
  })
})

describe('mailLink.listByEntity (C3)', () => {
  it('returns the links of a record, newest first', async () => {
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
    for (const id of ['<a@example.test>', '<b@example.test>']) {
      sqlite
        .prepare(
          "INSERT INTO mail_link (mail_account_id, message_id, entity_type, entity_id, source) VALUES ('acc',?,'person',?,'address')"
        )
        .run(id, personId)
    }
    const svc = container.resolve(MailLinkService)
    expect(svc.messagesFor('person', personId, 'acc')).toHaveLength(2)
  })
})
