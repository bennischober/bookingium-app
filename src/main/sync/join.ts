// ========================================
// Joining a group: the starting point, merged with this computer's data, staged as a restore
// ========================================
// The result replaces this computer's data at the next start, exactly like restoring a backup
// (backup/files.ts applyStagedRestore): before that, the current state is backed up, so joining
// can be undone by restoring that backup.
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { configureRowIds, randomPrefix, rowIdsActive } from './ids'
import { mergeLocalData, type MergeStats } from './merge'
import { newDeviceId } from './engine'
import {
  createBookkeeping,
  dropSyncTriggers,
  installSyncTriggers,
  setMeta,
  setPeer,
  type Sqlite
} from './store'
import type { SyncTransport } from './transport'
import { isLocalSettingKey } from './tables'
import { clearBridgeTables } from '../staff/bridge'

export type JoinOptions = {
  transport: SyncTransport
  /** This computer's live database */
  liveSqlite: Sqlite
  liveStorage: string
  /** The local work folder (backup/), where the restore is staged */
  workDir: string
  /** created_at of the newest migration this app knows */
  schema: number
  /** Brings an older starting point to this app's schema */
  migrate: (sqlite: Sqlite) => void
  now?: () => Date
}

export type PreparedJoin = {
  device: string
  /** The computer the starting point came from */
  from: string
  snapshotCreatedAt: string
  stats: MergeStats
}

const JOIN_DIR = 'sync-join'
/** The folder backup/files.ts prepareRestore fills; stageRestore takes it from there */
const RESTORE_INCOMING = 'restore-incoming'

export const NEWER_SNAPSHOT_MESSAGE =
  'Der andere Computer hat eine neuere Version von Bookingium. Bitte zuerst Bookingium auf diesem Computer aktualisieren.'

/**
 * Builds this computer's data as a member of the group in backup/restore-incoming, ready for
 * BackupService.confirmRestore. Nothing live is changed.
 */
export async function prepareJoin(options: JoinOptions): Promise<PreparedJoin> {
  const { transport, workDir } = options
  const now = options.now?.() ?? new Date()
  const group = await transport.readGroup()
  if (!group) throw new Error('In diesem Ordner ist noch kein Abgleich eingerichtet.')
  // #262: an employee's folder (served by an admin computer, staff/bridge.ts)
  const staffPrefix = group.kind === 'staff' ? (group.staffPrefix ?? null) : null
  const snapshot = await transport.latestSnapshot()
  if (!snapshot)
    throw new Error(
      'Der Startstand der anderen Computer ist noch nicht in diesem Ordner angekommen. Bitte warten, bis OneDrive bzw. Google Drive fertig ist, und es dann noch einmal versuchen.'
    )
  if (snapshot.info.schema > options.schema) throw new Error(NEWER_SNAPSHOT_MESSAGE)

  const dir = join(workDir, JOIN_DIR)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  await transport.fetchSnapshot(snapshot, dir)
  const targetFile = join(dir, 'bookingum.db')
  const targetStorage = join(dir, 'storage')
  mkdirSync(targetStorage, { recursive: true })
  const localFile = join(dir, 'local.db')
  options.liveSqlite.prepare('VACUUM INTO ?').run(localFile)

  const taken = (await transport.listDevices()).map((d) => d.prefix)
  const device = newDeviceId()
  const wasActive = rowIdsActive()
  if (wasActive) throw new Error('Auf diesem Computer ist der Abgleich schon eingerichtet.')

  const target = new Database(targetFile)
  let stats: MergeStats
  try {
    dropSyncTriggers(target)
    if (snapshot.info.schema < options.schema) options.migrate(target)
    createBookkeeping(target)
    // the id ranges of the employees' computers are taken too (#262)
    const prefix = staffPrefix ?? randomPrefix([...taken, ...employeePrefixes(target)])
    // the other computer's staff bridges are its own
    clearBridgeTables(target)
    target.transaction(() => {
      // the other computer's unsent work and notes are not this one's
      target.exec(
        'DELETE FROM sync_change; DELETE FROM sync_outbox; DELETE FROM sync_conflict; DELETE FROM sync_file_change; DELETE FROM sync_file_pending'
      )
      setMeta(target, 'device_id', device)
      setMeta(target, 'id_prefix', prefix)
      setMeta(target, 'export_seq', 0)
      setMeta(target, 'created_at', now.toISOString())
      for (const [other, seq] of Object.entries(snapshot.info.seen)) setPeer(target, other, seq)
      setPeer(target, snapshot.info.device, snapshot.info.seq)
    })()
    installSyncTriggers(target)
    configureRowIds({ prefix, highest: 0 })
    try {
      stats =
        staffPrefix !== null
          ? carryStaffComputer(target, localFile)
          : await mergeLocalData({
              target,
              localFile,
              localStorage: options.liveStorage,
              targetStorage
            })
    } finally {
      configureRowIds(null)
    }
    const check = target.pragma('foreign_key_check') as unknown[]
    if (check.length > 0)
      throw new Error(`Zusammenführen ergab ${check.length} ungültige Verweise.`)
  } finally {
    target.close()
    rmSync(localFile, { force: true })
  }

  const incoming = join(workDir, RESTORE_INCOMING)
  rmSync(incoming, { recursive: true, force: true })
  mkdirSync(incoming, { recursive: true })
  renameSync(targetFile, join(incoming, 'bookingum.db'))
  renameSync(targetStorage, join(incoming, 'storage'))
  writeFileSync(
    join(incoming, 'restore.json'),
    JSON.stringify(
      { source: transport.location, backupCreatedAt: snapshot.info.createdAt, hasStorage: true },
      null,
      2
    )
  )
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  return { device, from: snapshot.info.device, snapshotCreatedAt: snapshot.info.createdAt, stats }
}

/** The id ranges given to employees' computers (#262), from the group's data */
function employeePrefixes(target: Sqlite): number[] {
  try {
    return (
      target.prepare('SELECT id_prefix FROM employee').all() as Array<{ id_prefix: number }>
    ).map((row) => row.id_prefix)
  } catch {
    // a starting point from before employees existed
    return []
  }
}

/**
 * #262: an employee's computer joining its folder. It brings nothing of its own into the
 * company's data: only this computer's local settings stay, and it becomes a staff computer
 * (AccessService: locked, cannot be unlocked).
 */
function carryStaffComputer(target: Sqlite, localFile: string): MergeStats {
  target.prepare('ATTACH DATABASE ? AS loc').run(localFile)
  try {
    target.transaction(() => {
      const rows = target.prepare('SELECT key, value FROM loc.app_setting').all() as Array<{
        key: string
        value: string
      }>
      const put = target.prepare(
        'INSERT INTO main.app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      for (const row of rows) if (isLocalSettingKey(row.key)) put.run(row.key, row.value)
      put.run('staffMode', 'true')
      put.run('staffDevice', 'true')
      put.run('staffPin', '""')
    })()
  } finally {
    target.exec('DETACH DATABASE loc')
  }
  return {}
}
