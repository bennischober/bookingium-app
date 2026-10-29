// Updates after 1.0.0: the migration history is frozen at the release (#91), a database from a
// newer version is refused (#93), and the database is copied before pending migrations (#92).
import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { schema } from '../src/main/db/schema'
// Not a React hook (just named use…)
import { useTestDb as swapInTestDb, type Db } from '../src/main/db/index'
import { runMigrations, setMigrationsFolder } from '../src/main/db/migrate'
import {
  BEFORE_UPDATE_KEEP,
  beforeUpdateFolder,
  copyBeforeUpdate,
  pruneBeforeUpdate,
  readLastVersion,
  writeLastVersion
} from '../src/main/backup/beforeUpdate'
import journal from '../src/main/db/migrations/meta/_journal.json'

const migrationsFolder = resolve(__dirname, '../src/main/db/migrations')
const migrations = readMigrationFiles({ migrationsFolder })

/**
 * The migrations every 1.0.0 installation has run: tag, created-at and the hash of the SQL.
 * Never change this list. A schema change after 1.0.0 is a new migration at the end.
 */
const RELEASE_1_0_0: readonly [string, number, string][] = [
  [
    '0000_initial',
    1792418283677,
    'a56343ecfadde7e8a2df58fd554ca9f62020d67d98fbfc251dc73e749f69c78e'
  ],
  [
    '0001_e_invoice',
    1792438446269,
    'a074f8f1add81b600fd5134917bbd6790ae703736c905c32066dea4ef179dd00'
  ],
  [
    '0002_xrechnung_storno',
    1792480496452,
    '4b931e1090a3fe3e17051cdddcb3476bccc3cedf334b0d15e116b3b729412fa2'
  ],
  [
    '0003_invoice_email',
    1792498955641,
    '35e198d5297fbabca12d079a222f6c6b7f73da29a4383c8d3afa55c2b317696f'
  ],
  [
    '0004_contact_lists',
    1792516603270,
    '2c2ed3320f82d1458a7aaca6b2f52bdb95728f1bf53cdc9c10e8e0673d9f2bff'
  ],
  [
    '0005_follow_ups',
    1792521290078,
    '1fd36849d09438d2736b3fab4b16624200df1cc14405a4cf060e9974915d4f7d'
  ],
  [
    '0006_follow_up_invoices',
    1792522426031,
    'acc5e4f49758b03ff54e2c408a864fb6c961c4e091528a5f619a7e6cef8107e4'
  ],
  [
    '0007_invoice_emails',
    1792566986728,
    'da4b2569384e68fa2340fcd0a3837f3ee60e577f1f71d9b74816ab5ada9e9977'
  ],
  [
    '0008_invoice_status_changes',
    1792567883422,
    '4ee89bb36a0dc66398ab3766f6215c9e593c446fd8e1f9c0898a042e3f35301c'
  ],
  [
    '0009_invoice_email_kind',
    1792569341077,
    'b2a432b32e8da9abbdf86ad9dc8f919471e1f3658cc44de0d518fdbafcb8b50e'
  ],
  [
    '0010_mail_link',
    1792859324223,
    'beec0ffe490bf401ef22ff4dfddae2e89a0e66ee12ee4435eb774629b5fe7e91'
  ],
  [
    '0011_mail_link_index_triggers',
    1792859325223,
    '72f8c3a4ee9bd96ed7900e7e5456a4fd824476c59165cbf01cdf8e6d80655623'
  ],
  [
    '0012_invoice_email_message_id',
    1792859326223,
    'f13fa29c19e022fe8d0b48c66c33d9d511317be90f4f3a02579b265dbab7e0bd'
  ],
  [
    '0013_document_mail_origin',
    1792859327223,
    'd53446c27d0873987403e2ceabdf9c8e339ac303da8fca34a68c30645a902657'
  ],
  [
    '0014_document_mail_account',
    1792859328223,
    '29d72bacc172e6bb5fc46e60d509682f01355a357d849d4cac659bf5a4e2f5d2'
  ],
  [
    '0015_next_rocket_raccoon',
    1792935277654,
    '81ffb392c93525431e4118f3479b4c3df33f68457aba62b18d78e1c92f74ffe4'
  ],
  [
    '0016_invoice_email_pending',
    1793052023050,
    '86eaec679ff84a6e8960c96937834729a7f1c0f0cce8233bc5627b8d4ad34834'
  ],
  [
    '0017_contact_email',
    1793126345409,
    '5bb69c0d16bd0cf84cf473e08d23c2763434dfee505bf2d3e56caaa802f7f148'
  ]
]

let restore: (() => void) | null = null
const cleanups: (() => void)[] = []

afterEach(() => {
  setMigrationsFolder(null)
  restore?.()
  restore = null
  while (cleanups.length) cleanups.pop()!()
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bookingum-upgrade-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function openDb(file = ':memory:'): Database.Database {
  const sqlite = new Database(file)
  cleanups.push(() => sqlite.close())
  restore = swapInTestDb(drizzle(sqlite, { schema }) as Db, sqlite)
  setMigrationsFolder(migrationsFolder)
  return sqlite
}

/** A database as the first `count` migrations left it, recorded the way drizzle records them */
function databaseAt(count: number, file?: string): Database.Database {
  const sqlite = openDb(file)
  sqlite.exec(
    'CREATE TABLE __drizzle_migrations (id integer PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)'
  )
  const record = sqlite.prepare('insert into __drizzle_migrations (hash, created_at) values (?, ?)')
  for (const migration of migrations.slice(0, count)) {
    for (const statement of migration.sql) sqlite.exec(statement)
    record.run(migration.hash, migration.folderMillis)
  }
  return sqlite
}

function withRows(sqlite: Database.Database): Database.Database {
  sqlite.exec(`
    INSERT INTO company (id, name) VALUES (1, 'Band GbR');
    INSERT INTO person (id, first_name, last_name) VALUES (1, 'Tom', 'Technik');
    INSERT INTO band (id, name, company_id, responsible_person_id) VALUES (1, 'Pretty Wild', 1, 1);
    INSERT INTO venue (id, name) VALUES (1, 'Club Beispiel');
    INSERT INTO invoice (id, company_id) VALUES (1, 1);
    INSERT INTO document (owner_type, owner_id, file_name, file_type, file_path, file_size)
      VALUES ('band', 1, 'rider.pdf', 'application/pdf', 'documents/bands/1-pretty-wild/rider.pdf', 1);
    INSERT INTO app_setting (key, value) VALUES ('theme', '"dark"');
  `)
  return sqlite
}

function rowCounts(sqlite: Database.Database): Record<string, number> {
  const tables = sqlite
    .prepare(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name != '__drizzle_migrations' order by name"
    )
    .all() as { name: string }[]
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      (sqlite.prepare(`select count(*) as n from \`${name}\``).get() as { n: number }).n
    ])
  )
}

describe('the migration history of 1.0.0', () => {
  it('is never edited, only extended', () => {
    const shipped = migrations
      .slice(0, RELEASE_1_0_0.length)
      .map((migration, index) => [
        journal.entries[index].tag,
        migration.folderMillis,
        migration.hash
      ])
    expect(shipped).toEqual(RELEASE_1_0_0)
  })

  it('upgrades a 1.0.0 database to the current schema with every row kept', () => {
    const sqlite = withRows(databaseAt(RELEASE_1_0_0.length))
    const before = rowCounts(sqlite)

    runMigrations()

    const after = rowCounts(sqlite)
    for (const [table, count] of Object.entries(before)) expect(after[table], table).toBe(count)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
    expect(sqlite.prepare('select hash from __drizzle_migrations order by id').all()).toEqual(
      migrations.map(({ hash }) => ({ hash }))
    )
    expect(sqlite.prepare('select name, responsible_person_id from band').all()).toEqual([
      { name: 'Pretty Wild', responsible_person_id: 1 }
    ])
  })
})

describe('a database from a newer version', () => {
  it('is refused and left as it is', () => {
    const sqlite = withRows(databaseAt(migrations.length))
    const latest = Math.max(...migrations.map((m) => m.folderMillis))
    sqlite
      .prepare('insert into __drizzle_migrations (hash, created_at) values (?, ?)')
      .run('from-the-future', latest + 1)
    let copied = false

    expect(() =>
      runMigrations({
        beforeApply: () => {
          copied = true
        }
      })
    ).toThrow('neueren Version von Bookingium')
    expect(copied).toBe(false)
    expect(sqlite.prepare('select count(*) as n from __drizzle_migrations').get()).toEqual({
      n: migrations.length + 1
    })
  })
})

describe('before pending migrations', () => {
  it('asks for a copy only when an existing database has some', () => {
    const calls: number[] = []
    const beforeApply = (pending: number) => calls.push(pending)

    openDb()
    runMigrations({ beforeApply }) // fresh database: nothing to keep
    runMigrations({ beforeApply }) // up to date
    expect(calls).toEqual([])

    databaseAt(migrations.length - 1)
    runMigrations({ beforeApply })
    expect(calls).toEqual([1])
  })

  it('does not migrate when the copy fails', () => {
    const sqlite = databaseAt(migrations.length - 1)
    expect(() =>
      runMigrations({
        beforeApply: () => {
          throw new Error('Datenträger voll')
        }
      })
    ).toThrow('Datenträger voll')
    expect(sqlite.prepare('select count(*) as n from __drizzle_migrations').get()).toEqual({
      n: migrations.length - 1
    })
  })

  it('copies the database, named after the version that last opened it', () => {
    const dir = tempDir()
    const workDir = join(dir, 'backup')
    const sqlite = withRows(databaseAt(migrations.length - 1, join(dir, 'bookingum.db')))
    sqlite.pragma('journal_mode = WAL')
    expect(readLastVersion(workDir)).toBeNull()
    writeLastVersion(workDir, '1.0.0')

    let copy = ''
    runMigrations({
      beforeApply: () => {
        copy = copyBeforeUpdate({
          sqlite,
          workDir,
          fromVersion: readLastVersion(workDir),
          now: new Date('2027-01-15T10:20:30Z')
        })
      }
    })

    expect(copy).toBe(join(beforeUpdateFolder(workDir), '1.0.0_2027-01-15T10-20-30.db'))
    const copied = new Database(copy, { readonly: true })
    cleanups.push(() => copied.close())
    expect(copied.prepare('select count(*) as n from __drizzle_migrations').get()).toEqual({
      n: migrations.length - 1
    })
    expect(copied.prepare('select name from band').all()).toEqual([{ name: 'Pretty Wild' }])
  })

  it('names a copy without a recorded version "unbekannt"', () => {
    const dir = tempDir()
    const sqlite = openDb(join(dir, 'bookingum.db'))
    const copy = copyBeforeUpdate({
      sqlite,
      workDir: dir,
      fromVersion: null,
      now: new Date('2027-01-15T10:20:30Z')
    })
    expect(copy.endsWith('unbekannt_2027-01-15T10-20-30.db')).toBe(true)
  })

  it('keeps only the newest copies and nothing else is touched', () => {
    const workDir = tempDir()
    const folder = beforeUpdateFolder(workDir)
    writeLastVersion(workDir, '1.0.2')
    const names = [
      '1.0.0_2027-01-01T08-00-00.db',
      '1.0.1_2027-02-01T08-00-00.db',
      'unbekannt_2026-12-01T08-00-00.db',
      '1.0.2_2027-03-01T08-00-00.db',
      '1.1.0_2027-04-01T08-00-00.db',
      'notizen.txt'
    ]
    for (const name of names) writeFileSync(join(folder, name), '')

    expect(pruneBeforeUpdate(workDir).sort()).toEqual([
      '1.0.0_2027-01-01T08-00-00.db',
      'unbekannt_2026-12-01T08-00-00.db'
    ])
    expect(readdirSync(folder).filter((name) => name.endsWith('.db'))).toHaveLength(
      BEFORE_UPDATE_KEEP
    )
    expect(readdirSync(folder)).toContain('notizen.txt')
    expect(readLastVersion(workDir)).toBe('1.0.2')
  })
})
