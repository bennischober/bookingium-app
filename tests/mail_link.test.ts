// C2: the linker decides which mails belong to which record. The resolution is a pure
// function, so the rules are testable without a mailbox; the repository side runs against
// the real in-memory app database.
import 'reflect-metadata'
import { describe, expect, it, beforeEach } from 'vitest'
import { setupTestDb, getTestDb } from './helpers/setup'
import { container } from 'tsyringe'
import {
  mailAddresses,
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
  for (const table of ['mail_link', 'person', 'contact', 'app_setting']) {
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
      'ich@example.test',
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
      'ich@example.test',
      lookup,
      noneThread
    )
    expect(links).toHaveLength(1)
  })

  it('never links the account’s own address', () => {
    expect(mailAddresses(header(), 'ICH@example.test')).toEqual(['erika@example.test'])
  })

  it('inherits the links of the mail it answers', () => {
    const lookupThread: ThreadLookup = (id) =>
      id === 'parent@example.test' ? [{ entityType: 'company', entityId: 3 }] : []
    const links = resolveLinks(
      header({ inReplyTo: '<parent@example.test>' }),
      'ich@example.test',
      noneAddress,
      lookupThread
    )
    expect(links).toEqual([{ owner: { entityType: 'company', entityId: 3 }, source: 'thread' }])
  })

  it('inherits through any reference, not only the direct parent', () => {
    const links = resolveLinks(
      header({ references: ['<older@example.test>', '<parent@example.test>'] }),
      'ich@example.test',
      noneAddress,
      (id) => (id === 'older@example.test' ? [{ entityType: 'band', entityId: 5 }] : [])
    )
    expect(links).toEqual([{ owner: { entityType: 'band', entityId: 5 }, source: 'thread' }])
  })

  it('never links a mail twice, address wins over thread', () => {
    const links = resolveLinks(
      header({ inReplyTo: '<parent@example.test>' }),
      'ich@example.test',
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
    expect(resolveLinks(header(), 'ich@example.test', noneAddress, noneThread)).toEqual([])
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

  it('keeps the cursor per account and restarts at 0 when it is missing', () => {
    const svc = service()
    expect(svc.cursorFor('acc')).toBe(0)
    const settings = container.resolve(SettingsRepository)
    settings.setMany({ 'mailLinkCursor:acc': '42' })
    expect(svc.cursorFor('acc')).toBe(42)
    // A broken value never makes the linker start in the middle
    settings.setMany({ 'mailLinkCursor:acc': 'kaputt' })
    expect(svc.cursorFor('acc')).toBe(0)
  })

  it('links a batch of headers and counts only the new links', () => {
    const { personId } = seedPerson('erika@example.test')
    const svc = service()
    const headers: LinkableHeader[] = [
      header({ messageId: '<1@example.test>' }),
      header({ messageId: '<2@example.test>' })
    ]
    expect(svc.linkBatch('acc', 'ich@example.test', headers)).toBe(2)
    // Running the same batch again adds nothing
    expect(svc.linkBatch('acc', 'ich@example.test', headers)).toBe(0)
    expect(svc.messagesFor('person', personId, 'acc')).toHaveLength(2)
  })
})
