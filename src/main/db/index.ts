import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { schema } from './schema'

const userDataPath = app.getPath('userData')
const dbFolder = join(userDataPath, 'data')

if (!existsSync(dbFolder)) {
  mkdirSync(dbFolder, { recursive: true })
}

const dbPath = join(dbFolder, 'bookingum.db')
console.log('Database path:', dbPath)

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')

export const db = drizzle(sqlite, { schema })
export { dbPath }
