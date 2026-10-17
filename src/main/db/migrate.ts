import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { getDb, getSqlite } from './index'
import { join } from 'path'

let migrationsFolderOverride: string | null = null

/** Tests can point the migrator at a specific migrations folder. */
export function setMigrationsFolder(folder: string | null): void {
  migrationsFolderOverride = folder
}

export function runMigrations(): void {
  let migrationsFolder: string

  if (migrationsFolderOverride) {
    migrationsFolder = migrationsFolderOverride
  } else {
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

    migrationsFolder =
      candidates.find((folder) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { existsSync } = require('fs')
          return existsSync(join(folder, 'meta/_journal.json'))
        } catch {
          return false
        }
      }) ?? candidates[0]
  }

  // drizzle-kit rebuilds tables for some schema changes (CREATE __new_x,
  // copy, DROP x, rename). The migrator runs inside a transaction, where the
  // migration's own `PRAGMA foreign_keys=OFF` is a no-op, and better-sqlite3
  // enables foreign keys by default - so DROP TABLE would cascade-delete
  // child rows (e.g. all invoice line items). Disable enforcement outside
  // the transaction instead, and verify integrity before re-enabling it.
  const sqlite = getSqlite()
  sqlite.pragma('foreign_keys = OFF')
  try {
    migrate(getDb(), { migrationsFolder })
    const violations = sqlite.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) {
      throw new Error(`Migration left ${violations.length} foreign key violation(s)`)
    }
  } finally {
    sqlite.pragma('foreign_keys = ON')
  }
}
