import type { InvoiceStatus } from '../../../main/api/schemas/invoice.schema'

// Display labels and badge styles for stored invoice status values.
// The stored values themselves are never translated (see
// docs/UI_LANGUAGE.md).
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Entwurf',
  issued: 'gestellt',
  paid: 'bezahlt',
  overdue: 'überfällig',
  cancelled: 'storniert'
}

export const INVOICE_STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: 'bg-slate-100 text-slate-800 border-slate-200',
  issued: 'bg-blue-100 text-blue-800 border-blue-200',
  paid: 'bg-green-100 text-green-800 border-green-200',
  overdue: 'bg-amber-100 text-amber-900 border-amber-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200'
}

/** List label of an invoice number: "#1040", or "Entwurf" before it is issued */
export function invoiceNumberLabel(invoiceNumber: number | null): string {
  return invoiceNumber === null ? 'Entwurf' : `#${invoiceNumber}`
}

/** How a follow-up names the invoice it is on (as the main process does) */
export function invoiceFollowUpName(invoice: {
  invoiceNumber: number | null
  recipientName: string
}): string {
  const label =
    invoice.invoiceNumber === null ? 'Rechnungsentwurf' : `Rechnung #${invoice.invoiceNumber}`
  return invoice.recipientName ? `${label} · ${invoice.recipientName}` : label
}

/**
 * "Per E-Mail senden" of an invoice: "E-Mail erstellt am 20.10.2026 an
 * x@y.de", '' when there was none (emailedAt is SQLite UTC "YYYY-MM-DD HH:MM:SS")
 */
export function emailedLabel(invoice: { emailedAt: string | null; emailedTo: string }): string {
  if (!invoice.emailedAt) return ''
  const day = localDateTime(invoice.emailedAt, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
  return `E-Mail erstellt am ${day}${invoice.emailedTo ? ` an ${invoice.emailedTo}` : ''}`
}

/** One of an invoice's emails: "20.10.2026, 14:32 an x@y.de" (local time) */
export function invoiceEmailLabel(email: { createdAt: string; to: string }): string {
  return `${invoiceMomentLabel(email.createdAt)}${email.to ? ` an ${email.to}` : ''}`
}

/**
 * When something happened to an invoice: "20.10.2026, 14:32" (local time)
 * for a SQLite UTC datetime, "20.10.2026" for a plain date
 */
export function invoiceMomentLabel(at: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) {
    const [year, month, day] = at.split('-')
    return `${day}.${month}.${year}`
  }
  return localDateTime(at, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** SQLite UTC "YYYY-MM-DD HH:MM:SS" in local time, as is if unreadable */
function localDateTime(utc: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(`${utc.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? utc : date.toLocaleString('de-DE', options)
}

export function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: currency || 'EUR'
  }).format(value)
}

// Cent rounding shared with the stored totals and the e-invoice
export { roundMoney } from '../../../main/einvoice/amounts'

export function parseNumber(value: string, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Parses an amount typed the German way ("34.217,60", "34217,6", "1.000 €")
 * or with a decimal point ("34217.60"); null if it is not a number
 */
export function parseAmount(value: string): number | null {
  const compact = value.replace(/[\s€]/g, '')
  const normalized = compact.includes(',')
    ? compact.replace(/\./g, '').replace(',', '.')
    : /^-?\d{1,3}(\.\d{3})+$/.test(compact)
      ? compact.replace(/\./g, '') // "1.000" = one thousand
      : compact
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : null
}
