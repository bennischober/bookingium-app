import { z } from 'zod'

// ========================================
// Automatic backups (Einstellungen › Daten)
// ========================================
// Settings and status are machine-local (backup/state.json in the data folder), not in the
// database: see src/main/backup/files.ts.

export const RestoreOutcomeDto = z.object({
  at: z.string(),
  source: z.string(),
  backupCreatedAt: z.string().nullable(),
  error: z.string().nullable()
})
export type RestoreOutcomeDto = z.infer<typeof RestoreOutcomeDto>

export const BackupStatusDto = z.object({
  enabled: z.boolean(),
  // '' when no folder is chosen
  folder: z.string(),
  // a backup is being written right now
  running: z.boolean(),
  lastAttemptAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastFolder: z.string().nullable(),
  // null when the last attempt worked
  lastError: z.string().nullable(),
  lastRestore: RestoreOutcomeDto.nullable(),
  beforeRestoreFolder: z.string().nullable(),
  // #54: backups are encrypted with a password, since (ISO); the key never leaves the main process
  encrypted: z.boolean(),
  encryptedSince: z.string().nullable(),
  // false when the system cannot keep the key (no safeStorage)
  encryptionAvailable: z.boolean(),
  retention: z.object({ daily: z.number(), weekly: z.number() })
})
export type BackupStatusDto = z.infer<typeof BackupStatusDto>

export const PreparedRestoreDto = z.object({
  canceled: z.boolean(),
  // when the chosen backup was taken (ISO), null when unknown
  backupCreatedAt: z.string().nullable(),
  folder: z.string().nullable(),
  hasStorage: z.boolean(),
  // #54: an encrypted backup: nothing is copied until unlockRestore gets its password
  needsPassword: z.boolean()
})
export type PreparedRestoreDto = z.infer<typeof PreparedRestoreDto>
