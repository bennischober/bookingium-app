import { z } from 'zod'

// ========================================
// App settings (Einstellungen)
// ========================================
// Stored as key/value rows (app_setting); missing keys take these defaults.
// The default own company is not a setting here: it is the company flagged
// is_default_for_invoicing (used for invoices and contracts).

// auto        -> by the program Windows opens email links with
// outlook     -> classic Outlook: opens the email as a draft (.eml)
// thunderbird -> Thunderbird: opens a new email with the PDF attached
// mailto      -> any other program: email without attachment, PDF shown in Explorer
// files       -> only saves email and PDF and opens their folder
export const MailProgramSetting = z.enum(['auto', 'outlook', 'thunderbird', 'mailto', 'files'])
export type MailProgramSetting = z.infer<typeof MailProgramSetting>

export const EmailTemplate = z.object({ subject: z.string(), body: z.string() })
export type EmailTemplate = z.infer<typeof EmailTemplate>

export const DEFAULT_INVOICE_EMAIL: Record<'de' | 'en', EmailTemplate> = {
  de: {
    subject: '{Dokument} {Rechnungsnummer} – {Band}',
    body:
      'Guten Tag,\n\n' +
      'anbei erhalten Sie die {Dokument} {Rechnungsnummer} vom {Rechnungsdatum} über {Betrag}.\n\n' +
      'Mit freundlichen Grüßen\n{Absender}'
  },
  en: {
    subject: '{Dokument} {Rechnungsnummer} – {Band}',
    body:
      'Hello,\n\n' +
      'please find attached {Dokument} {Rechnungsnummer} of {Rechnungsdatum} for {Betrag}.\n\n' +
      'Kind regards\n{Absender}'
  }
}

export const AppSettings = z.object({
  // ISO code used by imports for rows without a country, '' for none
  defaultCountry: z.string().default('DE'),
  // .ics file kept up to date with all events, '' for off
  calendarFeedPath: z.string().default(''),
  // Invoice PDFs carry the e-invoice XML (ZUGFeRD/Factur-X) when complete
  eInvoiceEmbed: z.boolean().default(true),
  // Payable invoices carry the EPC payment QR code ("GiroCode")
  paymentQr: z.boolean().default(true),
  // How "Per E-Mail senden" opens the email (auto: by the system's mail program)
  mailProgram: MailProgramSetting.default('auto'),
  // Subject and text of invoice emails, per template language; {Platzhalter}
  invoiceEmailDe: EmailTemplate.default(DEFAULT_INVOICE_EMAIL.de),
  invoiceEmailEn: EmailTemplate.default(DEFAULT_INVOICE_EMAIL.en)
})
export type AppSettings = z.infer<typeof AppSettings>

// Only the given keys, without the defaults: zod applies defaults inside
// .partial(), which would overwrite every other stored setting
const { shape } = AppSettings
export const UpdateAppSettingsInput = z
  .object({
    defaultCountry: shape.defaultCountry.unwrap(),
    calendarFeedPath: shape.calendarFeedPath.unwrap(),
    eInvoiceEmbed: shape.eInvoiceEmbed.unwrap(),
    paymentQr: shape.paymentQr.unwrap(),
    mailProgram: shape.mailProgram.unwrap(),
    invoiceEmailDe: shape.invoiceEmailDe.unwrap(),
    invoiceEmailEn: shape.invoiceEmailEn.unwrap()
  })
  .partial()
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
