// G9: the compose lookup must find people you have corresponded with.
//
// The reported case: the canary inbox holds a real mail from IONOS, and typing "ionos" suggested nothing.
// Cause: the contacts table was NEVER populated. rebuildContactsFromMessages() existed but had no caller, and
// upsertContact() was only called from inside it - so "Aus E-Mails" was permanently empty, and the mail-history
// half of the lookup never worked at all.
//
// Two halves, both tested here against a real Store: new mail teaches the table as it arrives, and mail stored
// before this build is backfilled once.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Store } from '../src/main/mailclient/core/store'

const ACCOUNT = 'g9'
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function openStore(): Store {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-g9-'))
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => {
    store.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return store
}

function addMail(
  store: Store,
  folderId: string,
  key: string,
  uid: number,
  from: { name: string; email: string },
  to: { name: string; email: string }[] = []
): void {
  store.insertMessage({
    account_id: ACCOUNT,
    folder_id: folderId,
    uid,
    message_key: key,
    file_path: `${key}.eml`,
    message_id: `<${key}@example.test>`,
    in_reply_to: null,
    references_json: '[]',
    thread_id: null,
    date: '2026-01-01T09:00:00.000Z',
    internal_date: '2026-01-01T09:00:00.000Z',
    subject: key,
    from_name: from.name,
    from_email: from.email,
    to_json: JSON.stringify(to),
    cc_json: '[]',
    bcc_json: '[]',
    flags_json: '{"seen":true,"flagged":false,"draft":false,"deleted":false,"answered":false}',
    modseq: null,
    has_attachments: 0,
    attachments_json: '[]',
    size_bytes: 10,
    snippet: key,
    parsed_ok: 1,
    parse_error: null,
    body_text: key,
    body_html: `<p>${key}</p>`
  })
}

describe('G9: mail history teaches the compose lookup', () => {
  it('remembers the sender of a newly stored mail', () => {
    // the reported case: a real mail from IONOS in the inbox
    const store = openStore()
    const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/' })

    store.rememberContactsOf({
      from_email: 'no-reply@ionos.de',
      from_name: 'IONOS',
      to_json: '[]',
      cc_json: '[]'
    })

    const found = store.searchContacts('ionos')
    expect(found.map((c) => c.email)).toContain('no-reply@ionos.de')
    expect(found[0].name).toBe('IONOS')
    expect(inbox.id).toBeTruthy()
  })

  it('remembers the recipients too, not only the sender', () => {
    // the To/Cc are people the sender already considers relevant
    const store = openStore()
    store.rememberContactsOf({
      from_email: 'chef@example.test',
      from_name: 'Chef',
      to_json: JSON.stringify([{ name: 'Kollege', email: 'kollege@example.test' }]),
      cc_json: JSON.stringify([{ name: 'Cc Person', email: 'cc@example.test' }])
    })

    expect(store.searchContacts('kollege').map((c) => c.email)).toEqual(['kollege@example.test'])
    expect(store.searchContacts('cc@').map((c) => c.email)).toEqual(['cc@example.test'])
  })

  it('ignores an address that is not one', () => {
    // records with an empty or malformed address must not pollute the lookup
    const store = openStore()
    store.rememberContactsOf({ from_email: '', from_name: 'Niemand', to_json: '[]', cc_json: '[]' })
    store.rememberContactsOf({
      from_email: 'kein-at',
      from_name: 'Kaputt',
      to_json: '[]',
      cc_json: '[]'
    })
    expect(store.searchContacts('niemand')).toEqual([])
    expect(store.searchContacts('kaputt')).toEqual([])
  })

  it('backfills mail that was stored before this build, exactly once', () => {
    // A mailbox synced before G9 has rows but an empty contacts table; the one-time pass fills it.
    const store = openStore()
    const inbox = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/' })
    addMail(store, inbox.id, 'alt-1', 1, { name: 'IONOS Service', email: 'service@ionos.de' })

    // before: nothing is known
    expect(store.searchContacts('ionos')).toEqual([])

    store.backfillContactsOnce()
    expect(store.searchContacts('ionos').map((c) => c.email)).toEqual(['service@ionos.de'])

    // a second run does nothing: new mail teaches the table as it arrives
    expect(store.backfillContactsOnce()).toBe(0)
  })

  it('runs the backfill when the core opens the store', async () => {
    // The wiring, not the method: without this call in MailCore's constructor path, a mailbox synced
    // before G9 keeps an empty contacts table forever and "ionos" still finds nothing.
    const { createMailCore } = await import('../src/main/mailclient/core/index')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-g9wire-'))
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))

    // Seed a message the way an older build left it: a row, no contacts entry
    const seedDir = path.join(dir, ACCOUNT)
    fs.mkdirSync(seedDir, { recursive: true })
    const seed = new Store(seedDir, ACCOUNT)
    const inbox = seed.upsertFolder({ imapPath: 'INBOX', delimiter: '/' })
    addMail(seed, inbox.id, 'alt-2', 2, { name: 'IONOS Service', email: 'service@ionos.de' })
    expect(seed.searchContacts('ionos')).toEqual([])
    seed.close()

    const api = createMailCore({
      dataDir: dir,
      accounts: [
        {
          id: ACCOUNT,
          kind: 'sandbox',
          canary: true,
          readOnly: false,
          email: 'a@example.test',
          host: '127.0.0.1',
          port: 1,
          security: 'none',
          credentials: async () => ({ user: 'a@example.test', pass: 'x' })
        }
      ]
    })
    try {
      // The core opened the store and ran the one-time pass
      const found = await api.getContacts('ionos', ACCOUNT)
      expect(found.map((c) => c.email)).toContain('service@ionos.de')
    } finally {
      api.close()
    }
  }, 30_000)

  it('keeps a name that is already known when a later mail has none', () => {
    // a reply from a no-reply address must not blank an existing display name
    const store = openStore()
    store.upsertContact('service@ionos.de', 'IONOS Service')
    store.upsertContact('service@ionos.de', '')
    expect(store.searchContacts('ionos')[0].name).toBe('IONOS Service')
  })
})
