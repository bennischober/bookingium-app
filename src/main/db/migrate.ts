import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { getDb } from './index'
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

  migrate(getDb(), { migrationsFolder })
}
