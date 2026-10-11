// Test bootstrap: swaps the real database for a fresh in-memory one (with
// migrations applied) before tests touch repositories/services.
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { resolve } from 'path'
import { beforeAll, afterAll } from 'vitest'
import { schema } from '../../src/main/db/schema'
import { useTestDb, type Db } from '../../src/main/db/index'

let restoreDb: (() => void) | null = null
let testSqlite: Database.Database | null = null

export type TestDb = {
  db: BetterSQLite3Database<typeof schema>
  sqlite: Database.Database
}

let current: TestDb | null = null

export function getTestDb(): TestDb {
  if (!current) throw new Error('setupTestDb() must run first (use setupTestDb in beforeAll)')
  return current
}

export function setupTestDb(): void {
  beforeAll(() => {
    testSqlite = new Database(':memory:')
    const db = drizzle(testSqlite, { schema })
    migrate(db, { migrationsFolder: resolve(__dirname, '../../src/main/db/migrations') })
    restoreDb = useTestDb(db as Db, testSqlite)
    current = { db, sqlite: testSqlite }
  })

  afterAll(() => {
    restoreDb?.()
    testSqlite?.close()
    testSqlite = null
    current = null
    restoreDb = null
  })
}
