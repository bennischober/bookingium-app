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
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron') as typeof import('electron')
      if (app.isPackaged) {
        // Production: migrations are copied to resources folder
        migrationsFolder = join(process.resourcesPath, 'migrations')
      } else {
        // Development: resolve from app root
        migrationsFolder = join(app.getAppPath(), 'src/main/db/migrations')
      }
    } catch {
      // Outside the electron runtime (tests/tooling): resolve from repo root
      migrationsFolder = join(process.cwd(), 'src/main/db/migrations')
    }
  }

  migrate(getDb(), { migrationsFolder })
}
