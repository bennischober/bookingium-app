// Payment QR code on invoices ("GiroCode"): the EPC QR code of the European
// Payments Council (EPC069-12, version 002). Banking apps that scan it open a
// SEPA transfer with recipient, IBAN, amount and reference filled in.
//
// The code is plain text, one field per line:
//   BCD / 002 / 1 (UTF-8) / SCT / BIC (optional) / name / IBAN /
//   EUR<amount> / purpose (empty) / structured reference (empty) /
//   unstructured reference
// at most 331 bytes, printed with error correction level M.
//
// Pure (no Node or DOM APIs): used by the invoice templates in the renderer.

import type { InvoicePrintDto } from '../api/schemas/invoice.schema'
import { formatCents, toCents } from '../einvoice/amounts'

export const EPC_MAX_BYTES = 331
const NAME_MAX = 70
const REFERENCE_MAX = 140
// EUR 0.01 – 999,999,999.99
const MAX_AMOUNT_CENTS = 99_999_999_999

export type EpcPayment = {
  name: string
  iban: string
  bic?: string
  amountCents: number
  reference: string
}

/** IBAN without spaces, upper case */
export function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase()
}

/** Country code, check digits and the mod-97 check (ISO 13616) */
export function isValidIban(iban: string): boolean {
  const value = normalizeIban(iban)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) return false
  const rearranged = value.slice(4) + value.slice(0, 4)
  let remainder = 0
  for (const char of rearranged) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55)
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

function isValidBic(bic: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)
}

/** One line of text, cut to `max` characters */
function field(value: string, max: number): string {
  return Array.from(value.replace(/\s+/g, ' ').trim()).slice(0, max).join('')
}

const byteLength = (text: string) => new TextEncoder().encode(text).length

/** The text inside the QR code, or null when the payment can't be encoded */
export function epcPayload(payment: EpcPayment): string | null {
  const iban = normalizeIban(payment.iban)
  const bic = (payment.bic ?? '').replace(/\s+/g, '').toUpperCase()
  const name = field(payment.name, NAME_MAX)
  if (!isValidIban(iban) || !name) return null
  if (payment.amountCents < 1 || payment.amountCents > MAX_AMOUNT_CENTS) return null

  const lines = (reference: string) =>
    [
      'BCD',
      '002',
      '1',
      'SCT',
      isValidBic(bic) ? bic : '',
      name,
      iban,
      `EUR${formatCents(payment.amountCents)}`,
      '',
      '',
      reference
    ].join('\n')

  // Multi-byte characters can push the text over the limit; the reference
  // gives way first
  let reference = field(payment.reference, REFERENCE_MAX)
  while (byteLength(lines(reference)) > EPC_MAX_BYTES && reference) {
    reference = Array.from(reference).slice(0, -1).join('')
  }
  const text = lines(reference)
  return byteLength(text) <= EPC_MAX_BYTES ? text : null
}

/**
 * The payment an invoice asks for, or null when it gets no QR code: drafts,
 * cancelled invoices and Stornorechnungen, other currencies than EUR, nothing
 * to pay, or no valid IBAN of the issuer.
 */
export function invoicePayment(data: InvoicePrintDto, lang: 'de' | 'en'): EpcPayment | null {
  const { invoice, issuer } = data
  if (invoice.kind !== 'invoice' || invoice.invoiceNumber === null) return null
  if (invoice.status === 'draft' || invoice.status === 'cancelled') return null
  if ((invoice.currency || 'EUR') !== 'EUR') return null
  if (!issuer || !isValidIban(issuer.iban)) return null
  const amountCents = toCents(invoice.totalGrossAmount)
  if (amountCents < 1) return null
  return {
    name: issuer.accountHolder || issuer.legalName,
    iban: issuer.iban,
    bic: issuer.bic,
    amountCents,
    reference: `${lang === 'en' ? 'Invoice' : 'Rechnung'} ${invoice.invoiceNumber}`
  }
}
