// ========================================
// An invoice the band (or the agency) wrote for a show
// ========================================
// Old invoices from before Bookingium lie in the booking folders ("Rechnung_019-2023_….pdf").
// They are the best source for the customer's billing data: the recipient block under the sender
// line (DIN 5008: "Muster Band GbR • Musterweg 1 • 12345 Musterstadt"), its VAT id, and the fee.
// An invoice is only read as one of ours when its sender line names one of `ownNames` (the band,
// its company, the own company); an invoice someone sent us is left alone.
// Pure: no Electron, no database (tests/booking_archive.test.ts).
import { cleanText } from '../import/normalize'
import { keyOf, moneyOf, segmentsOf } from './extract'

export interface OwnInvoiceFact {
  /** "019-2023" */
  number: string
  /** ISO date of the invoice, '' when none is found */
  date: string
  recipient: {
    name: string
    street: string
    zipCode: string
    city: string
    /** ISO country code from a prefix like "I-39040", '' for none */
    countryCode: string
    vatId: string
    /** "z. Hd. Erika Muster" */
    contactName: string
  }
  /** The fee (Honorar / Gage) net, null when the invoice does not name one */
  feeCents: number | null
  totalCents: number | null
}

const INVOICE_HEAD = /\brechnung\s*(nr|nummer|no)\b|\binvoice\s*(no|number|#)/i
const SENDER_SEPARATOR = /\s[•·|]\s/
const DATE_ONLY = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/
const ZIP_CITY = /^(?:([A-Z]{1,2})\s?-\s?)?(\d{4,5})\s+([\p{L}][\p{L} .'-]*)$/u
const STREET = /^[\p{L}][\p{L} .'-]*\s\d+\s?[a-z]?(?:\s*[-/]\s*\d+[a-z]?)?$/iu
const VAT = /\b([A-Z]{2})\s?-?\s?([0-9A-Z]{8,12})\b/
const COUNTRY_PREFIX: Readonly<Record<string, string>> = {
  D: 'DE',
  A: 'AT',
  CH: 'CH',
  I: 'IT',
  F: 'FR',
  NL: 'NL',
  B: 'BE',
  L: 'LU',
  DK: 'DK',
  CZ: 'CZ',
  PL: 'PL'
}

const isoDate = (match: RegExpExecArray): string => {
  const year = match[3].length === 2 ? `20${match[3]}` : match[3]
  return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
}

/** The invoice, when `text` is one of ours; null otherwise */
export function extractOwnInvoice(text: string, ownNames: readonly string[]): OwnInvoiceFact | null {
  if (!INVOICE_HEAD.test(text.slice(0, 600))) return null
  const own = ownNames.map(keyOf).filter((key) => key.length >= 3)
  if (own.length === 0) return null
  const isOwn = (segment: string) => own.some((key) => ` ${keyOf(segment)} `.includes(` ${key} `))
  const segments = segmentsOf(text).filter(Boolean)

  // the sender line, then the recipient block below it
  const senderIndex = segments.findIndex((s) => SENDER_SEPARATOR.test(s) && isOwn(s))
  if (senderIndex < 0) return null
  const block: string[] = []
  for (let i = senderIndex + 1; i < segments.length && block.length < 8; i++) {
    const line = cleanText(segments[i])
    if (!line) continue
    if (isOwn(line) || DATE_ONLY.test(line)) break
    block.push(line)
  }
  const recipient = {
    name: '',
    street: '',
    zipCode: '',
    city: '',
    countryCode: '',
    vatId: '',
    contactName: ''
  }
  for (const line of block) {
    const key = keyOf(line)
    if (/^(z h|z hd|zh|zu handen|attn|c o)\b/.test(key)) {
      recipient.contactName = cleanText(line.replace(/^(z\.?\s?h(d)?\.?|zu handen|attn\.?|c\/o)\s*/i, ''))
      continue
    }
    if (/^(kennwort|betreff|projekt|reference|ref)\b/.test(key)) continue
    if (/ust|vat|mwst|tax/.test(key)) {
      const vat = VAT.exec(line.replace(/^[^:]*:/, ' '))
      if (vat && !recipient.vatId) recipient.vatId = `${vat[1]}${vat[2]}`
      continue
    }
    const place = ZIP_CITY.exec(line)
    if (place && !recipient.zipCode) {
      recipient.zipCode = place[2]
      recipient.city = cleanText(place[3])
      if (place[1]) recipient.countryCode = COUNTRY_PREFIX[place[1]] ?? ''
      continue
    }
    if (!recipient.name) {
      recipient.name = line
      continue
    }
    if (!recipient.street && STREET.test(line)) recipient.street = line
  }
  if (!recipient.name) return null

  const number = /(?:rechnung|invoice)\s*(?:nr|nummer|no|number|#)\.?\s*:?\s*([A-Z0-9][A-Z0-9/-]*)/i.exec(text)?.[1] ?? ''
  // the invoice date: the last date-only line (the letter's date stands alone)
  let date = ''
  for (const segment of segments) {
    const match = DATE_ONLY.exec(segment.trim())
    if (match) date = isoDate(match)
  }
  const amountOf = (pattern: RegExp): number | null => {
    for (const segment of segments) {
      if (!pattern.test(keyOf(segment))) continue
      const amounts = [...segment.matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*€?/g)]
      const last = amounts[amounts.length - 1]
      if (last) return moneyOf(last[1])
    }
    return null
  }
  return {
    number,
    date,
    recipient,
    feeCents: amountOf(/\b(honorar|gage|fee|guarantee|garantie)\b/),
    totalCents: amountOf(/\b(gesamtbetrag|gesamt|total|summe|rechnungsbetrag)\b/)
  }
}
