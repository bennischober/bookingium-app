// The email an invoice is sent with, or a payment reminder about it:
// recipient from the frozen recipient data, subject and text from the
// template in the settings (per kind and template language) with the
// invoice's values filled into the {Platzhalter}.
//
// Pure (no Node or Electron APIs) so it can be unit tested.
import type { InvoicePrintDto } from '../api/schemas/invoice.schema'
import type { EmailTemplate } from '../api/schemas/settings.schema'
import type { EmailDraft } from './eml'

export type Lang = 'de' | 'en'

/** The placeholders a template can use, in the order the settings list them */
export const INVOICE_EMAIL_PLACEHOLDERS = [
  'Dokument',
  'Rechnungsnummer',
  'Rechnungsdatum',
  'Fällig',
  'Betrag',
  'Band',
  'Empfänger',
  'Absender',
  'Frist'
] as const

// {Frist}: the payment deadline a reminder sets, this many days from its creation
export const REMINDER_DEADLINE_DAYS = 7
export type InvoiceEmailPlaceholder = (typeof INVOICE_EMAIL_PLACEHOLDERS)[number]

/** "YYYY-MM-DD" -> "DD.MM.YYYY" (both languages, like the invoice) */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [year, month, day] = iso.split('-')
  return year && month && day ? `${day}.${month}.${year}` : iso
}

/** The local calendar day `days` after `date`, as DD.MM.YYYY */
function localDatePlus(date: Date, days: number): string {
  const later = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(later.getDate())}.${pad(later.getMonth() + 1)}.${later.getFullYear()}`
}

function formatMoney(value: number, currency: string, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'de-DE', {
    style: 'currency',
    currency: currency || 'EUR'
  }).format(value)
}

/** The recipient's address: the invoice contact's, else the general one */
export function recipientEmailOf(data: InvoicePrintDto): string {
  const recipient = data.recipient
  return (recipient?.contactEmail || recipient?.email || '').trim()
}

export function invoiceEmailValues(
  data: InvoicePrintDto,
  lang: Lang,
  now: Date = new Date()
): Record<InvoiceEmailPlaceholder, string> {
  const { invoice, issuer, recipient } = data
  const cancellation = invoice.kind === 'cancellation'
  return {
    Dokument:
      lang === 'en'
        ? cancellation
          ? 'Credit note'
          : 'Invoice'
        : cancellation
          ? 'Stornorechnung'
          : 'Rechnung',
    Rechnungsnummer: invoice.invoiceNumber === null ? '' : String(invoice.invoiceNumber),
    Rechnungsdatum: formatDate(invoice.issueDate),
    Fällig: formatDate(invoice.dueDate),
    Betrag: formatMoney(invoice.totalGrossAmount, invoice.currency, lang),
    Band: data.managementShare?.bandName || data.bandName || '',
    Empfänger: recipient?.legalName || invoice.recipientName,
    Absender: issuer?.contactName || issuer?.legalName || invoice.companyName,
    Frist: localDatePlus(now, REMINDER_DEADLINE_DAYS)
  }
}

/** Fills {Platzhalter}; unknown ones stay as typed */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{([^{}]+)\}/g, (match, name: string) => values[name.trim()] ?? match)
}

/** Drops the separators an empty value leaves behind ("Rechnung 12 – " -> "Rechnung 12") */
function tidySubject(subject: string): string {
  return subject
    .replace(/\s+/g, ' ')
    .replace(/( [–-])+( [–-])/g, '$2')
    .replace(/^[\s–-]+|[\s–,:-]+$/g, '')
}

export function invoiceEmail(
  data: InvoicePrintDto,
  lang: Lang,
  template: EmailTemplate,
  now: Date = new Date()
): EmailDraft {
  const values = invoiceEmailValues(data, lang, now)
  return {
    to: recipientEmailOf(data),
    subject: tidySubject(fillPlaceholders(template.subject, values)),
    body: fillPlaceholders(template.body, values)
  }
}
