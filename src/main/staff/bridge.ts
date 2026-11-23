// ========================================
// The staff bridge: an employee's folder, served by an admin computer (#262)
// ========================================
// The employee's computer syncs through a folder of its own, like any sync group, with one other
// "computer" in it: this bridge. The bridge never hands over the company's data as it is:
//
// - Out: it computes what the employee may see (policy.ts), compares it with what it sent so far
//   (sync_staff_shadow) and writes only the difference. A record that is shared later arrives,
//   one that is made internal is removed from the employee's computer.
// - In: it reads the employee's batches, checks every change (policy.checkStaffChange) and applies
//   what is allowed as this computer's own change, so it reaches the other admin computers through
//   the normal sync. A refused change is sent back as it really is.
// - The starting point the employee joins from is a filtered copy of the database, vacuumed so
//   nothing deleted stays readable in the file.
//
// Bookkeeping lives in sync_staff_* tables of this computer only (sync_* tables are never synced
// and are cleared when another computer joins from a copy of this database).
// No Electron here, like the rest of src/main/sync: tests run it against temp folders.
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { copyFile, mkdir, stat } from 'fs/promises'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'
import { BatchApplier } from '../sync/incoming'
import { HybridClock } from '../sync/hlc'
import { BATCH_FORMAT, type Batch, type FileChange, type RowChange } from '../sync/format'
import { sha256File, storagePath } from '../sync/storageFiles'
import {
  SchemaInfo,
  getMeta,
  keyColumn,
  quoteIdent as q,
  syncedTables,
  type Sqlite
} from '../sync/store'
import { LOCAL_TABLES } from '../sync/tables'
import { FolderTransport, type SyncTransport } from '../sync/transport'
import {
  checkStaffChange,
  computeStaffView,
  parentFirstOrder,
  viewFiles,
  type Row,
  type StaffContext,
  type StaffView
} from './policy'

const TABLES = `
CREATE TABLE IF NOT EXISTS sync_staff_channel (
  employee_id INTEGER PRIMARY KEY,
  folder TEXT NOT NULL,
  bridge_id TEXT NOT NULL,
  staff_device TEXT,
  export_seq INTEGER NOT NULL DEFAULT 0,
  imported_seq INTEGER NOT NULL DEFAULT 0,
  hlc TEXT,
  last_run_at TEXT,
  last_change_at TEXT,
  last_error TEXT,
  refused INTEGER NOT NULL DEFAULT 0,
  last_refusal TEXT
);
CREATE TABLE IF NOT EXISTS sync_staff_shadow (
  employee_id INTEGER NOT NULL,
  tbl TEXT NOT NULL,
  pk TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (employee_id, tbl, pk)
);
CREATE TABLE IF NOT EXISTS sync_staff_file (
  employee_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  sha TEXT NOT NULL,
  PRIMARY KEY (employee_id, path)
);
CREATE TABLE IF NOT EXISTS sync_staff_outbox (
  employee_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (employee_id, seq)
);
`

/** The bookkeeping tables of the bridge; a copy of this database must not take them along */
export const BRIDGE_TABLES = [
  'sync_staff_channel',
  'sync_staff_shadow',
  'sync_staff_file',
  'sync_staff_outbox'
]

export function ensureBridgeTables(sqlite: Sqlite): void {
  sqlite.exec(TABLES)
}

/** Clears the bridge bookkeeping, e.g. in a copy another computer joins from */
export function clearBridgeTables(sqlite: Sqlite): void {
  for (const table of BRIDGE_TABLES) sqlite.exec(`DROP TABLE IF EXISTS ${q(table)}`)
}

export type Channel = {
  employee_id: number
  folder: string
  bridge_id: string
  staff_device: string | null
  export_seq: number
  imported_seq: number
  hlc: string | null
  last_run_at: string | null
  last_change_at: string | null
  last_error: string | null
  refused: number
  last_refusal: string | null
}

export type BridgeEnv = {
  sqlite: Sqlite
  storageDir: string
  /** created_at of the newest migration this app knows */
  schema: number
  appVersion: string
  deviceName: string
  /** This computer in the company's sync group */
  adminDevice: string
  adminPrefix: number
  /** A work folder for the starting point (the backup work folder) */
  workDir: string
  now?: () => Date
  transportFor?: (folder: string) => SyncTransport
}

export type EmployeeRef = { id: number; name: string; idPrefix: number }

export type ChannelRunResult = {
  /** Batches of the employee applied */
  imported: number
  /** Their changes taken over here */
  applied: number
  /** Their changes refused */
  refused: number
  /** Batches written for the employee */
  exported: number
  /** Something changed here (the windows refresh) */
  changedHere: boolean
}

const nowOf = (env: BridgeEnv) => (env.now ?? (() => new Date()))()
const transportOf = (env: BridgeEnv, folder: string) =>
  env.transportFor?.(folder) ?? new FolderTransport(folder)

export function listChannels(sqlite: Sqlite): Channel[] {
  ensureBridgeTables(sqlite)
  return sqlite.prepare('SELECT * FROM sync_staff_channel ORDER BY employee_id').all() as Channel[]
}

export function getChannel(sqlite: Sqlite, employeeId: number): Channel | null {
  ensureBridgeTables(sqlite)
  return (
    (sqlite.prepare('SELECT * FROM sync_staff_channel WHERE employee_id = ?').get(employeeId) as
      | Channel
      | undefined) ?? null
  )
}

function contextOf(employee: EmployeeRef): StaffContext {
  return { employeeId: employee.id, idPrefix: employee.idPrefix }
}

// ---------- setting up ----------

/**
 * Makes `folder` the employee's: the group file (with the id range of the employee's computer),
 * the bridge as its first device and the filtered starting point.
 */
export async function createChannel(
  env: BridgeEnv,
  employee: EmployeeRef,
  folder: string
): Promise<Channel> {
  const { sqlite } = env
  ensureBridgeTables(sqlite)
  const transport = transportOf(env, folder)
  if (await transport.readGroup())
    throw new Error(
      'In diesem Ordner ist schon ein Abgleich eingerichtet. Bitte für jeden Mitarbeiter einen eigenen, leeren Ordner wählen.'
    )
  const now = nowOf(env)
  const bridgeId = `b${randomBytes(6).toString('hex')}`
  sqlite
    .prepare(
      'INSERT INTO sync_staff_channel (employee_id, folder, bridge_id) VALUES (?, ?, ?) ON CONFLICT(employee_id) DO UPDATE SET folder = excluded.folder, bridge_id = excluded.bridge_id, staff_device = NULL, export_seq = 0, imported_seq = 0, hlc = NULL'
    )
    .run(employee.id, folder, bridgeId)
  clearShadow(sqlite, employee.id)
  await transport.createGroup({
    app: 'bookingium',
    format: BATCH_FORMAT,
    id: randomBytes(6).toString('hex'),
    createdAt: now.toISOString(),
    kind: 'staff',
    staffPrefix: employee.idPrefix,
    employeeName: employee.name
  })
  await writeBridgeDevice(env, transport, bridgeId)
  await writeChannelSnapshot(env, employee)
  return getChannel(sqlite, employee.id)!
}

async function writeBridgeDevice(
  env: BridgeEnv,
  transport: SyncTransport,
  bridgeId: string
): Promise<void> {
  const now = nowOf(env).toISOString()
  await transport.writeDevice({
    id: bridgeId,
    name: `Bookingium (${env.deviceName})`,
    prefix: env.adminPrefix,
    createdAt: now,
    appVersion: env.appVersion,
    lastSeenAt: now
  })
}

/** Takes the access away: the folder is marked, the employee's computer clears its data */
export async function revokeChannel(env: BridgeEnv, employeeId: number): Promise<void> {
  const channel = getChannel(env.sqlite, employeeId)
  if (!channel) return
  const transport = transportOf(env, channel.folder)
  await transport.writeRevocation(nowOf(env).toISOString())
  dropChannel(env.sqlite, employeeId)
}

export function dropChannel(sqlite: Sqlite, employeeId: number): void {
  ensureBridgeTables(sqlite)
  sqlite.transaction(() => {
    clearShadow(sqlite, employeeId)
    sqlite.prepare('DELETE FROM sync_staff_outbox WHERE employee_id = ?').run(employeeId)
    sqlite.prepare('DELETE FROM sync_staff_channel WHERE employee_id = ?').run(employeeId)
  })()
}

function clearShadow(sqlite: Sqlite, employeeId: number): void {
  sqlite.prepare('DELETE FROM sync_staff_shadow WHERE employee_id = ?').run(employeeId)
  sqlite.prepare('DELETE FROM sync_staff_file WHERE employee_id = ?').run(employeeId)
}

// ---------- the starting point ----------

/**
 * Writes the filtered copy of the database (and the files it refers to) as the starting point
 * of the employee's folder, and takes it as what the employee has.
 */
export async function writeChannelSnapshot(env: BridgeEnv, employee: EmployeeRef): Promise<void> {
  const { sqlite } = env
  const channel = getChannel(sqlite, employee.id)
  if (!channel) throw new Error('Für diesen Mitarbeiter ist hier kein Ordner eingerichtet.')
  const transport = transportOf(env, channel.folder)
  await flushOutbox(env, channel, transport)

  const dir = join(env.workDir, `staff-${employee.id}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const dbFile = join(dir, 'bookingum.db')
  const storage = join(dir, 'storage')
  try {
    // one statement, consistent: the view below is computed from the same state
    const view = computeStaffView(sqlite, contextOf(employee))
    sqlite.prepare('VACUUM INTO ?').run(dbFile)
    const files = await fileShas(env, viewFiles(view))
    filterCopy(dbFile, view, files)
    for (const [path] of files) {
      const source = storagePath(env.storageDir, path)
      const target = storagePath(storage, path)
      if (!source || !target || !existsSync(source)) continue
      await mkdir(dirname(target), { recursive: true })
      await copyFile(source, target)
    }
    mkdirSync(storage, { recursive: true })

    sqlite.transaction(() => {
      clearShadow(sqlite, employee.id)
      const putRow = sqlite.prepare(
        'INSERT INTO sync_staff_shadow (employee_id, tbl, pk, data) VALUES (?, ?, ?, ?)'
      )
      for (const [table, rows] of view)
        for (const [pk, row] of rows) putRow.run(employee.id, table, pk, JSON.stringify(row))
      const putFile = sqlite.prepare(
        'INSERT INTO sync_staff_file (employee_id, path, sha) VALUES (?, ?, ?)'
      )
      for (const [path, sha] of files) putFile.run(employee.id, path, sha)
    })()

    await transport.writeSnapshot(
      {
        format: BATCH_FORMAT,
        device: channel.bridge_id,
        seq: channel.export_seq,
        seen: {},
        schema: env.schema,
        createdAt: nowOf(env).toISOString(),
        appVersion: env.appVersion
      },
      dbFile,
      storage
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Leaves exactly the view in the copied database: hidden rows deleted, hidden references
 * emptied, this computer's local data (mail links and rules, sync bookkeeping, local settings)
 * gone, then vacuumed so nothing deleted can be read from the file.
 */
function filterCopy(dbFile: string, view: StaffView, files: Map<string, string>): void {
  const copy = new Database(dbFile)
  try {
    copy.pragma('foreign_keys = OFF')
    copy.pragma('secure_delete = ON')
    const tables = (
      copy
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'"
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name)
    const synced = new Set(syncedTables(copy))
    copy.transaction(() => {
      for (const table of tables) {
        if (table.startsWith('__')) continue
        if (BRIDGE_TABLES.includes(table)) {
          copy.exec(`DROP TABLE ${q(table)}`)
          continue
        }
        if (table === 'sync_file') {
          const keep = copy.prepare('SELECT path FROM sync_file').all() as Array<{ path: string }>
          const remove = copy.prepare('DELETE FROM sync_file WHERE path = ?')
          for (const { path } of keep) if (!files.has(path)) remove.run(path)
          continue
        }
        if (table.startsWith('sync_') || LOCAL_TABLES.has(table) || !synced.has(table)) {
          if (table !== 'sync_control') copy.exec(`DELETE FROM ${q(table)}`)
          continue
        }
        const rows = view.get(table) ?? new Map<string, Row>()
        const key = keyColumn(table)
        const all = copy.prepare(`SELECT * FROM ${q(table)}`).all() as Row[]
        const remove = copy.prepare(`DELETE FROM ${q(table)} WHERE ${q(key)} = ?`)
        for (const row of all) {
          const shown = rows.get(String(row[key]))
          if (!shown) {
            remove.run(row[key])
            continue
          }
          const emptied = Object.keys(row).filter((c) => row[c] !== null && shown[c] === null)
          if (emptied.length > 0)
            copy
              .prepare(
                `UPDATE ${q(table)} SET ${emptied.map((c) => `${q(c)} = NULL`).join(', ')} WHERE ${q(key)} = ?`
              )
              .run(row[key])
        }
      }
    })()
    copy.exec('VACUUM')
  } finally {
    copy.close()
  }
}

/** The SHA-256 of each existing file, from the sync manifest where it is current */
async function fileShas(env: BridgeEnv, paths: Set<string>): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const known = new Map(
    (
      env.sqlite.prepare('SELECT path, sha, size, mtime FROM sync_file').all() as Array<{
        path: string
        sha: string | null
        size: number
        mtime: number
      }>
    ).map((row) => [row.path, row])
  )
  for (const path of paths) {
    const full = storagePath(env.storageDir, path)
    if (!full) continue
    let info: import('fs').Stats
    try {
      info = await stat(full)
    } catch {
      continue
    }
    const entry = known.get(path)
    if (entry?.sha && entry.size === info.size && entry.mtime === Math.floor(info.mtimeMs))
      result.set(path, entry.sha)
    else result.set(path, await sha256File(full))
  }
  return result
}

// ---------- one run ----------

/** The employee's changes in, then what changed for them out */
export async function runChannel(env: BridgeEnv, employee: EmployeeRef): Promise<ChannelRunResult> {
  const { sqlite } = env
  const result: ChannelRunResult = {
    imported: 0,
    applied: 0,
    refused: 0,
    exported: 0,
    changedHere: false
  }
  let channel = getChannel(sqlite, employee.id)
  if (!channel) return result
  const transport = transportOf(env, channel.folder)
  const at = nowOf(env).toISOString()
  try {
    if (!(await transport.readGroup()))
      throw new Error(`Der Ordner des Mitarbeiters ist nicht erreichbar: ${channel.folder}`)
    channel = await catchUp(env, channel, transport)
    await flushOutbox(env, channel, transport)
    await importChanges(env, employee, channel, transport, result)
    channel = getChannel(sqlite, employee.id)!
    packChanges(env, employee, channel)
    channel = getChannel(sqlite, employee.id)!
    await stageFiles(env, employee, channel, transport)
    result.exported = await flushOutbox(env, channel, transport)
    sqlite
      .prepare(
        'UPDATE sync_staff_channel SET last_run_at = ?, last_error = NULL WHERE employee_id = ?'
      )
      .run(at, employee.id)
  } catch (error) {
    sqlite
      .prepare(
        'UPDATE sync_staff_channel SET last_run_at = ?, last_error = ? WHERE employee_id = ?'
      )
      .run(at, error instanceof Error ? error.message : String(error), employee.id)
  }
  return result
}

/**
 * The folder holds batches of this bridge beyond what this database knows: an older backup was
 * restored here. Numbering goes on after them, and everything is sent again in full (the
 * employee's computer takes rows it has as updates), so nothing gets lost under a reused number.
 */
async function catchUp(
  env: BridgeEnv,
  channel: Channel,
  transport: SyncTransport
): Promise<Channel> {
  const written = await transport.listBatches(channel.bridge_id)
  const top = written[written.length - 1] ?? 0
  if (top <= channel.export_seq) return channel
  const { sqlite } = env
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM sync_staff_outbox WHERE employee_id = ?').run(channel.employee_id)
    clearShadow(sqlite, channel.employee_id)
    sqlite
      .prepare('UPDATE sync_staff_channel SET export_seq = ? WHERE employee_id = ?')
      .run(top, channel.employee_id)
  })()
  return getChannel(sqlite, channel.employee_id)!
}

function shadowOf(sqlite: Sqlite, employeeId: number, table: string, pk: string): Row | null {
  const row = sqlite
    .prepare('SELECT data FROM sync_staff_shadow WHERE employee_id = ? AND tbl = ? AND pk = ?')
    .get(employeeId, table, pk) as { data: string } | undefined
  if (!row) return null
  return (JSON.parse(row.data) as Row | null) ?? null
}

function setShadow(
  sqlite: Sqlite,
  employeeId: number,
  table: string,
  pk: string,
  data: Row | null
): void {
  sqlite
    .prepare(
      'INSERT INTO sync_staff_shadow (employee_id, tbl, pk, data) VALUES (?, ?, ?, ?) ON CONFLICT(employee_id, tbl, pk) DO UPDATE SET data = excluded.data'
    )
    .run(employeeId, table, pk, JSON.stringify(data))
}

async function importChanges(
  env: BridgeEnv,
  employee: EmployeeRef,
  channel: Channel,
  transport: SyncTransport,
  result: ChannelRunResult
): Promise<void> {
  const { sqlite } = env
  const devices = (await transport.listDevices()).filter((d) => d.id !== channel.bridge_id)
  // the first computer that joined is the employee's; a second one would share its id range
  const staff = channel.staff_device
    ? devices.find((d) => d.id === channel.staff_device)
    : devices.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
  if (!staff) return
  if (!channel.staff_device) {
    sqlite
      .prepare('UPDATE sync_staff_channel SET staff_device = ? WHERE employee_id = ?')
      .run(staff.id, employee.id)
  }
  const available = new Set(await transport.listBatches(staff.id))
  const ctx = contextOf(employee)
  let seq = channel.imported_seq
  while (available.has(seq + 1)) {
    const batch = await transport.readBatch(staff.id, seq + 1)
    if (!batch || batch.schema > env.schema) break
    // every file's content must be here before the batch is taken
    const missing = await Promise.all(
      batch.files.filter((f) => f.s).map((f) => transport.hasBlob(f.s!))
    )
    if (missing.includes(false)) break
    const refusedFiles = await importFiles(env, employee, batch.files, transport)
    applyBatch(env, ctx, batch, result)
    result.refused += refusedFiles
    seq = batch.seq
    sqlite
      .prepare(
        'UPDATE sync_staff_channel SET imported_seq = ?, last_change_at = ? WHERE employee_id = ?'
      )
      .run(seq, batch.createdAt, employee.id)
    result.imported++
  }
}

/** Applies the allowed rows of one batch as this computer's own changes */
function applyBatch(
  env: BridgeEnv,
  ctx: StaffContext,
  batch: Batch,
  result: ChannelRunResult
): void {
  const { sqlite } = env
  const schema = new SchemaInfo(sqlite)
  const clock = new HybridClock(env.adminDevice, getMeta(sqlite, 'hlc'))
  const applier = new BatchApplier(sqlite, schema, clock, env.now)
  sqlite.transaction(() => {
    for (const row of batch.rows) {
      const sent = shadowOf(sqlite, ctx.employeeId, row.t, row.k)
      const check = checkStaffChange(sqlite, ctx, row, sent)
      if (!check.ok) {
        // the employee's copy is wrong now: send the row again as it is (or remove it)
        setShadow(sqlite, ctx.employeeId, row.t, row.k, null)
        result.refused++
        sqlite
          .prepare(
            'UPDATE sync_staff_channel SET refused = refused + 1, last_refusal = ? WHERE employee_id = ?'
          )
          .run(`${row.t}: ${check.reason}`, ctx.employeeId)
        continue
      }
      const outcome = applier.apply({ ...batch, rows: [check.row], files: [] }, { record: true })
      result.applied += outcome.applied
      if (outcome.applied > 0) result.changedHere = true
      if (check.row.o === 'd') {
        sqlite
          .prepare('DELETE FROM sync_staff_shadow WHERE employee_id = ? AND tbl = ? AND pk = ?')
          .run(ctx.employeeId, row.t, row.k)
      } else if (check.row.o === 'i') {
        setShadow(sqlite, ctx.employeeId, row.t, row.k, { ...(row.c ?? {}) })
      } else if (sent) {
        setShadow(sqlite, ctx.employeeId, row.t, row.k, { ...sent, ...(row.c ?? {}) })
      }
    }
  })()
}

/**
 * The employee's files: a new file is copied into storage/ (the normal sync takes it to the other
 * admin computers from there). Changing or removing a file of the company is not taken; the file
 * goes back to the employee as it is. Returns how many were refused.
 */
async function importFiles(
  env: BridgeEnv,
  employee: EmployeeRef,
  files: FileChange[],
  transport: SyncTransport
): Promise<number> {
  const { sqlite } = env
  let refused = 0
  const setFile = sqlite.prepare(
    'INSERT INTO sync_staff_file (employee_id, path, sha) VALUES (?, ?, ?) ON CONFLICT(employee_id, path) DO UPDATE SET sha = excluded.sha'
  )
  const forget = sqlite.prepare('DELETE FROM sync_staff_file WHERE employee_id = ? AND path = ?')
  for (const file of files) {
    const full = storagePath(env.storageDir, file.p)
    if (!full) continue
    if (!file.s) {
      forget.run(employee.id, file.p)
      continue
    }
    if (existsSync(full)) {
      const sha = await sha256File(full)
      if (sha === file.s) setFile.run(employee.id, file.p, sha)
      else {
        forget.run(employee.id, file.p)
        refused++
      }
      continue
    }
    if (await transport.getBlob(file.s, full)) setFile.run(employee.id, file.p, file.s)
  }
  return refused
}

/** Compares the view with what the employee has and packs the difference */
function packChanges(env: BridgeEnv, employee: EmployeeRef, channel: Channel): void {
  const { sqlite } = env
  const view = computeStaffView(sqlite, contextOf(employee))
  const shadow = new Map<string, Map<string, Row | null>>()
  for (const row of sqlite
    .prepare('SELECT tbl, pk, data FROM sync_staff_shadow WHERE employee_id = ?')
    .all(employee.id) as Array<{ tbl: string; pk: string; data: string }>) {
    if (!shadow.has(row.tbl)) shadow.set(row.tbl, new Map())
    shadow.get(row.tbl)!.set(row.pk, JSON.parse(row.data) as Row | null)
  }

  const clock = new HybridClock(channel.bridge_id, channel.hlc)
  const adminClock = getMeta(sqlite, 'hlc')
  if (adminClock) clock.receive(adminClock)

  const tables = parentFirstOrder(sqlite, [...new Set([...view.keys(), ...shadow.keys()])])
  const upserts: RowChange[] = []
  const deletes: RowChange[] = []
  // undefined: the employee no longer has the row
  const shadowWrites: Array<[string, string, Row | null | undefined]> = []
  for (const table of tables) {
    const rows = view.get(table) ?? new Map<string, Row>()
    const had = shadow.get(table) ?? new Map<string, Row | null>()
    for (const [pk, row] of rows) {
      const before = had.has(pk) ? had.get(pk)! : undefined
      if (before === undefined || before === null) {
        upserts.push({ t: table, k: pk, o: 'i', h: '', c: row })
        shadowWrites.push([table, pk, row])
        continue
      }
      const changed: Row = {}
      for (const [column, value] of Object.entries(row))
        if (JSON.stringify(before[column]) !== JSON.stringify(value)) changed[column] = value
      if (Object.keys(changed).length > 0) {
        upserts.push({ t: table, k: pk, o: 'u', h: '', c: changed })
        shadowWrites.push([table, pk, row])
      }
    }
    for (const pk of had.keys()) {
      if (rows.has(pk)) continue
      deletes.push({ t: table, k: pk, o: 'd', h: '' })
      shadowWrites.push([table, pk, undefined])
    }
  }
  // children go before their parents when removed
  deletes.reverse()
  const rows = [...upserts, ...deletes].map((row) => ({ ...row, h: clock.tick() }))

  const files = viewFiles(view)
  const sentFiles = new Map(
    (
      sqlite
        .prepare('SELECT path, sha FROM sync_staff_file WHERE employee_id = ?')
        .all(employee.id) as Array<{ path: string; sha: string }>
    ).map((row) => [row.path, row.sha])
  )
  // file contents are hashed when staged (stageFiles); here only removals are known
  const fileRemovals: FileChange[] = []
  for (const path of sentFiles.keys())
    if (!files.has(path)) fileRemovals.push({ p: path, h: clock.tick(), s: null, n: 0 })

  if (rows.length === 0 && fileRemovals.length === 0) return
  sqlite.transaction(() => {
    const remove = sqlite.prepare(
      'DELETE FROM sync_staff_shadow WHERE employee_id = ? AND tbl = ? AND pk = ?'
    )
    for (const [table, pk, data] of shadowWrites) {
      if (data === undefined) remove.run(employee.id, table, pk)
      else setShadow(sqlite, employee.id, table, pk, data)
    }
    const forget = sqlite.prepare('DELETE FROM sync_staff_file WHERE employee_id = ? AND path = ?')
    for (const file of fileRemovals) forget.run(employee.id, file.p)
    enqueue(env, employee.id, channel, clock, rows, fileRemovals)
  })()
}

/** Files the view refers to that the employee does not have in this version yet */
async function stageFiles(
  env: BridgeEnv,
  employee: EmployeeRef,
  channel: Channel,
  transport: SyncTransport
): Promise<void> {
  const { sqlite } = env
  const view = computeStaffView(sqlite, contextOf(employee))
  const sent = new Map(
    (
      sqlite
        .prepare('SELECT path, sha FROM sync_staff_file WHERE employee_id = ?')
        .all(employee.id) as Array<{ path: string; sha: string }>
    ).map((row) => [row.path, row.sha])
  )
  const shas = await fileShas(env, viewFiles(view))
  const changes: FileChange[] = []
  const clock = new HybridClock(channel.bridge_id, channel.hlc)
  for (const [path, sha] of shas) {
    if (sent.get(path) === sha) continue
    const full = storagePath(env.storageDir, path)!
    await transport.putBlob(sha, full)
    const info = await stat(full)
    changes.push({ p: path, h: clock.tick(), s: sha, n: info.size })
  }
  if (changes.length === 0) return
  sqlite.transaction(() => {
    const setFile = sqlite.prepare(
      'INSERT INTO sync_staff_file (employee_id, path, sha) VALUES (?, ?, ?) ON CONFLICT(employee_id, path) DO UPDATE SET sha = excluded.sha'
    )
    for (const file of changes) setFile.run(employee.id, file.p, file.s)
    enqueue(env, employee.id, getChannel(sqlite, employee.id)!, clock, [], changes)
  })()
}

function enqueue(
  env: BridgeEnv,
  employeeId: number,
  channel: Channel,
  clock: HybridClock,
  rows: RowChange[],
  files: FileChange[]
): void {
  const { sqlite } = env
  const seq = channel.export_seq + 1
  const batch: Batch = {
    format: BATCH_FORMAT,
    device: channel.bridge_id,
    seq,
    schema: env.schema,
    createdAt: nowOf(env).toISOString(),
    seen: channel.staff_device ? { [channel.staff_device]: channel.imported_seq } : {},
    rows,
    files
  }
  sqlite
    .prepare('INSERT INTO sync_staff_outbox (employee_id, seq, payload) VALUES (?, ?, ?)')
    .run(employeeId, seq, JSON.stringify(batch))
  sqlite
    .prepare('UPDATE sync_staff_channel SET export_seq = ?, hlc = ? WHERE employee_id = ?')
    .run(seq, clock.current(), employeeId)
}

/** Writes the packed batches into the employee's folder; returns how many went out */
async function flushOutbox(
  env: BridgeEnv,
  channel: Channel,
  transport: SyncTransport
): Promise<number> {
  const rows = env.sqlite
    .prepare('SELECT seq, payload FROM sync_staff_outbox WHERE employee_id = ? ORDER BY seq')
    .all(channel.employee_id) as Array<{ seq: number; payload: string }>
  let written = 0
  for (const row of rows) {
    await transport.writeBatch(JSON.parse(row.payload) as Batch)
    env.sqlite
      .prepare('DELETE FROM sync_staff_outbox WHERE employee_id = ? AND seq = ?')
      .run(channel.employee_id, row.seq)
    written++
  }
  if (written > 0) await writeBridgeDevice(env, transport, channel.bridge_id)
  return written
}
