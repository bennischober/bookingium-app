// Migration runner test: drizzle-kit table rebuilds (DROP + rename) must not
// cascade-delete child rows. Migration 0004 rebuilds `invoice`; without the
// runner disabling foreign keys, every invoice_line_item row was lost.
import { describe, it, expect, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { schema } from '../src/main/db/schema'
import { useTestDb, type Db } from '../src/main/db/index'
import { runMigrations, setMigrationsFolder } from '../src/main/db/migrate'

const migrationsFolder = resolve(__dirname, '../src/main/db/migrations')
const workDir = mkdtempSync(join(tmpdir(), 'bookingum-migrations-'))

/** Copy of the migrations folder whose journal stops before `tag` */
function migrationsUpTo(tag: string): string {
  const folder = join(workDir, 'partial')
  cpSync(migrationsFolder, folder, { recursive: true })
  const journalPath = join(folder, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf-8'))
  const stop = journal.entries.findIndex((entry: { tag: string }) => entry.tag === tag)
  journal.entries = journal.entries.slice(0, stop)
  writeFileSync(journalPath, JSON.stringify(journal))
  return folder
}

afterAll(() => {
  setMigrationsFolder(null)
  rmSync(workDir, { recursive: true, force: true })
})

describe('runMigrations', () => {
  it('keeps invoice line items when 0004 rebuilds the invoice table', async () => {
    const sqlite = new Database(join(workDir, 'test.db'))
    const restore = useTestDb(drizzle(sqlite, { schema }) as Db, sqlite)
    try {
      // Database as it was before 0004, with an issued invoice + line items.
      // Raw SQL: today's services expect today's schema.
      setMigrationsFolder(migrationsUpTo('0004_invoice_number_on_issue'))
      runMigrations()
      sqlite.exec(`
        INSERT INTO company (id, name) VALUES (1, 'Old GmbH');
        INSERT INTO invoice (id, invoice_number, company_id, status) VALUES (1, 1001, 1, 'issued');
        INSERT INTO invoice_line_item (invoice_id, description) VALUES (1, 'A'), (1, 'B');
      `)
      const count = () =>
        (sqlite.prepare('select count(*) as n from invoice_line_item').get() as { n: number }).n
      expect(count()).toBe(2)

      setMigrationsFolder(migrationsFolder)
      runMigrations()

      expect(count()).toBe(2)
      const column = sqlite
        .prepare(
          "select \"notnull\" from pragma_table_info('invoice') where name = 'invoice_number'"
        )
        .get() as { notnull: number }
      expect(column.notnull).toBe(0)
      expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    } finally {
      restore()
      sqlite.close()
    }
  })

  it('turns event documents into owner documents (0009) and deletes them with the owner', () => {
    const sqlite = new Database(join(workDir, 'documents.db'))
    const restore = useTestDb(drizzle(sqlite, { schema }) as Db, sqlite)
    try {
      setMigrationsFolder(migrationsUpTo('0009_document_owner'))
      runMigrations()
      sqlite.exec(`
        INSERT INTO company (id, name) VALUES (1, 'Band GbR');
        INSERT INTO band (id, name, company_id) VALUES (1, 'Pretty Wild', 1);
        INSERT INTO deal_memo (id, name, date, band_id) VALUES (7, 'München', '2026-06-11', 1);
        INSERT INTO document (deal_memo_id, file_name, file_type, file_path, file_size)
          VALUES (7, 'vertrag.pdf', 'application/pdf', 'events/7/vertrag.pdf', 10);
      `)

      setMigrationsFolder(migrationsFolder)
      runMigrations()

      expect(sqlite.prepare('select owner_type, owner_id, file_path from document').all()).toEqual([
        { owner_type: 'event', owner_id: 7, file_path: 'events/7/vertrag.pdf' }
      ])
      sqlite.exec('DELETE FROM deal_memo WHERE id = 7')
      expect(sqlite.prepare('select count(*) as n from document').get()).toEqual({ n: 0 })
    } finally {
      restore()
      sqlite.close()
    }
  })
})
