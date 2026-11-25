// Receipts from a plain PDF (no e-invoice data): date, total, invoice number and supplier read
// from the PDF's text. Guesses only - the dialog shows them for checking. No Electron, no DB.

export type ReceiptTextFields = {
  receiptDate: string | null
  amountCents: number | null
  currency: string | null
  reference: string
  /** Names with a legal form from the top of the page ("Hotel Beispiel GmbH"), in order; the
   * recipient's own name may be among them */
  supplierNames: string[]
  /** USt-IdNrs. in the text, in order; the recipient's own one may be among them */
  vatIds: string[]
}

const MONTHS: Record<string, number> = {
  januar: 1,
  jänner: 1,
  january: 1,
  jan: 1,
  februar: 2,
  february: 2,
  feb: 2,
  märz: 3,
  maerz: 3,
  march: 3,
  mär: 3,
  mar: 3,
  april: 4,
  apr: 4,
  mai: 5,
  may: 5,
  juni: 6,
  june: 6,
  jun: 6,
  juli: 7,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  oktober: 10,
  october: 10,
  okt: 10,
  oct: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  december: 12,
  dez: 12,
  dec: 12
}

const DATE_PATTERNS: RegExp[] = [
  // 03.11.2026, 3.11.26, 03/11/2026
  /\b(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})\b/g,
  // 2026-11-03
  /\b(\d{4})-(\d{2})-(\d{2})\b/g,
  // 3. November 2026, 3 Nov 2026
  /\b(\d{1,2})\.?\s+([A-Za-zÄÖÜäöü]{3,9})\.?\s+(\d{4})\b/g
]

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 100) year += 2000
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCMonth() !== month - 1) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Every valid date in a piece of text, in order of appearance */
export function datesIn(text: string): string[] {
  const found: { at: number; iso: string }[] = []
  DATE_PATTERNS.forEach((pattern, index) => {
    for (const match of text.matchAll(pattern)) {
      let iso: string | null = null
      if (index === 0) iso = isoDate(Number(match[3]), Number(match[2]), Number(match[1]))
      else if (index === 1) iso = isoDate(Number(match[1]), Number(match[2]), Number(match[3]))
      else {
        const month = MONTHS[match[2].toLowerCase()]
        if (month) iso = isoDate(Number(match[3]), month, Number(match[1]))
      }
      if (iso) found.push({ at: match.index ?? 0, iso })
    }
  })
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.iso)
}

// 1.234,56 · 1234,56 · 1,234.56 · 1'234.56 · 1234.56 - always two decimals, as totals are.
// No space as thousands mark: "2 125,00" is a quantity and a price.
const AMOUNT = /(?<![\d.,'’])(-?)(\d{1,3}(?:[.,'’]\d{3})+|\d+)([.,])(\d{2})(?!\d)/g

/** Every amount with two decimals in a line, in cents */
export function amountsIn(line: string): number[] {
  const amounts: number[] = []
  for (const match of line.matchAll(AMOUNT)) {
    const [, sign, whole, separator] = match
    // "1.234.56" is not an amount; a thousands mark must differ from the decimal mark
    if (whole.includes(separator)) continue
    const cents = Number(whole.replace(/[.,'’]/g, '')) * 100 + Number(match[4])
    amounts.push(sign ? -cents : cents)
  }
  return amounts
}

const CURRENCIES: [RegExp, string][] = [
  [/€|\bEUR\b/i, 'EUR'],
  [/\bCHF\b|\bFr\./, 'CHF'],
  [/\$|\bUSD\b/i, 'USD'],
  [/£|\bGBP\b/i, 'GBP']
]

function currencyIn(text: string): string | null {
  return CURRENCIES.find(([pattern]) => pattern.test(text))?.[1] ?? null
}

// Lines naming the total, strongest first. A line with net, tax or subtotal words is skipped.
const TOTAL_LABELS: RegExp[] = [
  /\b(rechnungsbetrag|gesamtbetrag|endbetrag|zahlbetrag|bruttobetrag|gesamtsumme|bruttosumme|rechnungssumme)\b/i,
  /\b(zu zahlen|zu zahlender betrag|summe brutto|gesamt brutto|brutto gesamt|amount due|total due|grand total|total amount)\b/i,
  /\b(summe|gesamt|total|betrag)\b/i
]
const NOT_TOTAL =
  /\b(netto|net|zwischensumme|subtotal|mwst|ust|umsatzsteuer|mehrwertsteuer|vat|tax|steuer|rabatt|skonto|anzahlung|bereits bezahlt|gegeben|bar|rückgeld|wechselgeld)\b/i

// "inkl. 19 % MwSt." marks a gross total, not a tax line
const GROSS_NOTE =
  /\b(?:inkl|incl|including|einschl)\.?\s*(?:\d+(?:[.,]\d+)?\s*%\s*)?(?:mwst|ust|umsatzsteuer|mehrwertsteuer|vat|tax|steuern?)\b\.?/gi

function totalOf(lines: string[]): { cents: number; currency: string | null } | null {
  for (const label of TOTAL_LABELS) {
    // The last labelled line wins: totals close an invoice, line items come before
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]
      if (!label.test(line) || NOT_TOTAL.test(line.replace(GROSS_NOTE, ''))) continue
      // The amount may stand on the label's line or, in two-column layouts, the next one
      for (const candidate of [line, lines[i + 1] ?? '']) {
        const amounts = amountsIn(candidate).filter((cents) => cents > 0)
        if (amounts.length > 0) {
          return { cents: amounts[amounts.length - 1], currency: currencyIn(candidate) }
        }
      }
    }
  }
  return null
}

const DATE_LABEL =
  /\b(rechnungsdatum|belegdatum|ausstellungsdatum|invoice date|date of issue|datum|date)\b/i
// "Datum der Lieferung", or a next line that is about another date
const NOT_INVOICE_DATE = /\b(liefer|leistung|fällig|zahlbar|due|bestell|auftrag|zeitraum)/i

function dateOf(lines: string[], fullText: string): string | null {
  for (const [i, line] of lines.entries()) {
    const label = DATE_LABEL.exec(line)
    if (!label) continue
    // Only the part after the label: a date left of it belongs to another column
    const after = line.slice(label.index + label[0].length)
    if (NOT_INVOICE_DATE.test(after.slice(0, 20))) continue
    const dates = datesIn(after)
    if (dates.length > 0) return dates[0]
    const next = datesIn(lines[i + 1] ?? '')
    if (next.length > 0 && !NOT_INVOICE_DATE.test(lines[i + 1])) return next[0]
  }
  return datesIn(fullText)[0] ?? null
}

const REFERENCE_LABEL =
  /\b(?:rechnungs?[- ]?(?:nr|nummer|no)|rechnung\s+nr|re[.-]?\s?nr|beleg[- ]?(?:nr|nummer)|bon[- ]?nr|invoice\s*(?:no|number|nr|#)|quittungs?[- ]?nr)\.?\s*[:#]?\s*/i
const REFERENCE = /^([A-Z0-9][A-Z0-9\-/._]{1,39})/i

function referenceOf(lines: string[]): string {
  for (const [i, line] of lines.entries()) {
    const label = REFERENCE_LABEL.exec(line)
    if (!label) continue
    for (const candidate of [line.slice(label.index + label[0].length), lines[i + 1] ?? '']) {
      const match = REFERENCE.exec(candidate.trim())
      if (match && /\d/.test(match[1])) return match[1].replace(/[._/-]+$/, '')
    }
  }
  return ''
}

// German and common foreign legal forms, as a letterhead names them
const LEGAL_FORM =
  /\b(GmbH\s*&\s*Co\.?\s*KG|GmbH|gGmbH|mbH|AG|KG|OHG|GbR|UG(?:\s*\(haftungsbeschränkt\))?|e\.\s?K\.|e\.\s?V\.|SE|Ltd\.?|Inc\.?|S\.?A\.?R\.?L\.?|B\.V\.)(?=$|[\s,·|•–-])/

const NOT_A_NAME = /:|\b(amtsgericht|registergericht|handelsregister|hrb|hra|sitz)\b/i

function supplierNamesOf(lines: string[]): string[] {
  const names: string[] = []
  // Lines with a legal form near the top: the letterhead, the sender line, the address
  for (const line of lines.slice(0, 30)) {
    const form = LEGAL_FORM.exec(line)
    if (!form) continue
    // "Hotel Beispiel GmbH · Musterstraße 1 · 12345 Musterstadt" → "Hotel Beispiel GmbH"
    const upTo = line.slice(0, form.index + form[0].length)
    const parts = upTo.split(/\s*[·|•,]\s*|\s{2,}|\s+[–-]\s+/)
    const name = parts[parts.length - 1].trim()
    const rest = name.slice(0, name.length - form[0].length)
    if (!/\p{L}{2}/u.test(rest) || NOT_A_NAME.test(name) || name.split(/\s+/).length > 8) continue
    if (!names.includes(name)) names.push(name)
  }
  return names
}

const VAT_ID =
  /\b(DE|AT|CH|NL|BE|FR|LU|DK|IT|ES|PL|CZ)\s?((?:\d\s?){8,11}\d|U\s?\d{8}|[0-9A-Z]{2}\d{9})\b/g

function vatIdsOf(text: string): string[] {
  const ids = new Set<string>()
  for (const match of text.matchAll(VAT_ID)) {
    ids.add((match[1] + match[2]).replace(/\s/g, '').toUpperCase())
  }
  return [...ids]
}

/** What a receipt's text gives for its fields; empty values where nothing was found */
export function readReceiptText(text: string): ReceiptTextFields {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const total = totalOf(lines)
  return {
    receiptDate: dateOf(lines, text),
    amountCents: total?.cents ?? null,
    currency: total ? (total.currency ?? currencyIn(text)) : null,
    reference: referenceOf(lines),
    supplierNames: supplierNamesOf(lines),
    vatIds: vatIdsOf(text)
  }
}

/** Whether the text gave anything worth showing as read from the file */
export function hasReceiptTextFields(fields: ReceiptTextFields): boolean {
  return (
    fields.receiptDate !== null ||
    fields.amountCents !== null ||
    fields.reference !== '' ||
    fields.supplierNames.length > 0
  )
}
