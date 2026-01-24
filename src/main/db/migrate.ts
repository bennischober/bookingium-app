import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from './index'
import { join } from 'path'
import { app } from 'electron'

export function runMigrations() {
  // if in dev mode, skip migrations
  if (!app.isPackaged) {
    console.log('Skipping migrations in development mode')
    return
  }

  // In production, migrations are in resources folder
  const migrationsFolder = app.isPackaged
    ? join(process.resourcesPath, 'migrations')
    : join(__dirname, 'migrations')

  console.log('Running migrations from:', migrationsFolder)

  migrate(db, { migrationsFolder })
}
