// Corrupt-store recovery: a store that cannot be read must be set aside and rebuilt, not kill the core.
//
// Why this exists at all: the Store constructor runs inside `for (const a of options.accounts)`
// (index.ts:138), so a throw from ONE corrupt store means EVERY account fails to load and the app
// has no mail at all - including the accounts whose stores are perfectly fine. And before this change
// a corrupt .db was unrecoverable except by deleting the folder by hand, which silently lost all local
// mail. Every row came from the server, so the file is rebuildable; it just has to be rebuildable
// WITHOUT taking the rest of the app down with it.
//
// The rule that matters most is the NEGATIVE one: only the two corruption codes may ever set a store
// aside. Quarantining on a transient failure would throw away a good store, which is worse than the bug.
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Store } from '../src/main/mailclient/core/store'
import { StoreVersionError } from '../src/main/mailclient/core/migrations'
import {
  isCorruptStoreError,
  quarantineStoreFiles
} from '../src/main/mailclient/core/store_recovery'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) {
    const fn = cleanups.pop()!
    try {
      fn()
    } catch {
      /* best effort */
    }
  }
})

function scratchDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-store-recovery-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A real store with real rows, so "rebuilt" is distinguishable from "was always empty". */
function seedStore(dir: string, accountId = 'acc'): string {
  const store = new Store(dir, accountId)
  store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '1' })
  store.db.close()
  return path.join(dir, `${accountId}.db`)
}

/** Damage the middle of the file: measured to raise SQLITE_CORRUPT at `pragma journal_mode`. */
function corruptMiddle(dbPath: string): void {
  const buf = fs.readFileSync(dbPath)
  for (let i = 100; i < Math.min(buf.length, 4000); i++) buf[i] = 0xff
  fs.writeFileSync(dbPath, buf)
}

/** A file that is not a database at all: measured to raise SQLITE_NOTADB. */
function writeCorruptFile(dbPath: string): void {
  fs.writeFileSync(dbPath, Buffer.from('this is definitely not a sqlite database, just padding'))
}

const quarantined = (dir: string): string[] =>
  fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'))

const folderCount = (store: Store): unknown =>
  store.db.prepare('SELECT COUNT(*) c FROM folders').get()

describe('corrupt store: what counts as corruption', () => {
  it('accepts exactly the two corruption codes', () => {
    // measured: random bytes and a truncated header raise SQLITE_NOTADB, a damaged middle raises SQLITE_CORRUPT
    expect(isCorruptStoreError({ code: 'SQLITE_CORRUPT' })).toBe(true)
    expect(isCorruptStoreError({ code: 'SQLITE_NOTADB' })).toBe(true)
  })

  it('refuses every other failure, including the transient ones', () => {
    // measured: a locked DB and a zero-byte file both OPEN FINE, so neither can be the reason a store
    // is set aside - if one ever surfaces as an error it is a different failure
    for (const code of [
      'SQLITE_BUSY',
      'SQLITE_LOCKED',
      'SQLITE_READONLY',
      'SQLITE_CANTOPEN',
      'SQLITE_FULL',
      'SQLITE_IOERR',
      'ENOSPC',
      'EACCES'
    ]) {
      expect(isCorruptStoreError({ code }), code).toBe(false)
    }
    expect(isCorruptStoreError(new Error('no code'))).toBe(false)
    expect(isCorruptStoreError(null)).toBe(false)
    expect(isCorruptStoreError(undefined)).toBe(false)
    // a bare string is not an error object, so it carries no code
    expect(isCorruptStoreError('SQLITE_CORRUPT')).toBe(false)
  })
})

describe('corrupt store: the store recovers instead of throwing', () => {
  it('sets a corrupt store aside and opens a fresh one', () => {
    const dir = scratchDir()
    const dbPath = seedStore(dir)
    corruptMiddle(dbPath)
    expect(quarantined(dir)).toEqual([])

    const warnings: string[] = []
    const store = new Store(dir, 'acc', Date.now, { warn: (m) => warnings.push(m) })
    cleanups.push(() => store.db.close())

    // SC1: it opened, it set the file aside, it said so, and the fresh store is usable
    const aside = quarantined(dir)
    expect(aside).toHaveLength(1)
    expect(aside[0]).toMatch(/^acc\.db\.corrupt-/)
    // the reason is reported rather than swallowed, and it names where the file went
    expect(warnings.join('\n')).toMatch(/corrupt/)
    expect(warnings.join('\n')).toContain(aside[0])
    // the rebuilt store is empty (the seeded row is gone with the file) and it works
    expect(folderCount(store)).toEqual({ c: 0 })
    store.upsertFolder({ imapPath: 'INBOX', delimiter: '/', uidValidity: '2' })
    expect(folderCount(store)).toEqual({ c: 1 })
  })

  it('keeps the corrupt file instead of deleting it', () => {
    // a corrupt store still holds the user's message bodies; a bug in this recovery must never be
    // the thing that destroys the only copy, so the file is renamed and never unlinked
    const dir = scratchDir()
    const dbPath = seedStore(dir)
    const sizeBefore = fs.statSync(dbPath).size
    corruptMiddle(dbPath)

    const store = new Store(dir, 'acc', Date.now, {})
    cleanups.push(() => store.db.close())

    const aside = quarantined(dir)
    expect(aside).toHaveLength(1)
    expect(fs.statSync(path.join(dir, aside[0])).size).toBe(sizeBefore)
  })

  it('moves the WAL and SHM sidecars with the store', () => {
    // a fresh store that adopted the old WAL would replay the corrupt file's pages into it
    const dir = scratchDir()
    const dbPath = seedStore(dir)
    corruptMiddle(dbPath)
    // seedStore closes its handle, which checkpoints the WAL away; create the sidecars the
    // way an interrupted process would leave them
    fs.writeFileSync(`${dbPath}-wal`, 'stale')
    fs.writeFileSync(`${dbPath}-shm`, 'stale')

    const moved = quarantineStoreFiles(dbPath)
    expect(moved).toMatch(/\.corrupt-/)
    expect(fs.existsSync(dbPath)).toBe(false)
    // both sidecars travelled with the file
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false)
    expect(fs.existsSync(`${dbPath}-shm`)).toBe(false)
    expect(fs.readFileSync(`${moved}-wal`, 'utf8')).toBe('stale')
    expect(fs.readFileSync(`${moved}-shm`, 'utf8')).toBe('stale')
  })
})

describe('corrupt store: what must NOT be quarantined', () => {
  it('does not set a locked store aside', () => {
    // SC2: the destructive risk. A locked DB is a GOOD store, and the probe showed it opens fine
    // anyway. If a lock ever surfaces as an error it must rethrow, never quarantine.
    const dir = scratchDir()
    const dbPath = seedStore(dir)
    const holder = new Database(dbPath)
    holder.pragma('journal_mode = WAL')
    holder.exec('BEGIN EXCLUSIVE')
    cleanups.push(() => {
      try {
        holder.exec('ROLLBACK')
      } catch {
        /* already rolled back */
      }
      holder.close()
    })

    const store = new Store(dir, 'acc', Date.now, {})
    cleanups.push(() => store.db.close())

    expect(quarantined(dir)).toEqual([])
    // the rows survived: nothing was rebuilt
    expect(folderCount(store)).toEqual({ c: 1 })
  })

  it('still refuses a store from a newer build, and quarantines nothing', () => {
    // SC3: a newer schema is not corruption. Setting it aside would destroy data this build simply
    // does not understand yet, which is the opposite of the refusal's purpose.
    const dir = scratchDir()
    const dbPath = seedStore(dir)
    const db = new Database(dbPath)
    db.pragma('user_version = 999')
    db.close()

    expect(() => new Store(dir, 'acc', Date.now, {})).toThrow(StoreVersionError)
    expect(quarantined(dir)).toEqual([])
  })

  it('retries exactly once, never in a loop', () => {
    // SC4: the one-retry rule. A loop that breaks on success behaves identically while the retry
    // succeeds, so the distinguishing case is a retry that fails TOO: one retry then throws, while a
    // loop would quarantine again and try again. The warn hook runs between the quarantine and the
    // retry, which makes it the exact point to put a second corrupt file back - written FROM SCRATCH,
    // because the first quarantine moved the original away.
    // A loop never terminates, so the per-test timeout is part of the assertion: it turns "spun
    // forever" into a red test instead of a green one.
    const dir = scratchDir()
    const dbPath = seedStore(dir)
    corruptMiddle(dbPath)

    const warnings: string[] = []
    let error: unknown = null
    try {
      new Store(dir, 'acc', Date.now, {
        warn: (m) => {
          warnings.push(m)
          // put a corrupt file back where the retry will find it, once only
          if (warnings.length === 1) writeCorruptFile(dbPath)
        }
      })
    } catch (e) {
      error = e
    }

    // it gave up instead of recovering again...
    expect(error).not.toBeNull()
    // ...and it reported exactly once, so there was exactly one quarantine attempt
    expect(warnings).toHaveLength(1)
  }, 3000)

  it('throws when the store cannot be set aside, instead of looping', () => {
    // SC4: on Windows a file with an open handle cannot be renamed (EBUSY, measured). That is the
    // "cannot set it aside" case: the recovery must fail loudly, never reopen the same corrupt file.
    const dir = scratchDir()
    const dbPath = seedStore(dir)
    corruptMiddle(dbPath)
    // a foreign process still holds the file: the rename must fail
    const holder = new Database(dbPath)
    cleanups.push(() => holder.close())

    expect(() => new Store(dir, 'acc', Date.now, {})).toThrow()
    // and the corrupt file is still there, untouched
    expect(quarantined(dir)).toEqual([])
  })
})
