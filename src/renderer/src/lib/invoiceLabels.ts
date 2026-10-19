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

export function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: currency || 'EUR'
  }).format(value)
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

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
