import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { schema } from './schema'

export type Db = BetterSQLite3Database<typeof schema>

// ========================================
// Lazy, overridable database handle
// ========================================
// The db is created on first access instead of at module load. This keeps
// importing repositories side-effect free (important for unit tests, which
// swap in an in-memory database before touching the repositories).

let sqlite: Database.Database | null = null
let dbInstance: Db | null = null
let currentDbPath = ''

function defaultSqlitePath(): string {
  // Electron's app.getPath is only available inside the electron runtime.
  // Outside (tests, tooling), fall back to the OS temp directory.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    return join(app.getPath('userData'), 'data')
  } catch {
    return join(process.env.TMP || process.env.TEMP || '/tmp', 'bookingum-test')
  }
}

export function getDb(): Db {
  if (!dbInstance) {
    const folder = defaultSqlitePath()
    if (!existsSync(folder)) {
      mkdirSync(folder, { recursive: true })
    }
    currentDbPath = join(folder, 'bookingum.db')
    sqlite = new Database(currentDbPath)
    sqlite.pragma('journal_mode = WAL')
    dbInstance = drizzle(sqlite, { schema })
  }
  return dbInstance
}

export function getSqlite(): Database.Database {
  if (!sqlite) getDb()
  return sqlite as Database.Database
}

/** Whether the database is open; a staged restore must be applied before it is */
export function isDbOpen(): boolean {
  return sqlite !== null
}

export function getDbPath(): string {
  if (!dbInstance) getDb()
  return currentDbPath
}

/**
 * Swaps the active database handle. Used by tests to point all repositories
 * at an in-memory database. Returns a restore function.
 */
export function useTestDb(testDb: Db, testSqlite: Database.Database): () => void {
  const prevDb = dbInstance
  const prevSqlite = sqlite
  const prevPath = currentDbPath
  dbInstance = testDb
  sqlite = testSqlite
  currentDbPath = ':memory:'
  return () => {
    dbInstance = prevDb
    sqlite = prevSqlite
    currentDbPath = prevPath
  }
}

// Backwards-compatible default export: repositories keep importing `db`.
// This is a Proxy so that `db` resolves lazily on first property access
// instead of eagerly opening the real database at import time.
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver)
  }
})
