// Migration runner test: drizzle-kit table rebuilds (DROP + rename) must not
// cascade-delete child rows. Migration 0004 rebuilds `invoice`; without the
// runner disabling foreign keys, every invoice_line_item row was lost.
import 'reflect-metadata'
import { describe, it, expect, afterAll } from 'vitest'
import { container } from 'tsyringe'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { schema } from '../src/main/db/schema'
import { useTestDb, type Db } from '../src/main/db/index'
import { runMigrations, setMigrationsFolder } from '../src/main/db/migrate'
import { CompanyService } from '../src/main/services/CompanyService'
import { InvoiceService } from '../src/main/services/InvoiceService'

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
      // Database as it was before 0004, with an issued invoice + line items
      setMigrationsFolder(migrationsUpTo('0004_invoice_number_on_issue'))
      runMigrations()
      const company = await container.resolve(CompanyService).createCompany({ name: 'Old GmbH' })
      await container.resolve(InvoiceService).createInvoice({
        companyId: company.id,
        status: 'issued',
        lineItems: [
          { description: 'A', quantity: 1, unitPriceNet: 10, taxRate: 0, taxCode: 'other' },
          { description: 'B', quantity: 2, unitPriceNet: 5, taxRate: 0, taxCode: 'other' }
        ]
      })
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
})
