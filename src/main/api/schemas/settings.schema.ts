import { z } from 'zod'
import { DEFAULT_CLUB_RADIUS, DEFAULT_FESTIVAL_RADIUS, RadiusClause } from './radius.schema'

// ========================================
// App settings (Einstellungen)
// ========================================
// Stored as key/value rows (app_setting); missing keys take these defaults.
// The default own company is not a setting here: it is the company flagged
// is_default_for_invoicing (used for invoices and contracts).
//
// #136: the keys mailProgram and mailClient of older versions may still be stored; zod
// drops them on read. bookingum's own mail client is the only way mail is sent.

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

export const DEFAULT_REMINDER_EMAIL: Record<'de' | 'en', EmailTemplate> = {
  de: {
    subject: 'Zahlungserinnerung: {Dokument} {Rechnungsnummer} – {Band}',
    body:
      'Guten Tag,\n\n' +
      'sicher ist es im Alltag untergegangen: Unsere {Dokument} {Rechnungsnummer} vom {Rechnungsdatum} über {Betrag} war am {Fällig} fällig. ' +
      'Bitte überweisen Sie den Betrag bis zum {Frist}. Die Rechnung finden Sie noch einmal im Anhang.\n\n' +
      'Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie diese E-Mail bitte als gegenstandslos.\n\n' +
      'Mit freundlichen Grüßen\n{Absender}'
  },
  en: {
    subject: 'Payment reminder: {Dokument} {Rechnungsnummer} – {Band}',
    body:
      'Hello,\n\n' +
      'this may have slipped through: our {Dokument} {Rechnungsnummer} of {Rechnungsdatum} for {Betrag} was due on {Fällig}. ' +
      'Please transfer the amount by {Frist}; the invoice is attached again.\n\n' +
      'If you have already paid, please disregard this email.\n\n' +
      'Kind regards\n{Absender}'
  }
}

export const DEFAULT_DUNNING_EMAIL: Record<'de' | 'en', EmailTemplate> = {
  de: {
    subject: 'Mahnung: {Dokument} {Rechnungsnummer} – {Band}',
    body:
      'Guten Tag,\n\n' +
      'zu unserer {Dokument} {Rechnungsnummer} vom {Rechnungsdatum} über {Betrag}, fällig am {Fällig}, konnten wir trotz Zahlungserinnerung noch keinen Zahlungseingang feststellen.\n\n' +
      'Bitte überweisen Sie den offenen Betrag bis spätestens {Frist}. Die Rechnung finden Sie noch einmal im Anhang.\n\n' +
      'Sollten Sie die Zahlung inzwischen veranlasst haben, betrachten Sie diese E-Mail bitte als gegenstandslos.\n\n' +
      'Mit freundlichen Grüßen\n{Absender}'
  },
  en: {
    subject: 'Overdue notice: {Dokument} {Rechnungsnummer} – {Band}',
    body:
      'Hello,\n\n' +
      'despite our payment reminder, we have not yet received payment for our {Dokument} {Rechnungsnummer} of {Rechnungsdatum} for {Betrag}, due on {Fällig}.\n\n' +
      'Please transfer the outstanding amount by {Frist} at the latest; the invoice is attached again.\n\n' +
      'If you have paid in the meantime, please disregard this email.\n\n' +
      'Kind regards\n{Absender}'
  }
}

// #120: concert and management contracts ({Dokument} names which one)
export const DEFAULT_CONTRACT_EMAIL: Record<'de' | 'en', EmailTemplate> = {
  de: {
    subject: '{Dokument} – {Band} – {Datum}',
    body:
      'Guten Tag,\n\n' +
      'anbei erhalten Sie den {Dokument} für {Band}. ' +
      'Bitte prüfen und unterschreiben Sie ihn und senden Sie uns ein unterschriebenes Exemplar zurück.\n\n' +
      'Mit freundlichen Grüßen\n{Absender}'
  },
  en: {
    subject: '{Dokument} – {Band} – {Datum}',
    body:
      'Hello,\n\n' +
      'please find attached the {Dokument} for {Band}. ' +
      'Please review and sign it and return a signed copy to us.\n\n' +
      'Kind regards\n{Absender}'
  }
}

// The default of each fixed email text, by what the email is (invoice, Zahlungserinnerung,
// Mahnung, contract) and its language. #136: an edited text is a mail_template row with that
// kind and lang (MailTemplateService.documentTemplate); without one, this applies.
export const DEFAULT_DOCUMENT_EMAILS = {
  invoice: DEFAULT_INVOICE_EMAIL,
  reminder: DEFAULT_REMINDER_EMAIL,
  dunning: DEFAULT_DUNNING_EMAIL,
  contract: DEFAULT_CONTRACT_EMAIL
} as const
export type EmailTemplateKind = keyof typeof DEFAULT_DOCUMENT_EMAILS

export const AppSettings = z.object({
  // ISO code used by imports for rows without a country, '' for none
  defaultCountry: z.string().default('DE'),
  // .ics file kept up to date with all events, '' for off
  calendarFeedPath: z.string().default(''),
  // #52: open follow-ups (Wiedervorlagen) in that file too. Off by default: the file is
  // often shared by link, and follow-up notes are the user's own.
  calendarFeedFollowUps: z.boolean().default(false),
  // Invoice PDFs carry the e-invoice XML (ZUGFeRD/Factur-X) when complete
  eInvoiceEmbed: z.boolean().default(true),
  // Payable invoices carry the EPC payment QR code ("GiroCode")
  paymentQr: z.boolean().default(true),
  // #65: a Windows notification when new mail arrives in an INBOX while the app is in the
  // background (count and account only). #133: off by default, the unread counts are enough
  mailNotifications: z.boolean().default(false),
  // #133: the same as a popup in the app while its main window is in front, off by default
  mailInAppNotifications: z.boolean().default(false),
  // #65: closing the window keeps the app in the tray (Infobereich), so reminders and mail still
  // come; off, closing quits as before. #142: no longer tied to a mail account (the key keeps its
  // old name so the stored choice stays).
  mailCloseToTray: z.boolean().default(false),
  // #142: reminders (the daily summary of due follow-ups) as a Windows notification in the
  // background and a popup in the app. On by default: the user set them on purpose.
  reminderNotifications: z.boolean().default(true),
  // "Karte (experimentell)": the map preview (#102), off until the user turns it on. Off, the
  // renderer hides the page; the lookup runs offline by postcode (bundled GeoNames table).
  mapPreview: z.boolean().default(false),
  // Radius clause (Gebietsschutz) per venue kind, #102: the map's default when neither the
  // event nor its venue sets one
  radiusClub: RadiusClause.default(DEFAULT_CLUB_RADIUS),
  radiusFestival: RadiusClause.default(DEFAULT_FESTIVAL_RADIUS),
  // I7: the mail account bookingum's own editor sends invoices (and contracts) from, '' for none chosen.
  // Never guessed: without a choice, sending from bookingum is refused.
  invoiceMailAccountId: z.string().default('')
})
export type AppSettings = z.infer<typeof AppSettings>

// Only the given keys, without the defaults: zod applies defaults inside
// .partial(), which would overwrite every other stored setting
const { shape } = AppSettings
export const UpdateAppSettingsInput = z
  .object({
    defaultCountry: shape.defaultCountry.unwrap(),
    calendarFeedPath: shape.calendarFeedPath.unwrap(),
    calendarFeedFollowUps: shape.calendarFeedFollowUps.unwrap(),
    eInvoiceEmbed: shape.eInvoiceEmbed.unwrap(),
    paymentQr: shape.paymentQr.unwrap(),
    mailNotifications: shape.mailNotifications.unwrap(),
    mailInAppNotifications: shape.mailInAppNotifications.unwrap(),
    mailCloseToTray: shape.mailCloseToTray.unwrap(),
    reminderNotifications: shape.reminderNotifications.unwrap(),
    mapPreview: shape.mapPreview.unwrap(),
    radiusClub: shape.radiusClub.unwrap(),
    radiusFestival: shape.radiusFestival.unwrap(),
    invoiceMailAccountId: shape.invoiceMailAccountId.unwrap()
  })
  .partial()
export type UpdateAppSettingsInput = z.infer<typeof UpdateAppSettingsInput>

export const CalendarFeedStatusDto = z.object({
  // '' when off
  path: z.string(),
  // ISO timestamp of the last write in this session
  lastWrittenAt: z.string().nullable(),
  events: z.number(),
  // Whether open follow-ups go into the file, and how many did on the last write
  includeFollowUps: z.boolean(),
  followUps: z.number(),
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
