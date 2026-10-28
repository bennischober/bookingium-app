import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import type Database from 'better-sqlite3'
import { getDb, getSqlite } from './index'
import { join } from 'path'

let migrationsFolderOverride: string | null = null

/** Tests can point the migrator at a specific migrations folder. */
export function setMigrationsFolder(folder: string | null): void {
  migrationsFolderOverride = folder
}

/**
 * Created-at of the last migration before the migrations were merged into
 * 0000_initial (old 0010_app_settings). Databases from before the merge
 * end exactly there.
 */
export const LEGACY_FINAL_MIGRATION_MILLIS = 1792403956167

function resolveMigrationsFolder(): string {
  if (migrationsFolderOverride) return migrationsFolderOverride

  const candidates: string[] = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    if (app.isPackaged) {
      // Production: migrations are copied to resources folder
      candidates.push(join(process.resourcesPath, 'migrations'))
    } else {
      candidates.push(join(app.getAppPath(), 'src/main/db/migrations'))
      // Built main bundle lives in out/main: independent of the working
      // directory the app was started from
      candidates.push(join(__dirname, '../../src/main/db/migrations'))
    }
  } catch {
    // Outside the electron runtime (tests/tooling)
  }
  // Fallbacks: repo root from cwd, and cwd itself (covers alternate app
  // path resolution, e.g. when launched by test runners)
  candidates.push(join(process.cwd(), 'src/main/db/migrations'))
  candidates.push(join(process.cwd(), 'migrations'))

  return (
    candidates.find((folder) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { existsSync } = require('fs')
        return existsSync(join(folder, 'meta/_journal.json'))
      } catch {
        return false
      }
    }) ?? candidates[0]
  )
}

/**
 * Databases created before the migrations were merged have the old history
 * (0000–0010) and the same tables. They get 0000_initial recorded as
 * applied instead of running it, after one repair the old migrations
 * missed: band.responsible_person_id lost ON DELETE SET NULL in an
 * ADD COLUMN migration, so the band table is rebuilt from the initial
 * definition. Runs with foreign keys off (see runMigrations).
 */
export function upgradeLegacyDatabase(sqlite: Database.Database, migrationsFolder: string): void {
  const hasHistory = sqlite
    .prepare("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'")
    .get()
  if (!hasHistory) return
  const { last } = sqlite
    .prepare('select max(created_at) as last from __drizzle_migrations')
    .get() as { last: number | string | null }
  if (last === null) return

  const [initial] = readMigrationFiles({ migrationsFolder })
  const lastMillis = Number(last)
  if (lastMillis >= initial.folderMillis) return // already on the merged history
  if (lastMillis !== LEGACY_FINAL_MIGRATION_MILLIS) {
    throw new Error(
      'Die Datenbank stammt aus einer älteren Vorabversion von Bookingium und kann nicht ' +
        'automatisch übernommen werden. Bitte zuerst die Version vor dem Zusammenführen der ' +
        'Migrationen einmal starten.'
    )
  }

  const statement = (pattern: RegExp): string => {
    const found = initial.sql.find((sql) => pattern.test(sql))
    if (!found) throw new Error(`Initial migration lacks ${pattern}`)
    return found
  }

  sqlite.transaction(() => {
    const columns = (sqlite.pragma("table_info('band')") as Array<{ name: string }>)
      .map((column) => `\`${column.name}\``)
      .join(', ')
    sqlite.exec(
      statement(/CREATE TABLE `band`/).replace('CREATE TABLE `band`', 'CREATE TABLE `__new_band`')
    )
    sqlite.exec(`INSERT INTO \`__new_band\` (${columns}) SELECT ${columns} FROM \`band\``)
    sqlite.exec('DROP TABLE `band`')
    sqlite.exec('ALTER TABLE `__new_band` RENAME TO `band`')
    for (const sql of initial.sql.filter((sql) =>
      /CREATE (UNIQUE )?INDEX .* ON `band`/.test(sql)
    )) {
      sqlite.exec(sql)
    }
    // Dropping the table dropped its trigger too
    sqlite.exec(statement(/CREATE TRIGGER `document_owner_band_deleted`/))

    sqlite
      .prepare('insert into __drizzle_migrations (hash, created_at) values (?, ?)')
      .run(initial.hash, initial.folderMillis)
  })()
}

/** Created-at of the newest migration; a database recording a later one is from a newer version */
export function latestMigrationMillis(): number {
  const migrations = readMigrationFiles({ migrationsFolder: resolveMigrationsFolder() })
  return Math.max(...migrations.map((m) => m.folderMillis))
}

export function runMigrations(): void {
  const migrationsFolder = resolveMigrationsFolder()

  // drizzle-kit rebuilds tables for some schema changes (CREATE __new_x,
  // copy, DROP x, rename). The migrator runs inside a transaction, where the
  // migration's own `PRAGMA foreign_keys=OFF` is a no-op, and better-sqlite3
  // enables foreign keys by default - so DROP TABLE would cascade-delete
  // child rows (e.g. all invoice line items). Disable enforcement outside
  // the transaction instead, and verify integrity before re-enabling it.
  const sqlite = getSqlite()
  sqlite.pragma('foreign_keys = OFF')
  try {
    upgradeLegacyDatabase(sqlite, migrationsFolder)
    migrate(getDb(), { migrationsFolder })
    const violations = sqlite.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) {
      throw new Error(`Migration left ${violations.length} foreign key violation(s)`)
    }
  } finally {
    sqlite.pragma('foreign_keys = ON')
  }
}
