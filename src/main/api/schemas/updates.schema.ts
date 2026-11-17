import { z } from 'zod'

// ========================================
// Auto-update (#49, Einstellungen › Daten › "Version und Updates")
// ========================================
// See src/main/app/updates.ts: the installed app looks for a newer release on GitHub,
// downloads it in the background and installs it when the app closes.

export const UpdatePhase = z.enum([
  // only the installed app updates itself (not development or the e2e app)
  'unsupported',
  'idle',
  'checking',
  'current',
  'downloading',
  // downloaded; installed when the app closes, or right away on "Jetzt neu starten"
  'ready',
  'error'
])
export type UpdatePhase = z.infer<typeof UpdatePhase>

export const UpdateStatusDto = z.object({
  currentVersion: z.string(),
  phase: UpdatePhase,
  // the newer version being downloaded or ready
  version: z.string().nullable(),
  // download progress 0..100 while downloading
  percent: z.number().nullable(),
  lastCheckAt: z.string().nullable(),
  error: z.string().nullable()
})
export type UpdateStatusDto = z.infer<typeof UpdateStatusDto>
