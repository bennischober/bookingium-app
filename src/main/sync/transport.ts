// ========================================
// Where batches, files and the starting point are exchanged
// ========================================
// The sync engine talks to a SyncTransport only. FolderTransport uses a folder both computers
// see: one synced by Google Drive, OneDrive or Dropbox, or a network share. A server (the
// headquarter one) can implement the same interface later.
//
// Every computer only ever creates files, in its own folder, under names nobody else uses, and
// never changes a file once written: a sync client then never has two versions of one file to
// reconcile. Files are written under a temporary dotted name and renamed when complete, so a
// reader never sees half a file.
import { existsSync } from 'fs'
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { dirname, join } from 'path'
import { parseBatch, type Batch, type DeviceInfo, type SnapshotInfo } from './format'

export type GroupInfo = { app: 'bookingium'; format: number; id: string; createdAt: string }

export type SnapshotRef = { info: SnapshotInfo; id: string }

export interface SyncTransport {
  /** Where it is, for the settings page */
  readonly location: string
  readGroup(): Promise<GroupInfo | null>
  createGroup(group: GroupInfo): Promise<void>
  listDevices(): Promise<DeviceInfo[]>
  writeDevice(info: DeviceInfo): Promise<void>
  /** The numbers of a device's batches that are complete, ascending */
  listBatches(device: string): Promise<number[]>
  readBatch(device: string, seq: number): Promise<Batch | null>
  /** Writes a batch; one already there under that number stays */
  writeBatch(batch: Batch): Promise<void>
  hasBlob(sha: string): Promise<boolean>
  putBlob(sha: string, sourceFile: string): Promise<void>
  /** Copies a file's content to `target`; false when it has not arrived yet */
  getBlob(sha: string, target: string): Promise<boolean>
  writeSnapshot(info: SnapshotInfo, dbFile: string, storageDir: string | null): Promise<void>
  latestSnapshot(): Promise<SnapshotRef | null>
  /** Copies the snapshot's database (bookingum.db) and storage/ into `target` */
  fetchSnapshot(ref: SnapshotRef, target: string): Promise<void>
}

export const GROUP_FILE = 'bookingium-abgleich.json'
const DEVICES = 'geraete'
const DEVICE_FILE = 'geraet.json'
const BATCHES = 'aenderungen'
const BLOBS = 'dateien'
const SNAPSHOTS = 'startstand'
const SNAPSHOT_FILE = 'startstand.json'
const SNAPSHOT_DB = 'bookingum.db'
const SNAPSHOT_STORAGE = 'storage'
const SAFE_NAME = /^[a-z0-9-]+$/
const SHA = /^[0-9a-f]{64}$/

const NOTE = `Bookingium – Abgleich

Dieser Ordner verbindet mehrere Computer mit Bookingium: Jeder legt hier seine
Änderungen ab und holt die der anderen. Bitte nichts darin ändern, löschen oder
verschieben – sonst fehlen den anderen Computern Änderungen.

  geraete/      die Änderungen jedes Computers
  dateien/      Dokumente und Logos
  startstand/   der Datenstand, mit dem ein neuer Computer beginnt

Einrichten: In Bookingium unter Einstellungen › Daten › „Abgleich“ diesen Ordner
wählen.
`

const seqName = (seq: number) => `${String(seq).padStart(10, '0')}.json`

async function writeAtomic(file: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temp = join(dirname(file), `.tmp-${randomUUID()}`)
  await writeFile(temp, content)
  await renameWithRetry(temp, file)
}

/** A sync client briefly holds files it uploads; a rename is retried */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(code)) throw error
      await new Promise((done) => setTimeout(done, 250 * (attempt + 1)))
    }
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf-8')) as T
  } catch {
    return null
  }
}

async function listNames(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder)).filter((name) => !name.startsWith('.'))
  } catch {
    return []
  }
}

export class FolderTransport implements SyncTransport {
  constructor(readonly location: string) {}

  private deviceDir(device: string): string {
    if (!SAFE_NAME.test(device)) throw new Error(`Invalid device id ${device}`)
    return join(this.location, DEVICES, device)
  }

  private blobFile(sha: string): string {
    if (!SHA.test(sha)) throw new Error('Invalid file hash')
    return join(this.location, BLOBS, sha.slice(0, 2), sha)
  }

  async readGroup(): Promise<GroupInfo | null> {
    const group = await readJson<GroupInfo>(join(this.location, GROUP_FILE))
    return group?.app === 'bookingium' ? group : null
  }

  async createGroup(group: GroupInfo): Promise<void> {
    await writeAtomic(join(this.location, GROUP_FILE), JSON.stringify(group, null, 2))
    await writeAtomic(join(this.location, 'LIESMICH.txt'), NOTE)
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const devices: DeviceInfo[] = []
    for (const name of await listNames(join(this.location, DEVICES))) {
      if (!SAFE_NAME.test(name)) continue
      const info = await readJson<DeviceInfo>(join(this.location, DEVICES, name, DEVICE_FILE))
      if (info && info.id === name) devices.push(info)
    }
    return devices
  }

  async writeDevice(info: DeviceInfo): Promise<void> {
    await writeAtomic(join(this.deviceDir(info.id), DEVICE_FILE), JSON.stringify(info, null, 2))
  }

  async listBatches(device: string): Promise<number[]> {
    return (await listNames(join(this.deviceDir(device), BATCHES)))
      .map((name) => /^(\d{10})\.json$/.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]))
      .sort((a, b) => a - b)
  }

  async readBatch(device: string, seq: number): Promise<Batch | null> {
    try {
      const raw = await readFile(join(this.deviceDir(device), BATCHES, seqName(seq)), 'utf-8')
      const batch = parseBatch(raw)
      return batch && batch.device === device && batch.seq === seq ? batch : null
    } catch {
      return null
    }
  }

  async writeBatch(batch: Batch): Promise<void> {
    const file = join(this.deviceDir(batch.device), BATCHES, seqName(batch.seq))
    if (existsSync(file)) return
    await writeAtomic(file, JSON.stringify(batch))
  }

  async hasBlob(sha: string): Promise<boolean> {
    return existsSync(this.blobFile(sha))
  }

  async putBlob(sha: string, sourceFile: string): Promise<void> {
    const file = this.blobFile(sha)
    if (existsSync(file)) return
    await mkdir(dirname(file), { recursive: true })
    const temp = join(dirname(file), `.tmp-${randomUUID()}`)
    await copyFile(sourceFile, temp)
    await renameWithRetry(temp, file)
  }

  async getBlob(sha: string, target: string): Promise<boolean> {
    const file = this.blobFile(sha)
    if (!existsSync(file)) return false
    await mkdir(dirname(target), { recursive: true })
    const temp = join(dirname(target), `.tmp-${randomUUID()}`)
    try {
      await copyFile(file, temp)
      await renameWithRetry(temp, target)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {})
      throw error
    }
    return true
  }

  async writeSnapshot(
    info: SnapshotInfo,
    dbFile: string,
    storageDir: string | null
  ): Promise<void> {
    const parent = join(this.location, SNAPSHOTS)
    const name = `${info.device}-${info.createdAt.replace(/[^0-9]/g, '').slice(0, 14)}`
    const temp = join(parent, `.unfertig-${randomUUID()}`)
    await mkdir(temp, { recursive: true })
    try {
      await copyFile(dbFile, join(temp, SNAPSHOT_DB))
      if (storageDir && existsSync(storageDir))
        await cp(storageDir, join(temp, SNAPSHOT_STORAGE), { recursive: true })
      await writeFile(join(temp, SNAPSHOT_FILE), JSON.stringify(info, null, 2))
      await renameWithRetry(temp, join(parent, name))
    } catch (error) {
      await rm(temp, { recursive: true, force: true }).catch(() => {})
      throw error
    }
    // Older starting points of this device are no longer needed
    for (const other of await listNames(parent)) {
      if (other !== name && other.startsWith(`${info.device}-`))
        await rm(join(parent, other), { recursive: true, force: true }).catch(() => {})
    }
  }

  async latestSnapshot(): Promise<SnapshotRef | null> {
    const parent = join(this.location, SNAPSHOTS)
    let latest: SnapshotRef | null = null
    for (const name of await listNames(parent)) {
      const info = await readJson<SnapshotInfo>(join(parent, name, SNAPSHOT_FILE))
      if (!info || !existsSync(join(parent, name, SNAPSHOT_DB))) continue
      if (!latest || info.createdAt > latest.info.createdAt) latest = { info, id: name }
    }
    return latest
  }

  async fetchSnapshot(ref: SnapshotRef, target: string): Promise<void> {
    const folder = join(this.location, SNAPSHOTS, ref.id)
    await mkdir(target, { recursive: true })
    await copyFile(join(folder, SNAPSHOT_DB), join(target, SNAPSHOT_DB))
    if (existsSync(join(folder, SNAPSHOT_STORAGE)))
      await cp(join(folder, SNAPSHOT_STORAGE), join(target, SNAPSHOT_STORAGE), { recursive: true })
  }
}
