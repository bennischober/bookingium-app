// ========================================
// Documents and logos (storage/) between computers
// ========================================
// The files are not tied to table rows here: storage/ is compared with what the sync last saw
// (sync_file), and every new, changed or removed file becomes a file change in the next batch.
// The content goes to the shared folder once, named by its SHA-256, so a file only ever travels
// once however often it is referenced. A file from elsewhere is copied in when its content has
// arrived in the shared folder; until then it waits in sync_file_pending.
import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join, relative, resolve, sep } from 'path'
import type { HybridClock } from './hlc'
import type { SyncTransport } from './transport'
import type { Sqlite } from './store'

type ManifestRow = { path: string; sha: string | null; size: number; mtime: number; hlc: string }

export function sha256File(file: string): Promise<string> {
  return new Promise((done, fail) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', fail)
      .on('end', () => done(hash.digest('hex')))
  })
}

/** Files below `root` as forward-slash paths relative to it; dotted (temporary) names are skipped */
export async function listStorageFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const walk = async (folder: string) => {
    let entries: import('fs').Dirent[]
    try {
      entries = await readdir(folder, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(folder, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) files.push(relative(root, full).split(sep).join('/'))
    }
  }
  await walk(root)
  return files.sort()
}

/** The absolute path of a storage path, null when it would leave the storage folder */
export function storagePath(root: string, path: string): string | null {
  if (!path || path.includes('\0') || path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return null
  const full = resolve(root, ...path.split('/'))
  const base = resolve(root)
  return full.startsWith(base + sep) ? full : null
}

function manifest(sqlite: Sqlite): Map<string, ManifestRow> {
  const rows = sqlite
    .prepare('SELECT path, sha, size, mtime, hlc FROM sync_file')
    .all() as ManifestRow[]
  return new Map(rows.map((row) => [row.path, row]))
}

const upsertManifest = (sqlite: Sqlite, row: ManifestRow) =>
  sqlite
    .prepare(
      'INSERT INTO sync_file (path, sha, size, mtime, hlc) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET sha = excluded.sha, size = excluded.size, mtime = excluded.mtime, hlc = excluded.hlc'
    )
    .run(row.path, row.sha, row.size, row.mtime, row.hlc)

export type ScanOptions = {
  /** Record what is there without reporting it as changed (the data it came with already has it) */
  register?: boolean
}

/**
 * Compares storage/ with the manifest. Changed files go to the shared folder first, then into
 * sync_file_change for the next batch. Returns the number of changes found.
 */
export async function scanStorage(
  sqlite: Sqlite,
  root: string,
  clock: HybridClock,
  transport: SyncTransport | null,
  options: ScanOptions = {}
): Promise<number> {
  const known = manifest(sqlite)
  const onDisk = new Set<string>()
  let changes = 0
  for (const path of await listStorageFiles(root)) {
    onDisk.add(path)
    const full = join(root, ...path.split('/'))
    let info: import('fs').Stats
    try {
      info = await stat(full)
    } catch {
      continue
    }
    const mtime = Math.floor(info.mtimeMs)
    const entry = known.get(path)
    if (entry?.sha && entry.size === info.size && entry.mtime === mtime) continue
    const sha = await sha256File(full)
    if (entry?.sha === sha) {
      upsertManifest(sqlite, { ...entry, size: info.size, mtime })
      continue
    }
    if (options.register) {
      upsertManifest(sqlite, { path, sha, size: info.size, mtime, hlc: entry?.hlc ?? '' })
      continue
    }
    if (transport) await transport.putBlob(sha, full)
    sqlite.transaction(() => {
      const h = clock.tick()
      upsertManifest(sqlite, { path, sha, size: info.size, mtime, hlc: h })
      sqlite
        .prepare('INSERT INTO sync_file_change (path, sha, size, hlc) VALUES (?, ?, ?, ?)')
        .run(path, sha, info.size, h)
    })()
    changes++
  }
  for (const entry of known.values()) {
    if (!entry.sha || onDisk.has(entry.path)) continue
    if (options.register) {
      sqlite.prepare('DELETE FROM sync_file WHERE path = ?').run(entry.path)
      continue
    }
    sqlite.transaction(() => {
      const h = clock.tick()
      upsertManifest(sqlite, { path: entry.path, sha: null, size: 0, mtime: 0, hlc: h })
      sqlite
        .prepare('INSERT INTO sync_file_change (path, sha, size, hlc) VALUES (?, NULL, 0, ?)')
        .run(entry.path, h)
    })()
    changes++
  }
  return changes
}

export type PendingResult = { written: number; removed: number; waiting: number }

/**
 * Brings the files changed elsewhere into storage/: copies the content in, or removes the file
 * (`removeFile`, the app moves it to the trash). A change older than the local state of the
 * path is dropped. Content not yet in the shared folder stays pending for the next run.
 */
export async function applyPendingFiles(
  sqlite: Sqlite,
  root: string,
  transport: SyncTransport,
  removeFile: (file: string) => Promise<void>
): Promise<PendingResult> {
  const pending = sqlite.prepare('SELECT path, sha, hlc FROM sync_file_pending').all() as Array<{
    path: string
    sha: string
    hlc: string
  }>
  const known = manifest(sqlite)
  const done = sqlite.prepare('DELETE FROM sync_file_pending WHERE path = ? AND hlc = ?')
  const result: PendingResult = { written: 0, removed: 0, waiting: 0 }
  for (const change of pending) {
    const entry = known.get(change.path)
    const full = storagePath(root, change.path)
    if (!full || (entry && entry.hlc >= change.hlc)) {
      done.run(change.path, change.hlc)
      continue
    }
    if (!change.sha) {
      try {
        await stat(full)
        await removeFile(full)
        result.removed++
      } catch {
        // already gone
      }
      upsertManifest(sqlite, { path: change.path, sha: null, size: 0, mtime: 0, hlc: change.hlc })
      done.run(change.path, change.hlc)
      continue
    }
    if (entry?.sha !== change.sha) {
      if (!(await transport.getBlob(change.sha, full))) {
        result.waiting++
        continue
      }
      result.written++
    }
    const info = await stat(full)
    upsertManifest(sqlite, {
      path: change.path,
      sha: change.sha,
      size: info.size,
      mtime: Math.floor(info.mtimeMs),
      hlc: change.hlc
    })
    done.run(change.path, change.hlc)
  }
  return result
}
