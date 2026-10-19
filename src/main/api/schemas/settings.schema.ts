import { z } from 'zod'

// ========================================
// App settings (Einstellungen)
// ========================================
// Stored as key/value rows (app_setting); missing keys take these defaults.
// The default own company is not a setting here: it is the company flagged
// is_default_for_invoicing (used for invoices and contracts).

export const AppSettings = z.object({
  // ISO code used by imports for rows without a country, '' for none
  defaultCountry: z.string().default('DE')
})
export type AppSettings = z.infer<typeof AppSettings>

export const UpdateAppSettingsInput = AppSettings.partial()
export type UpdateAppSettingsInput = z.infer<typeof UpdateAppSettingsInput>

export const DataLocationsDto = z.object({
  dataFolder: z.string(),
  databaseFile: z.string(),
  documentsFolder: z.string()
})
export type DataLocationsDto = z.infer<typeof DataLocationsDto>

export const BackupResultDto = z.object({
  canceled: z.boolean(),
  folder: z.string().nullable()
})
export type BackupResultDto = z.infer<typeof BackupResultDto>
