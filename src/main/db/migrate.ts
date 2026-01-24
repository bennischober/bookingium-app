import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from './index'
import { join } from 'path'
import { app } from 'electron'

export function runMigrations() {
  let migrationsFolder: string

  if (app.isPackaged) {
    // Production: migrations are copied to resources folder
    migrationsFolder = join(process.resourcesPath, 'migrations')
  } else {
    // Development: resolve from app root
    migrationsFolder = join(app.getAppPath(), 'src/main/db/migrations')
  }

  console.log('Running migrations from:', migrationsFolder)

  migrate(db, { migrationsFolder })
}
