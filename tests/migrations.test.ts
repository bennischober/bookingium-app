// Migration runner: fresh databases get all migrations (the merged initial one first);
// databases from before the merge (history ending at the old 0010) are
// taken over as they are, with the band table repaired once.
import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { resolve } from 'path'
import { schema } from '../src/main/db/schema'
// Not a React hook (just named use…)
import { useTestDb as swapInTestDb, type Db } from '../src/main/db/index'
import {
  LEGACY_FINAL_MIGRATION_MILLIS,
  runMigrations,
  setMigrationsFolder
} from '../src/main/db/migrate'

const migrationsFolder = resolve(__dirname, '../src/main/db/migrations')
const migrations = readMigrationFiles({ migrationsFolder })
const [initial] = migrations

let restore: (() => void) | null = null

function openDb(): Database.Database {
  const sqlite = new Database(':memory:')
  restore = swapInTestDb(drizzle(sqlite, { schema }) as Db, sqlite)
  setMigrationsFolder(migrationsFolder)
  return sqlite
}

/**
 * Applies migrations by hand as runMigrations does: foreign keys off, each migration in a
 * transaction, where the generated `PRAGMA foreign_keys=ON` between rebuilds is a no-op
 */
function apply(sqlite: Database.Database, list: typeof migrations) {
  sqlite.pragma('foreign_keys = OFF')
  for (const { sql } of list) sqlite.transaction(() => sql.forEach((s) => sqlite.exec(s)))()
}

afterEach(() => {
  setMigrationsFolder(null)
  restore?.()
  restore = null
})

/**
 * A database as it was before the merge: the same tables, history ending
 * at the old 0010 migration
 */
function legacyDb(lastMillis = LEGACY_FINAL_MIGRATION_MILLIS): Database.Database {
  const sqlite = openDb()
  sqlite.pragma('foreign_keys = OFF')
  for (const sql of initial.sql) sqlite.exec(sql)
  sqlite.exec(
    'CREATE TABLE __drizzle_migrations (id integer PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)'
  )
  sqlite
    .prepare('insert into __drizzle_migrations (hash, created_at) values (?, ?)')
    .run('legacy', lastMillis)
  sqlite.exec(`
    INSERT INTO company (id, name) VALUES (1, 'Band GbR');
    INSERT INTO person (id, first_name, last_name) VALUES (1, 'Tom', 'Technik');
    INSERT INTO band (id, name, company_id, responsible_person_id) VALUES (1, 'Pretty Wild', 1, 1);
    INSERT INTO document (owner_type, owner_id, file_name, file_type, file_path, file_size)
      VALUES ('band', 1, 'rider.pdf', 'application/pdf', 'documents/bands/1-pretty-wild/rider.pdf', 1);
  `)
  sqlite.pragma('foreign_keys = ON')
  return sqlite
}

describe('runMigrations', () => {
  it('applies all migrations to a new database', () => {
    const sqlite = openDb()
    runMigrations()
    expect(sqlite.prepare('select hash from __drizzle_migrations').all()).toEqual(
      migrations.map(({ hash }) => ({ hash }))
    )
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('starts the email history with the email each invoice remembered', () => {
    const sqlite = openDb()
    const emails = migrations.findIndex(({ sql }) =>
      sql.some((statement) => statement.includes('CREATE TABLE `invoice_email`'))
    )
    apply(sqlite, migrations.slice(0, emails))
    sqlite.exec(`
      insert into company (id, name) values (1, 'Issuer GmbH');
      insert into invoice (id, company_id, emailed_at, emailed_to)
        values (1, 1, '2026-10-19 08:30:00', 'x@club.example.test'), (2, 1, null, '');
    `)
    apply(sqlite, [migrations[emails]])

    expect(sqlite.prepare('select invoice_id, "to", created_at from invoice_email').all()).toEqual([
      { invoice_id: 1, to: 'x@club.example.test', created_at: '2026-10-19 08:30:00' }
    ])
    // Emails from before the reminders were the invoice's own
    apply(sqlite, migrations.slice(emails + 1))
    expect(sqlite.prepare('select kind from invoice_email').all()).toEqual([{ kind: 'invoice' }])
  })

  it('starts the Verlauf with the issue date and the status each invoice has', () => {
    const sqlite = openDb()
    const changes = migrations.findIndex(({ sql }) =>
      sql.some((statement) => statement.includes('CREATE TABLE `invoice_status_change`'))
    )
    apply(sqlite, migrations.slice(0, changes))
    sqlite.exec(`
      insert into company (id, name) values (1, 'Issuer GmbH');
      insert into invoice (id, company_id, status, issue_date, created_at, updated_at) values
        (1, 1, 'draft', '2026-10-01', '2026-10-01 08:00:00', null),
        (2, 1, 'issued', '2026-10-02', '2026-10-01 08:00:00', '2026-10-02 09:00:00'),
        (3, 1, 'paid', '2026-10-03', '2026-10-01 08:00:00', '2026-10-20 10:00:00'),
        (4, 1, 'cancelled', '2026-10-04', '2026-10-04 08:00:00', null);
    `)
    apply(sqlite, [migrations[changes]])

    expect(
      sqlite
        .prepare(
          'select invoice_id, status, created_at from invoice_status_change order by invoice_id, id'
        )
        .all()
    ).toEqual([
      { invoice_id: 2, status: 'issued', created_at: '2026-10-02' },
      { invoice_id: 3, status: 'issued', created_at: '2026-10-03' },
      { invoice_id: 3, status: 'paid', created_at: '2026-10-20 10:00:00' },
      { invoice_id: 4, status: 'issued', created_at: '2026-10-04' },
      { invoice_id: 4, status: 'cancelled', created_at: '2026-10-04 08:00:00' }
    ])
  })

  it('deletes the addresses and contacts no record uses any more', () => {
    const sqlite = openDb()
    const cleanup = migrations.findIndex(({ sql }) =>
      sql.some((statement) => statement.includes('#149'))
    )
    apply(sqlite, migrations.slice(0, cleanup))
    sqlite.exec(`
      insert into address (id, city) values (1, 'Verwaist'), (2, 'Person'), (3, 'Geteilt');
      insert into contact (id, email) values
        (1, 'weg@example.test'), (2, 'person@example.test'), (3, 'hotel@example.test');
      insert into contact_email (contact_id, email, position) values
        (1, 'weg2@example.test', 0), (2, 'person2@example.test', 0);
      insert into person (id, first_name, last_name, address_id, contact_id)
        values (1, 'Erika', 'Musterfrau', 2, 2);
      insert into venue (id, name, address_id) values (1, 'Musterhalle', 3);
      insert into hotel (id, name, address_id, contact_id) values (1, 'Hotel Muster', 3, 3);
    `)
    apply(sqlite, [migrations[cleanup]])

    expect(sqlite.prepare('select id from address order by id').all()).toEqual([
      { id: 2 },
      { id: 3 }
    ])
    expect(sqlite.prepare('select id from contact order by id').all()).toEqual([
      { id: 2 },
      { id: 3 }
    ])
    expect(sqlite.prepare('select contact_id from contact_email').all()).toEqual([
      { contact_id: 2 }
    ])
  })

  it('turns the stored euro amounts into exact cents', () => {
    const sqlite = openDb()
    const copy = migrations.findIndex(({ sql }) =>
      sql.some((statement) => statement.includes('`total_gross_cents` = CAST'))
    )
    apply(sqlite, migrations.slice(0, copy))
    sqlite.exec(`
      insert into company (id, name) values (1, 'Issuer GmbH');
      insert into band (id, name, company_id) values (1, 'Musterband', 1);
      insert into deal_memo (id, name, date, band_id, ticket_price_vvk, ticket_price_ak, guarantee_amount)
        values (1, 'Konzert', '2026-11-01', 1, 1.005, null, 4999.99);
      insert into deal_memo_deposit (deal_memo_id, position, amount) values (1, 1, 0.1 + 0.2);
      insert into invoice (id, company_id, subtotal_net_amount, subtotal_tax_amount, total_gross_amount, total_amount)
        values (1, 1, 3529.41, 670.59, 4200, 4200), (2, 1, -3529.41, -670.59, -4200, -4200);
      insert into invoice_line_item (invoice_id, description, line_net_amount, line_tax_amount, line_gross_amount)
        values (2, 'Storno', -529.41, -100.59, -630);
    `)
    apply(sqlite, [migrations[copy]])
    apply(sqlite, migrations.slice(copy + 1))

    expect(
      sqlite
        .prepare(
          'select ticket_price_vvk_cents, ticket_price_ak_cents, guarantee_cents from deal_memo'
        )
        .get()
    ).toEqual({ ticket_price_vvk_cents: 101, ticket_price_ak_cents: null, guarantee_cents: 499999 })
    expect(sqlite.prepare('select amount_cents from deal_memo_deposit').get()).toEqual({
      amount_cents: 30
    })
    expect(
      sqlite
        .prepare(
          'select subtotal_net_cents, subtotal_tax_cents, total_gross_cents from invoice order by id'
        )
        .all()
    ).toEqual([
      { subtotal_net_cents: 352941, subtotal_tax_cents: 67059, total_gross_cents: 420000 },
      { subtotal_net_cents: -352941, subtotal_tax_cents: -67059, total_gross_cents: -420000 }
    ])
    expect(
      sqlite
        .prepare('select line_net_cents, line_tax_cents, line_gross_cents from invoice_line_item')
        .get()
    ).toEqual({ line_net_cents: -52941, line_tax_cents: -10059, line_gross_cents: -63000 })
    // Integers, not floats that happen to look whole
    expect(
      sqlite.prepare('select typeof(total_gross_cents) as t from invoice limit 1').get()
    ).toEqual({ t: 'integer' })
  })

  it('repairs the rows the CHECK constraints would refuse', () => {
    const sqlite = openDb()
    const cleanup = migrations.findIndex(({ sql }) =>
      sql.some((statement) => statement.includes("UPDATE `deal_memo` SET `status` = 'pending'"))
    )
    apply(sqlite, migrations.slice(0, cleanup))
    sqlite.exec(`
      insert into company (id, name, kind, is_default_for_invoicing) values
        (1, 'A', 'company', 0), (2, 'B', 'company', 1), (3, 'C', '', 1);
      insert into band (id, name, company_id) values (1, 'Musterband', 1);
      insert into deal_memo (id, name, date, band_id, status) values
        (1, 'Ohne Status', '2026-11-01', 1, ''), (2, 'Bestätigt', '2026-11-02', 1, 'confirmed');
      insert into person (id, first_name, last_name) values (1, 'Erika', 'Musterfrau');
      insert into venue (id, name, kind) values (1, 'Musterhalle', 'venue');
      insert into venue_member (id, venue_id, person_id, role) values
        (1, 1, 1, 'Booking'), (2, 1, 1, 'Doppelt');
    `)
    apply(sqlite, migrations.slice(cleanup))

    expect(sqlite.prepare('select id, status from deal_memo order by id').all()).toEqual([
      { id: 1, status: 'pending' },
      { id: 2, status: 'confirmed' }
    ])
    expect(
      sqlite
        .prepare('select id, kind, is_default_for_invoicing as d from company order by id')
        .all()
    ).toEqual([
      { id: 1, kind: 'company', d: 0 },
      { id: 2, kind: 'company', d: 1 },
      { id: 3, kind: 'company', d: 0 }
    ])
    expect(sqlite.prepare('select id, role from venue_member').all()).toEqual([
      { id: 1, role: 'Booking' }
    ])
  })

  it('turns the genre strings into genre rows, one per spelling', () => {
    const sqlite = openDb()
    const copy = migrations.findIndex(({ sql }) =>
      sql.some((statement) => statement.includes('CREATE TABLE `__genre_tag`'))
    )
    apply(sqlite, migrations.slice(0, copy))
    sqlite.exec(`
      insert into company (id, name, genres) values (1, 'Label', ''), (2, 'Radio', ' metal ;Doom,, ');
      insert into band (id, name, company_id, genre) values (1, 'Musterband', 1, 'Metal; Rock');
      insert into venue (id, name, genres) values (1, 'Halle', 'Rock, punk'), (2, 'Leer', '');
    `)
    apply(sqlite, migrations.slice(copy))

    // Venues first, then companies, then bands: a name keeps its first spelling
    expect(sqlite.prepare('select id, name from genre order by id').all()).toEqual([
      { id: 1, name: 'Rock' },
      { id: 2, name: 'punk' },
      { id: 3, name: 'metal' },
      { id: 4, name: 'Doom' }
    ])
    const tags = (table: string, owner: string) =>
      sqlite
        .prepare(
          `select l.${owner} as id, group_concat(g.name, ', ' order by l.position) as tags
           from ${table} l join genre g on g.id = l.genre_id group by l.${owner} order by 1`
        )
        .all()
    expect(tags('venue_genre', 'venue_id')).toEqual([{ id: 1, tags: 'Rock, punk' }])
    expect(tags('company_genre', 'company_id')).toEqual([{ id: 2, tags: 'metal, Doom' }])
    expect(tags('band_genre', 'band_id')).toEqual([{ id: 1, tags: 'metal, Rock' }])
    expect(
      sqlite.prepare("select count(*) as n from sqlite_master where name = '__genre_tag'").get()
    ).toEqual({ n: 0 })
    const columns = (table: string) =>
      (sqlite.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map(
        ({ name }) => name
      )
    expect(columns('venue')).not.toContain('genres')
    expect(columns('company')).not.toContain('genres')
    expect(columns('band')).not.toContain('genre')
  })

  it('keeps one VAT id, a set updated_at and one timestamp format', () => {
    const sqlite = openDb()
    const copy = migrations.findIndex(({ sql }) =>
      sql.some((statement) => statement.includes('CREATE TABLE `__vat`'))
    )
    apply(sqlite, migrations.slice(0, copy))
    sqlite.exec(`
      insert into company (id, name, notes, vat_number, ust_number, tax_number, created_at) values
        (1, 'Beide', null, 'DE 123 456 789', '12/345/67890', '', '2026-01-02 03:04:05'),
        (2, 'Nur USt', 'Alt', '', 'ATU12345678', '', '2026-01-02T03:04:05.678Z'),
        (3, 'Zwei IDs', '', 'DE111111111', 'DE222222222', '', '2026-01-02'),
        (4, 'Volle Steuer', null, '', '99/999/99999', '11/111/11111', '2026-01-02 03:04:05');
      insert into invoice_party_snapshot (id, kind, legal_name, vat_number, ust_number) values
        (1, 'company', 'Beleg', '', '27/123/45678');
      insert into person (id, first_name, last_name, created_at, updated_at) values
        (1, 'Erika', 'Muster', '2026-03-04T05:06:07Z', null);
    `)
    apply(sqlite, migrations.slice(copy))

    // The first VAT id wins; a tax number fills an empty tax_number, the rest the notes
    const day = '2026-01-02 03:04:05'
    expect(
      sqlite
        .prepare('select id, vat_id, tax_number, notes, created_at, updated_at from company')
        .all()
    ).toEqual([
      {
        id: 1,
        vat_id: 'DE 123 456 789',
        tax_number: '12/345/67890',
        notes: null,
        created_at: day,
        updated_at: day
      },
      {
        id: 2,
        vat_id: 'ATU12345678',
        tax_number: '',
        notes: 'Alt',
        created_at: day,
        updated_at: day
      },
      {
        id: 3,
        vat_id: 'DE111111111',
        tax_number: '',
        notes: 'USt-Nr. (alt): DE222222222',
        created_at: '2026-01-02 00:00:00',
        updated_at: '2026-01-02 00:00:00'
      },
      {
        id: 4,
        vat_id: '',
        tax_number: '11/111/11111',
        notes: 'USt-Nr. (alt): 99/999/99999',
        created_at: day,
        updated_at: day
      }
    ])
    expect(sqlite.prepare('select vat_id, tax_number from invoice_party_snapshot').get()).toEqual({
      vat_id: '',
      tax_number: '27/123/45678'
    })
    expect(sqlite.prepare('select created_at, updated_at from person').get()).toEqual({
      created_at: '2026-03-04 05:06:07',
      updated_at: '2026-03-04 05:06:07'
    })
    const info = (table: string) =>
      sqlite.prepare(`pragma table_info(${table})`).all() as { name: string; notnull: number }[]
    for (const table of ['company', 'invoice_party_snapshot']) {
      expect(info(table).map(({ name }) => name)).not.toContain('vat_number')
      expect(info(table).map(({ name }) => name)).not.toContain('ust_number')
    }
    // updated_at is NOT NULL wherever a table has it
    const tables = sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like '\\_\\_%' escape '\\'"
      )
      .all() as { name: string }[]
    const nullable = tables.filter(({ name }) =>
      info(name).some((column) => column.name === 'updated_at' && !column.notnull)
    )
    expect(nullable).toEqual([])
  })

  it('keeps every trigger through the table rebuilds', () => {
    // A drizzle-kit rebuild (CREATE __new_x, DROP x, RENAME) drops x's triggers, so a
    // migration that rebuilds one of these tables has to create them again
    const sqlite = openDb()
    runMigrations()
    expect(
      sqlite
        .prepare("select name, tbl_name from sqlite_master where type = 'trigger' order by name")
        .all()
    ).toEqual([
      { name: 'document_owner_band_deleted', tbl_name: 'band' },
      { name: 'document_owner_company_deleted', tbl_name: 'company' },
      { name: 'document_owner_event_deleted', tbl_name: 'deal_memo' },
      { name: 'document_owner_person_deleted', tbl_name: 'person' },
      { name: 'document_owner_venue_deleted', tbl_name: 'venue' },
      { name: 'mail_link_band_deleted', tbl_name: 'band' },
      { name: 'mail_link_company_deleted', tbl_name: 'company' },
      { name: 'mail_link_contract_deleted', tbl_name: 'management_contract' },
      { name: 'mail_link_event_deleted', tbl_name: 'deal_memo' },
      { name: 'mail_link_invoice_deleted', tbl_name: 'invoice' },
      { name: 'mail_link_person_deleted', tbl_name: 'person' },
      { name: 'mail_link_venue_deleted', tbl_name: 'venue' }
    ])
  })

  it('takes over a database from before the merge, keeping its data', () => {
    const sqlite = legacyDb()
    runMigrations()
    runMigrations()

    expect(sqlite.prepare('select count(*) as n from __drizzle_migrations').get()).toEqual({
      n: migrations.length + 1
    })
    expect(sqlite.prepare('select name, responsible_person_id from band').all()).toEqual([
      { name: 'Pretty Wild', responsible_person_id: 1 }
    ])
    // Band rebuilt with its trigger: deleting it removes its documents
    sqlite.exec('DELETE FROM band WHERE id = 1')
    expect(sqlite.prepare('select count(*) as n from document').get()).toEqual({ n: 0 })
  })

  it('refuses databases from an even older pre-release', () => {
    legacyDb(LEGACY_FINAL_MIGRATION_MILLIS - 1)
    expect(() => runMigrations()).toThrow('älteren Vorabversion')
  })
})
