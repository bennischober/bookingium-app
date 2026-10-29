import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3'

/** How many copies from before an update stay in backup/before-update/ */
export const BEFORE_UPDATE_KEEP = 3

const FOLDER = 'before-update'
const LAST_VERSION_FILE = 'last-version.txt'
/** `<version>_<timestamp>.db`; the timestamp sorts by age */
const COPY_NAME = /^(.+)_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.db$/

export function beforeUpdateFolder(workDir: string): string {
  return join(workDir, FOLDER)
}

/** The app version that last opened this data folder; null before the first start that recorded it */
export function readLastVersion(workDir: string): string | null {
  try {
    return (
      readFileSync(join(beforeUpdateFolder(workDir), LAST_VERSION_FILE), 'utf-8').trim() || null
    )
  } catch {
    return null
  }
}

export function writeLastVersion(workDir: string, version: string): void {
  mkdirSync(beforeUpdateFolder(workDir), { recursive: true })
  writeFileSync(join(beforeUpdateFolder(workDir), LAST_VERSION_FILE), version)
}

/**
 * Copies the database before pending migrations change it, named after the version that last
 * opened it ("unbekannt" when none recorded one). Synchronous (`VACUUM INTO`), so startup waits
 * for it; the copy is a consistent snapshot even in WAL mode. Returns the copy's path.
 */
export function copyBeforeUpdate(options: {
  sqlite: Database.Database
  workDir: string
  fromVersion: string | null
  now: Date
}): string {
  const folder = beforeUpdateFolder(options.workDir)
  mkdirSync(folder, { recursive: true })
  const version = (options.fromVersion ?? 'unbekannt').replace(/[^0-9A-Za-z.-]/g, '-')
  const stamp = options.now.toISOString().slice(0, 19).replace(/:/g, '-')
  const file = join(folder, `${version}_${stamp}.db`)
  if (existsSync(file)) rmSync(file)
  options.sqlite.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  return file
}

/** Deletes all but the newest copies; only files named like ours are touched. Returns their names. */
export function pruneBeforeUpdate(workDir: string, keep = BEFORE_UPDATE_KEEP): string[] {
  const folder = beforeUpdateFolder(workDir)
  if (!existsSync(folder)) return []
  const copies = readdirSync(folder)
    .map((name) => ({ name, stamp: COPY_NAME.exec(name)?.[2] }))
    .filter((copy): copy is { name: string; stamp: string } => copy.stamp !== undefined)
    .sort((a, b) => b.stamp.localeCompare(a.stamp))
  const removed = copies.slice(keep).map((copy) => copy.name)
  for (const name of removed) rmSync(join(folder, name), { force: true })
  return removed
}
