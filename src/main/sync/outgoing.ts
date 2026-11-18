// ========================================
// Packing local changes into a batch
// ========================================
import type { Batch, FileChange, RowChange } from './format'
import { BATCH_FORMAT } from './format'
import type { HybridClock } from './hlc'
import { getMeta, getPeers, setMeta, type Sqlite } from './store'

type ChangeRow = {
  seq: number
  tbl: string
  pk: string
  op: 'i' | 'u' | 'd'
  old: string | null
  new: string | null
}

type FileChangeRow = { seq: number; path: string; sha: string | null; size: number; hlc: string }

const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/**
 * Turns the changes the triggers logged (and the file changes the storage scan found) into the
 * next batch in sync_outbox, stamping each with the clock and recording the field clocks and
 * tombstones the merge of later incoming changes compares against. Returns the batch's number,
 * null when there was nothing to pack.
 */
export function packOutgoing(
  sqlite: Sqlite,
  clock: HybridClock,
  device: string,
  schema: number,
  now = new Date()
): number | null {
  return sqlite.transaction(() => {
    const changes = sqlite
      .prepare('SELECT seq, tbl, pk, op, old, new FROM sync_change ORDER BY seq')
      .all() as ChangeRow[]
    const fileChanges = sqlite
      .prepare('SELECT seq, path, sha, size, hlc FROM sync_file_change ORDER BY seq')
      .all() as FileChangeRow[]
    if (changes.length === 0 && fileChanges.length === 0) return null

    const clearClocks = sqlite.prepare('DELETE FROM sync_clock WHERE tbl = ? AND pk = ?')
    const setClock = sqlite.prepare(
      'INSERT INTO sync_clock (tbl, pk, col, hlc) VALUES (?, ?, ?, ?) ON CONFLICT(tbl, pk, col) DO UPDATE SET hlc = excluded.hlc'
    )
    const setTomb = sqlite.prepare(
      'INSERT INTO sync_tomb (tbl, pk, hlc) VALUES (?, ?, ?) ON CONFLICT(tbl, pk) DO UPDATE SET hlc = excluded.hlc'
    )
    const clearTomb = sqlite.prepare('DELETE FROM sync_tomb WHERE tbl = ? AND pk = ?')

    const rows: RowChange[] = []
    for (const change of changes) {
      if (change.op === 'i') {
        const h = clock.tick()
        rows.push({ t: change.tbl, k: change.pk, o: 'i', h, c: JSON.parse(change.new ?? '{}') })
        clearClocks.run(change.tbl, change.pk)
        clearTomb.run(change.tbl, change.pk)
        setClock.run(change.tbl, change.pk, '*', h)
      } else if (change.op === 'u') {
        const before = JSON.parse(change.old ?? '{}') as Record<string, unknown>
        const after = JSON.parse(change.new ?? '{}') as Record<string, unknown>
        const changed: Record<string, unknown> = {}
        for (const [column, value] of Object.entries(after)) {
          if (!sameValue(before[column], value)) changed[column] = value
        }
        if (Object.keys(changed).length === 0) continue
        const h = clock.tick()
        rows.push({ t: change.tbl, k: change.pk, o: 'u', h, c: changed })
        for (const column of Object.keys(changed)) setClock.run(change.tbl, change.pk, column, h)
      } else {
        const h = clock.tick()
        rows.push({ t: change.tbl, k: change.pk, o: 'd', h })
        clearClocks.run(change.tbl, change.pk)
        setTomb.run(change.tbl, change.pk, h)
      }
    }
    const files: FileChange[] = fileChanges.map((f) => ({
      p: f.path,
      h: f.hlc,
      s: f.sha,
      n: f.size
    }))

    const lastChange = changes.at(-1)?.seq
    if (lastChange !== undefined)
      sqlite.prepare('DELETE FROM sync_change WHERE seq <= ?').run(lastChange)
    const lastFile = fileChanges.at(-1)?.seq
    if (lastFile !== undefined)
      sqlite.prepare('DELETE FROM sync_file_change WHERE seq <= ?').run(lastFile)
    setMeta(sqlite, 'hlc', clock.current())
    if (rows.length === 0 && files.length === 0) return null

    const seq = Number(getMeta(sqlite, 'export_seq') ?? '0') + 1
    const batch: Batch = {
      format: BATCH_FORMAT,
      device,
      seq,
      schema,
      createdAt: now.toISOString(),
      seen: Object.fromEntries(getPeers(sqlite)),
      rows,
      files
    }
    sqlite
      .prepare('INSERT INTO sync_outbox (seq, payload) VALUES (?, ?)')
      .run(seq, JSON.stringify(batch))
    setMeta(sqlite, 'export_seq', seq)
    return seq
  })()
}
