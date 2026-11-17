// Sync between computers (src/main/sync): two "computers" with their own database and storage
// share a folder. Joining merges the joiner's data without duplicates, edits travel both ways,
// concurrent edits merge per field, deletes win, unique clashes alias or become conflicts, files
// follow, and a restored backup takes a new identity.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { schema } from '../src/main/db/schema'
import { SyncEngine, createGroup } from '../src/main/sync/engine'
import { prepareJoin } from '../src/main/sync/join'
import { FolderTransport } from '../src/main/sync/transport'
import { configureRowIds, idRange } from '../src/main/sync/ids'
import { MERGE_ORDER, OWNED_TABLES, keyOf, normalizeText } from '../src/main/sync/merge'
import { foreignKeys, syncedTables } from '../src/main/sync/store'
import { applyStagedRestore, stageRestore } from '../src/main/backup/files'
import { formatHlc, HybridClock, parseHlc } from '../src/main/sync/hlc'

const MIGRATIONS = resolve(__dirname, '../src/main/db/migrations')
const SCHEMA = 1

type Computer = {
  name: string
  root: string
  dataDir: string
  storageDir: string
  workDir: string
  sqlite: Database.Database
  db: ReturnType<typeof drizzle<typeof schema>>
  engine: SyncEngine | null
}

let base: string
let shared: string
let clockMs: number
/** Every database a test opened: closed in afterEach, so Windows can remove the folder after a failure */
let opened: Database.Database[] = []

function openComputer(name: string): Computer {
  const root = join(base, name)
  const dataDir = join(root, 'data')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(root, 'storage'), { recursive: true })
  const sqlite = new Database(join(dataDir, 'bookingum.db'))
  opened.push(sqlite)
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: MIGRATIONS })
  return {
    name,
    root,
    dataDir,
    storageDir: join(root, 'storage'),
    workDir: join(root, 'backup'),
    sqlite,
    db,
    engine: null
  }
}

function engineOptions(c: Computer) {
  return {
    sqlite: c.sqlite,
    transport: new FolderTransport(shared),
    storageDir: c.storageDir,
    schema: SCHEMA,
    appVersion: 'test',
    deviceName: c.name,
    removeFile: async (file: string) => unlinkSync(file),
    // every computer's clock moves on, so "newer" is well defined in the tests
    now: () => new Date((clockMs += 1000))
  }
}

/** Runs `work` as computer `c`: new rows take its ids */
function as<T>(c: Computer, work: () => T): T {
  if (c.engine) c.engine.useRowIds()
  else configureRowIds(null)
  try {
    return work()
  } finally {
    configureRowIds(null)
  }
}

async function sync(...computers: Computer[]) {
  const results = []
  for (const c of computers) {
    c.engine!.useRowIds()
    results.push(await c.engine!.run())
    configureRowIds(null)
  }
  return results
}

async function setUp(first: Computer): Promise<void> {
  first.engine = await createGroup(engineOptions(first), join(first.root, 'snap.db'))
  configureRowIds(null)
}

/** Joins and "restarts": the staged data replaces the live one like a restore at startup */
async function join_(c: Computer): Promise<Computer> {
  const prepared = await prepareJoin({
    transport: new FolderTransport(shared),
    liveSqlite: c.sqlite,
    liveStorage: c.storageDir,
    workDir: c.workDir,
    schema: SCHEMA,
    migrate: () => {}
  })
  c.sqlite.close()
  await stageRestore(c.workDir)
  const outcome = applyStagedRestore({
    dataDir: c.dataDir,
    storageDir: c.storageDir,
    workDir: c.workDir
  })
  expect(outcome?.error).toBeNull()
  const sqlite = new Database(join(c.dataDir, 'bookingum.db'))
  opened.push(sqlite)
  const next: Computer = { ...c, sqlite, db: drizzle(sqlite, { schema }), engine: null }
  next.engine = new SyncEngine(engineOptions(next))
  expect(next.engine.deviceId).toBe(prepared.device)
  next.engine.activate()
  configureRowIds(null)
  return next
}

function company(c: Computer, name: string): number {
  return as(c, () => c.db.insert(schema.company).values({ name }).returning().get().id)
}

function band(c: Computer, name: string, companyId: number): number {
  return as(
    c,
    () => c.db.insert(schema.band).values({ name, company_id: companyId }).returning().get().id
  )
}

function person(c: Computer, first: string, last: string, email = ''): number {
  return as(c, () => {
    const contact = c.db.insert(schema.contact).values({ email }).returning().get()
    return c.db
      .insert(schema.person)
      .values({ first_name: first, last_name: last, contact_id: contact.id })
      .returning()
      .get().id
  })
}

const names = (c: Computer, table: 'band' | 'company') =>
  (
    c.sqlite.prepare(`SELECT name FROM ${table} ORDER BY name`).all() as Array<{ name: string }>
  ).map((r) => r.name)

const people = (c: Computer) =>
  (
    c.sqlite
      .prepare("SELECT first_name || ' ' || last_name AS n FROM person ORDER BY n")
      .all() as Array<{ n: string }>
  ).map((r) => r.n)

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'bookingium-sync-'))
  shared = join(base, 'Google Drive', 'Bookingium')
  mkdirSync(shared, { recursive: true })
  clockMs = Date.UTC(2026, 10, 1)
})

afterEach(() => {
  configureRowIds(null)
  for (const sqlite of opened) if (sqlite.open) sqlite.close()
  opened = []
  rmSync(base, { recursive: true, force: true })
})

describe('building blocks', () => {
  it('hybrid clock strings sort in causal order', () => {
    let now = 1000
    const a = new HybridClock('aaa', null, () => now)
    const first = a.tick()
    const second = a.tick()
    expect(second > first).toBe(true)
    const b = new HybridClock('bbb', null, () => 10)
    b.receive(second)
    expect(b.tick() > second).toBe(true)
    now = 5
    expect(a.tick() > second).toBe(true)
    expect(parseHlc(formatHlc({ ms: 12, counter: 3, device: 'x' }))).toEqual({
      ms: 12,
      counter: 3,
      device: 'x'
    })
  })

  it('merges every synced table after the tables its foreign keys point to', () => {
    const c = openComputer('schema')
    const tables = syncedTables(c.sqlite)
    const order = [...MERGE_ORDER]
    for (const table of tables) expect(order.includes(table) || OWNED_TABLES.has(table)).toBe(true)
    for (const table of order) {
      for (const fk of foreignKeys(c.sqlite, table)) {
        if (fk.table === table || OWNED_TABLES.has(fk.table)) continue
        expect(order.indexOf(fk.table), `${table} -> ${fk.table}`).toBeGreaterThanOrEqual(0)
        expect(order.indexOf(fk.table), `${table} -> ${fk.table}`).toBeLessThan(
          order.indexOf(table)
        )
      }
    }
    c.sqlite.close()
  })

  it('matches names regardless of case, umlaut spelling and punctuation', () => {
    expect(normalizeText('Jürgen  Müller-Lüdenscheid')).toBe(
      normalizeText('juergen mueller ludenscheid'.replace('ludenscheid', 'luedenscheid'))
    )
    expect(keyOf('band', { name: ' The  Beatles! ' })).toBe(keyOf('band', { name: 'the beatles' }))
    expect(keyOf('person', { first_name: '', last_name: '' })).toBeNull()
  })
})

describe('two computers', () => {
  it('joins without duplicates and then carries edits both ways', async () => {
    const a = openComputer('buero')
    const b = openComputer('laptop')
    // both already work with the app
    const agencyA = company(a, 'Agentur Muster GmbH')
    band(a, 'Pretty Wild', agencyA)
    person(a, 'Max', 'Mustermann', 'max@example.org')
    const agencyB = company(b, 'agentur muster gmbh')
    // updated_at has whole seconds: pin the order, so the group's spelling is the newer one and
    // stays (merge.ts takes the joiner's values only when its record was edited later)
    for (const [c, id, at] of [
      [a, agencyA, '2026-11-01 10:00:00'],
      [b, agencyB, '2026-11-01 09:00:00']
    ] as const) {
      c.sqlite.prepare('UPDATE company SET updated_at = ? WHERE id = ?').run(at, id)
    }
    band(b, 'Pretty Wild', agencyB)
    band(b, 'Neue Band', agencyB)
    person(b, 'Max', 'Mustermann', 'max@example.org')
    person(b, 'Erika', 'Musterfrau')

    await setUp(a)
    const b2 = await join_(b)
    await sync(b2, a)

    for (const c of [a, b2]) {
      expect(names(c, 'company')).toEqual(['Agentur Muster GmbH'])
      expect(names(c, 'band')).toEqual(['Neue Band', 'Pretty Wild'])
      expect(people(c)).toEqual(['Erika Musterfrau', 'Max Mustermann'])
    }
    // the joiner's band points at the merged company on both computers
    const neueA = a.sqlite
      .prepare("SELECT company_id FROM band WHERE name = 'Neue Band'")
      .get() as { company_id: number }
    expect(neueA.company_id).toBe(agencyA)

    // an edit on either side reaches the other
    as(a, () =>
      a.db
        .update(schema.band)
        .set({ notes: 'vom Büro' })
        .where(eq(schema.band.name, 'Neue Band'))
        .run()
    )
    const newB = band(b2, 'Ganz Neu', agencyA)
    await sync(a, b2, a)
    expect(names(a, 'band')).toContain('Ganz Neu')
    expect(
      (
        b2.sqlite.prepare("SELECT notes FROM band WHERE name = 'Neue Band'").get() as {
          notes: string
        }
      ).notes
    ).toBe('vom Büro')
    // ids of the second computer come from its own range
    const { first, last } = idRange(b2.engine!.prefix)
    expect(newB).toBeGreaterThanOrEqual(first)
    expect(newB).toBeLessThanOrEqual(last)
    expect(a.sqlite.prepare('SELECT id FROM band WHERE id = ?').get(newB)).toBeTruthy()
    a.sqlite.close()
    b2.sqlite.close()
  })

  it('merges concurrent edits per field; the newer edit of the same field wins', async () => {
    const a = openComputer('a')
    const b = openComputer('b')
    const agency = company(a, 'Agentur')
    const id = band(a, 'Band', agency)
    await setUp(a)
    const b2 = await join_(b)
    await sync(b2, a)

    as(a, () => a.db.update(schema.band).set({ notes: 'A' }).where(eq(schema.band.id, id)).run())
    as(b2, () =>
      b2.db.update(schema.band).set({ founded: '2001-01-01' }).where(eq(schema.band.id, id)).run()
    )
    await sync(a, b2, a)
    as(b2, () =>
      b2.db.update(schema.band).set({ notes: 'B später' }).where(eq(schema.band.id, id)).run()
    )
    await sync(b2, a)
    for (const c of [a, b2]) {
      expect(c.sqlite.prepare('SELECT notes, founded FROM band WHERE id = ?').get(id)).toEqual({
        notes: 'B später',
        founded: '2001-01-01'
      })
    }
    a.sqlite.close()
    b2.sqlite.close()
  })

  it('a delete wins over a concurrent edit', async () => {
    const a = openComputer('a')
    const b = openComputer('b')
    const agency = company(a, 'Agentur')
    const id = band(a, 'Band', agency)
    await setUp(a)
    const b2 = await join_(b)
    await sync(b2, a)
    as(a, () => a.db.delete(schema.band).where(eq(schema.band.id, id)).run())
    as(b2, () =>
      b2.db
        .update(schema.band)
        .set({ notes: 'noch bearbeitet' })
        .where(eq(schema.band.id, id))
        .run()
    )
    await sync(a, b2, a)
    for (const c of [a, b2])
      expect(c.sqlite.prepare('SELECT 1 FROM band WHERE id = ?').get(id)).toBeUndefined()
    a.sqlite.close()
    b2.sqlite.close()
  })

  it('a genre typed on both computers becomes one; links on both sides survive', async () => {
    const a = openComputer('a')
    const b = openComputer('b')
    const agency = company(a, 'Agentur')
    const bandId = band(a, 'Band', agency)
    const venueId = as(
      a,
      () => a.db.insert(schema.venue).values({ name: 'Club' }).returning().get().id
    )
    await setUp(a)
    const b2 = await join_(b)
    await sync(b2, a)
    as(a, () => {
      const g = a.db.insert(schema.genre).values({ name: 'Rock' }).returning().get()
      a.db.insert(schema.band_genre).values({ band_id: bandId, genre_id: g.id }).run()
    })
    as(b2, () => {
      const g = b2.db.insert(schema.genre).values({ name: 'rock' }).returning().get()
      b2.db.insert(schema.venue_genre).values({ venue_id: venueId, genre_id: g.id }).run()
    })
    await sync(a, b2, a)
    for (const c of [a, b2]) {
      expect(c.sqlite.prepare('SELECT COUNT(*) AS n FROM genre').get()).toEqual({ n: 1 })
      expect(c.sqlite.prepare('SELECT COUNT(*) AS n FROM band_genre').get()).toEqual({ n: 1 })
      expect(c.sqlite.prepare('SELECT COUNT(*) AS n FROM venue_genre').get()).toEqual({ n: 1 })
    }
    a.sqlite.close()
    b2.sqlite.close()
  })

  it('the same invoice number issued on both computers is reported, not merged', async () => {
    const a = openComputer('a')
    const b = openComputer('b')
    const agency = company(a, 'Agentur')
    await setUp(a)
    const b2 = await join_(b)
    await sync(b2, a)
    const invoice = (c: Computer, notes: string) =>
      as(c, () =>
        c.db.insert(schema.invoice).values({ company_id: agency, invoice_number: 7, notes }).run()
      )
    invoice(a, 'vom Büro')
    invoice(b2, 'vom Laptop')
    await sync(a, b2, a)
    const conflicts = a.sqlite.prepare('SELECT message FROM sync_conflict').all() as Array<{
      message: string
    }>
    expect(conflicts.length).toBe(1)
    expect(conflicts[0].message).toContain('Rechnung Nr. 7')
    expect(b2.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_conflict').get()).toEqual({ n: 1 })
    a.sqlite.close()
    b2.sqlite.close()
  })

  it('documents and logos follow, and so does their removal', async () => {
    const a = openComputer('a')
    const b = openComputer('b')
    mkdirSync(join(a.storageDir, 'logos', '1'), { recursive: true })
    writeFileSync(join(a.storageDir, 'logos', '1', 'logo.png'), 'A-logo')
    // the joiner has a different file under the same path
    mkdirSync(join(b.storageDir, 'logos', '1'), { recursive: true })
    writeFileSync(join(b.storageDir, 'logos', '1', 'logo.png'), 'B-logo')
    // (a different creation time: the same id and created_at would mean a common past)
    as(b, () =>
      b.db
        .insert(schema.company)
        .values({
          name: 'Firma B',
          logo_path: 'logos/1/logo.png',
          created_at: '2020-01-01 10:00:00'
        })
        .run()
    )
    company(a, 'Firma A')
    await setUp(a)
    const b2 = await join_(b)
    await sync(b2, a)
    expect(readFileSync(join(a.storageDir, 'logos', '1', 'logo.png'), 'utf-8')).toBe('A-logo')
    const moved = (
      a.sqlite.prepare("SELECT logo_path FROM company WHERE name = 'Firma B'").get() as {
        logo_path: string
      }
    ).logo_path
    expect(moved).toBe('logos/1/logo-2.png')
    expect(readFileSync(join(a.storageDir, ...moved.split('/')), 'utf-8')).toBe('B-logo')

    // a new document on A arrives on B; removing it removes it there
    mkdirSync(join(a.storageDir, 'documents', 'bands'), { recursive: true })
    writeFileSync(join(a.storageDir, 'documents', 'bands', 'rider.pdf'), 'PDF')
    await sync(a, b2)
    expect(readFileSync(join(b2.storageDir, 'documents', 'bands', 'rider.pdf'), 'utf-8')).toBe(
      'PDF'
    )
    unlinkSync(join(a.storageDir, 'documents', 'bands', 'rider.pdf'))
    await sync(a, b2)
    expect(existsSync(join(b2.storageDir, 'documents', 'bands', 'rider.pdf'))).toBe(false)
    a.sqlite.close()
    b2.sqlite.close()
  })

  it('a restored backup takes a new identity and gets the newer changes back', async () => {
    const a = openComputer('a')
    const b = openComputer('b')
    const agency = company(a, 'Agentur')
    await setUp(a)
    const b2 = await join_(b)
    await sync(b2, a)
    // a copy of A's database as it is now (the "backup")
    a.sqlite.prepare('VACUUM INTO ?').run(join(base, 'backup.db'))
    band(a, 'Nach der Sicherung', agency)
    await sync(a, b2)
    // A restores the backup
    a.sqlite.close()
    for (const suffix of ['', '-wal', '-shm'])
      rmSync(join(a.dataDir, `bookingum.db${suffix}`), { force: true })
    writeFileSync(join(a.dataDir, 'bookingum.db'), readFileSync(join(base, 'backup.db')))
    const sqlite = new Database(join(a.dataDir, 'bookingum.db'))
    const a2: Computer = { ...a, sqlite, db: drizzle(sqlite, { schema }), engine: null }
    a2.engine = new SyncEngine(engineOptions(a2))
    const previous = a2.engine.deviceId
    const { device } = await a2.engine.reidentify()
    expect(device).not.toBe(previous)
    configureRowIds(null)
    await sync(a2)
    expect(names(a2, 'band')).toContain('Nach der Sicherung')
    band(a2, 'Danach', agency)
    await sync(a2, b2)
    expect(names(b2, 'band')).toContain('Danach')
    a2.sqlite.close()
    b2.sqlite.close()
  })
})
