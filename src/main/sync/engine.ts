// ========================================
// One sync run, and setting up the first computer
// ========================================
// No Electron here: the caller passes the database, the transport and the storage folder, so
// tests run two "computers" against temp folders.
import { randomBytes } from 'crypto'
import { existsSync, rmSync } from 'fs'
import { BatchApplier } from './incoming'
import { HybridClock } from './hlc'
import { configureRowIds, idRange, randomPrefix } from './ids'
import { packOutgoing } from './outgoing'
import { applyPendingFiles, scanStorage } from './storageFiles'
import {
  SchemaInfo,
  createBookkeeping,
  getMeta,
  getPeers,
  hasBookkeeping,
  highestIdInRange,
  installSyncTriggers,
  setMeta,
  setPeer,
  type Sqlite
} from './store'
import { BATCH_FORMAT, type DeviceInfo, type SnapshotInfo } from './format'
import type { SyncTransport } from './transport'

export type EngineOptions = {
  sqlite: Sqlite
  transport: SyncTransport
  storageDir: string
  /** created_at of the newest migration this app knows */
  schema: number
  appVersion: string
  deviceName: string
  /** Removes a file another computer deleted (the app moves it to the trash) */
  removeFile: (file: string) => Promise<void>
  now?: () => Date
}

export type RunResult = {
  /** Batches of other computers applied */
  imported: number
  /** Rows they changed here */
  applied: number
  conflicts: number
  /** Batches written for the others */
  exported: number
  /** Files whose content has not arrived in the shared folder yet */
  waitingFiles: number
  /** Another computer runs a newer version; its batches wait until this one is updated */
  newerVersionElsewhere: boolean
  /** Something changed here from elsewhere (the windows refresh) */
  changedHere: boolean
}

export const newDeviceId = () => randomBytes(6).toString('hex')

export class SyncEngine {
  private sqlite: Sqlite
  private transport: SyncTransport
  private now: () => Date
  private announced = false

  constructor(private options: EngineOptions) {
    this.sqlite = options.sqlite
    this.transport = options.transport
    this.now = options.now ?? (() => new Date())
  }

  get deviceId(): string {
    const id = getMeta(this.sqlite, 'device_id')
    if (!id) throw new Error('Sync is not set up in this database')
    return id
  }

  get prefix(): number {
    return Number(getMeta(this.sqlite, 'id_prefix') ?? '0')
  }

  get exportSeq(): number {
    return Number(getMeta(this.sqlite, 'export_seq') ?? '0')
  }

  private clock(): HybridClock {
    return new HybridClock(this.deviceId, getMeta(this.sqlite, 'hlc'), () => this.now().getTime())
  }

  /** Triggers on, ids from this computer's range. Called at every start once the schema is final */
  activate(): void {
    createBookkeeping(this.sqlite)
    installSyncTriggers(this.sqlite)
    this.useRowIds()
  }

  /** New rows take ids from this computer's range */
  useRowIds(): void {
    const { first, last } = idRange(this.prefix)
    configureRowIds({ prefix: this.prefix, highest: highestIdInRange(this.sqlite, first, last) })
  }

  /** Gives this database a new identity in the group (see SyncService.verifyIdentity) */
  async reidentify(): Promise<{ previous: string; device: string }> {
    const previous = this.deviceId
    // batches packed under the old identity go out first, as far as not already there
    await this.flushOutbox()
    const taken = (await this.transport.listDevices()).map((d) => d.prefix)
    const device = newDeviceId()
    const prefix = randomPrefix([...taken, this.prefix])
    this.sqlite.transaction(() => {
      // the old identity's later batches (if any) come back in like another computer's
      setPeer(this.sqlite, previous, this.exportSeq)
      this.sqlite.exec(
        'DELETE FROM sync_change; DELETE FROM sync_file_change; DELETE FROM sync_outbox'
      )
      setMeta(this.sqlite, 'device_id', device)
      setMeta(this.sqlite, 'id_prefix', prefix)
      setMeta(this.sqlite, 'export_seq', 0)
    })()
    await this.writeDeviceInfo()
    this.activate()
    return { previous, device }
  }

  async writeDeviceInfo(): Promise<void> {
    const info: DeviceInfo = {
      id: this.deviceId,
      name: this.options.deviceName,
      prefix: this.prefix,
      createdAt: getMeta(this.sqlite, 'created_at') ?? this.now().toISOString(),
      appVersion: this.options.appVersion
    }
    await this.transport.writeDevice(info)
  }

  /**
   * One run: local file changes, the others' batches, their files, then this computer's changes
   * out. A run never applies half a batch; a failing write leaves the batch in the outbox.
   */
  async run(): Promise<RunResult> {
    const result: RunResult = {
      imported: 0,
      applied: 0,
      conflicts: 0,
      exported: 0,
      waitingFiles: 0,
      newerVersionElsewhere: false,
      changedHere: false
    }
    // the others find this computer by its device file (after a join or a new identity)
    // #243: and again when its entry was removed from the folder as an earlier one
    if (!this.announced || !(await this.transport.hasDevice(this.deviceId))) {
      await this.writeDeviceInfo()
      this.announced = true
    }
    const clock = this.clock()
    await scanStorage(this.sqlite, this.options.storageDir, clock, this.transport)
    setMeta(this.sqlite, 'hlc', clock.current())

    await this.importBatches(result)

    const files = await applyPendingFiles(
      this.sqlite,
      this.options.storageDir,
      this.transport,
      this.options.removeFile
    )
    result.waitingFiles = files.waiting
    if (files.written + files.removed > 0) result.changedHere = true

    const exportClock = this.clock()
    packOutgoing(this.sqlite, exportClock, this.deviceId, this.options.schema, this.now())
    result.exported = await this.flushOutbox()
    return result
  }

  private async importBatches(result: RunResult): Promise<void> {
    const self = this.deviceId
    const devices = (await this.transport.listDevices())
      .map((d) => d.id)
      .filter((id) => id !== self)
    const imported = getPeers(this.sqlite)
    const available = new Map<string, Set<number>>()
    for (const device of devices)
      available.set(device, new Set(await this.transport.listBatches(device)))
    const known = new Set(devices)
    const blocked = new Set<string>()
    const schema = new SchemaInfo(this.sqlite)
    const clock = this.clock()
    const applier = new BatchApplier(this.sqlite, schema, clock, this.now)

    for (let progress = true; progress; ) {
      progress = false
      for (const device of devices) {
        if (blocked.has(device)) continue
        const next = (imported.get(device) ?? 0) + 1
        if (!available.get(device)?.has(next)) continue
        const batch = await this.transport.readBatch(device, next)
        if (!batch) {
          blocked.add(device)
          continue
        }
        if (batch.schema > this.options.schema) {
          result.newerVersionElsewhere = true
          blocked.add(device)
          continue
        }
        // causal order: what the batch builds on must be here first
        const waiting = Object.entries(batch.seen).some(
          ([other, seq]) => other !== self && known.has(other) && (imported.get(other) ?? 0) < seq
        )
        if (waiting) continue
        const outcome = applier.apply(batch)
        imported.set(device, next)
        result.imported++
        result.applied += outcome.applied
        result.conflicts += outcome.conflicts
        if (outcome.applied > 0 || batch.files.length > 0) result.changedHere = true
        progress = true
      }
    }
  }

  /** Writes the packed batches to the transport; returns how many went out */
  async flushOutbox(): Promise<number> {
    const rows = this.sqlite
      .prepare('SELECT seq, payload FROM sync_outbox ORDER BY seq')
      .all() as Array<{
      seq: number
      payload: string
    }>
    let written = 0
    for (const row of rows) {
      await this.transport.writeBatch(JSON.parse(row.payload))
      this.sqlite.prepare('DELETE FROM sync_outbox WHERE seq = ?').run(row.seq)
      written++
    }
    return written
  }

  /**
   * Writes this computer's full data as the starting point a new computer joins from. Everything
   * packed before is contained; the joiner continues after `seq`.
   */
  async writeSnapshot(tempFile: string): Promise<SnapshotInfo> {
    const clock = this.clock()
    await scanStorage(this.sqlite, this.options.storageDir, clock, this.transport)
    setMeta(this.sqlite, 'hlc', clock.current())
    packOutgoing(this.sqlite, this.clock(), this.deviceId, this.options.schema, this.now())
    await this.flushOutbox()
    if (existsSync(tempFile)) rmSync(tempFile)
    const info: SnapshotInfo = {
      format: BATCH_FORMAT,
      device: this.deviceId,
      seq: this.exportSeq,
      seen: Object.fromEntries(getPeers(this.sqlite)),
      schema: this.options.schema,
      createdAt: this.now().toISOString(),
      appVersion: this.options.appVersion
    }
    // one statement: consistent, and nothing can write in between (better-sqlite3 is synchronous)
    this.sqlite.prepare('VACUUM INTO ?').run(tempFile)
    try {
      await this.transport.writeSnapshot(info, tempFile, this.options.storageDir)
    } finally {
      rmSync(tempFile, { force: true })
    }
    return info
  }
}

/**
 * The first computer: makes the shared folder a sync group and this database its first member,
 * then writes the starting point the others join from.
 */
export async function createGroup(
  options: EngineOptions,
  snapshotTemp: string
): Promise<SyncEngine> {
  const { sqlite, transport } = options
  const now = options.now?.() ?? new Date()
  if (await transport.readGroup())
    throw new Error(
      'In diesem Ordner ist schon ein Abgleich eingerichtet. Bitte „Beitreten“ wählen.'
    )
  if (hasBookkeeping(sqlite) && getMeta(sqlite, 'device_id'))
    throw new Error('Auf diesem Computer ist der Abgleich schon eingerichtet.')
  createBookkeeping(sqlite)
  const device = newDeviceId()
  sqlite.transaction(() => {
    setMeta(sqlite, 'device_id', device)
    setMeta(sqlite, 'id_prefix', randomPrefix([]))
    setMeta(sqlite, 'export_seq', 0)
    setMeta(sqlite, 'created_at', now.toISOString())
  })()
  const engine = new SyncEngine(options)
  engine.activate()
  // what is there now is in the starting point, so it is not reported as changed
  await scanStorage(sqlite, options.storageDir, new HybridClock(device, null), null, {
    register: true
  })
  await transport.createGroup({
    app: 'bookingium',
    format: BATCH_FORMAT,
    id: newDeviceId(),
    createdAt: now.toISOString()
  })
  await engine.writeDeviceInfo()
  await engine.writeSnapshot(snapshotTemp)
  return engine
}
