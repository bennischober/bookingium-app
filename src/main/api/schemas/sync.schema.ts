import { z } from 'zod'

// ========================================
// Sync between computers (Einstellungen › Daten › Abgleich)
// ========================================
// Settings and status are machine-local (sync/state.json in the data folder); see
// src/main/services/SyncService.ts and docs/ARCHITECTURE.md "Sync".

export const SyncDeviceDto = z.object({
  id: z.string(),
  name: z.string(),
  // this computer
  self: z.boolean(),
  appVersion: z.string(),
  // when it joined (ISO)
  createdAt: z.string(),
  // when it last put changes into the folder (ISO), null for never
  lastBatchAt: z.string().nullable(),
  // its last sign in the folder (ISO): the newer of its last run and its last changes; null when
  // it never wrote one (versions before 1.7 wrote no lastSeenAt)
  lastSeenAt: z.string().nullable(),
  // a newer entry of a computer with the same name exists (it joined again, e.g. after a
  // reinstall or a restored backup): this one is no longer used
  superseded: z.boolean()
})
export type SyncDeviceDto = z.infer<typeof SyncDeviceDto>

export const SyncConflictDto = z.object({
  id: z.number(),
  at: z.string(),
  message: z.string()
})
export type SyncConflictDto = z.infer<typeof SyncConflictDto>

export const SyncStatusDto = z.object({
  enabled: z.boolean(),
  // syncing in this session (false until the start check ran, or after an error at start)
  active: z.boolean(),
  // '' when none is chosen
  folder: z.string(),
  deviceId: z.string().nullable(),
  running: z.boolean(),
  lastRunAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  // null when the last run worked
  lastError: z.string().nullable(),
  // another computer runs a newer version; its changes wait for an update here
  newerVersionElsewhere: z.boolean(),
  // files whose content has not arrived in the shared folder yet
  waitingFiles: z.number(),
  // local changes not yet in the shared folder
  pendingChanges: z.number(),
  // a restored backup gave this computer a new identity (ISO), null otherwise
  reidentifiedAt: z.string().nullable(),
  devices: z.array(SyncDeviceDto),
  // newest first, at most 20
  conflicts: z.array(SyncConflictDto),
  // not syncing yet: sync groups found in this computer's OneDrive, Google Drive or Dropbox
  suggestions: z.array(z.lazy(() => SyncFolderDto)).default([])
})
export type SyncStatusDto = z.infer<typeof SyncStatusDto>

/** What the top bar shows, cheap to ask every few seconds (no folder reading) */
export const SyncBriefDto = z.object({
  enabled: z.boolean(),
  active: z.boolean(),
  running: z.boolean(),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
  pendingChanges: z.number(),
  // the first sync group found in a cloud folder while not syncing, '' for none
  suggestedFolder: z.string()
})
export type SyncBriefDto = z.infer<typeof SyncBriefDto>

export const SyncFolderDto = z.object({
  folder: z.string(),
  // 'new': no sync set up there yet (this computer starts it); 'group': join it
  kind: z.enum(['new', 'group']),
  // the names of the computers already in it
  devices: z.array(z.string()),
  snapshotCreatedAt: z.string().nullable()
})
export type SyncFolderDto = z.infer<typeof SyncFolderDto>

export const SyncJoinDto = z.object({
  beforeRestoreFolder: z.string(),
  // records found on both computers and merged
  matched: z.number(),
  // records only this computer had, added for the others
  inserted: z.number()
})
export type SyncJoinDto = z.infer<typeof SyncJoinDto>
