import { z } from 'zod'

// ========================================
// App settings (Einstellungen)
// ========================================
// Stored as key/value rows (app_setting); missing keys take these defaults.
// The default own company is not a setting here: it is the company flagged
// is_default_for_invoicing (used for invoices and contracts).

export const AppSettings = z.object({
  // ISO code used by imports for rows without a country, '' for none
  defaultCountry: z.string().default('DE'),
  // .ics file kept up to date with all events, '' for off
  calendarFeedPath: z.string().default(''),
  // Invoice PDFs carry the e-invoice XML (ZUGFeRD/Factur-X) when complete
  eInvoiceEmbed: z.boolean().default(true),
  // Payable invoices carry the EPC payment QR code ("GiroCode")
  paymentQr: z.boolean().default(true)
})
export type AppSettings = z.infer<typeof AppSettings>

export const UpdateAppSettingsInput = AppSettings.partial()
export type UpdateAppSettingsInput = z.infer<typeof UpdateAppSettingsInput>

export const CalendarFeedStatusDto = z.object({
  // '' when off
  path: z.string(),
  // ISO timestamp of the last write in this session
  lastWrittenAt: z.string().nullable(),
  events: z.number(),
  error: z.string().nullable()
})
export type CalendarFeedStatusDto = z.infer<typeof CalendarFeedStatusDto>

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
