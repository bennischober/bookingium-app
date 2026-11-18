// ========================================
// What computers exchange through the shared folder
// ========================================

export const BATCH_FORMAT = 1

/** One row change. `c`: all columns for an insert, the changed ones for an update */
export type RowChange = {
  /** table */
  t: string
  /** row key (id or text key), as text */
  k: string
  /** insert, update, delete */
  o: 'i' | 'u' | 'd'
  /** hybrid logical timestamp */
  h: string
  c?: Record<string, unknown>
}

/** A file under storage/ that was written (`s` = its SHA-256) or removed (`s` = null) */
export type FileChange = { p: string; h: string; s: string | null; n: number }

/**
 * A batch of one computer's changes. Batches of a device are numbered 1, 2, 3... without gaps
 * and applied in that order. `seen`: how far this device had applied the others' batches when it
 * wrote this one; a batch is only applied once those are applied too, so a change never arrives
 * before the one it builds on (a band member before the band created on the third computer).
 */
export type Batch = {
  format: number
  device: string
  seq: number
  /** created_at of the newest migration of the writing app: which columns it knows */
  schema: number
  createdAt: string
  seen: Record<string, number>
  rows: RowChange[]
  files: FileChange[]
}

export function parseBatch(raw: string): Batch | null {
  try {
    const value = JSON.parse(raw) as Partial<Batch>
    if (
      value.format !== BATCH_FORMAT ||
      typeof value.device !== 'string' ||
      typeof value.seq !== 'number' ||
      typeof value.schema !== 'number' ||
      !Array.isArray(value.rows) ||
      !Array.isArray(value.files) ||
      typeof value.seen !== 'object' ||
      value.seen === null
    )
      return null
    return value as Batch
  } catch {
    return null
  }
}

/** Describes a device in the shared folder */
export type DeviceInfo = {
  id: string
  /** The computer's name, for the settings page */
  name: string
  /** Its id range (ids.ts) */
  prefix: number
  createdAt: string
  appVersion: string
}

/** The starting point a computer joins from: a full copy of one computer's data */
export type SnapshotInfo = {
  format: number
  device: string
  /** The device's batches up to this one are contained */
  seq: number
  /** Batches of the other devices contained (that device's sync_peer) */
  seen: Record<string, number>
  schema: number
  createdAt: string
  appVersion: string
}
