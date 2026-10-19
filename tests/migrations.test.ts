// Migration runner: fresh databases get the merged initial migration;
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
const [initial] = readMigrationFiles({ migrationsFolder })

let restore: (() => void) | null = null

function openDb(): Database.Database {
  const sqlite = new Database(':memory:')
  restore = swapInTestDb(drizzle(sqlite, { schema }) as Db, sqlite)
  setMigrationsFolder(migrationsFolder)
  return sqlite
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
  it('applies the initial migration to a new database', () => {
    const sqlite = openDb()
    runMigrations()
    expect(sqlite.prepare('select hash from __drizzle_migrations').all()).toEqual([
      { hash: initial.hash }
    ])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('takes over a database from before the merge, keeping its data', () => {
    const sqlite = legacyDb()
    runMigrations()
    runMigrations()

    expect(sqlite.prepare('select count(*) as n from __drizzle_migrations').get()).toEqual({ n: 2 })
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
