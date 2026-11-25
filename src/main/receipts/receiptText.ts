// Receipts from a plain PDF (no e-invoice data): date, total, invoice number and supplier read
// from the PDF's text. Guesses only - the dialog shows them for checking. No Electron, no DB.

export type ReceiptTextFields = {
  receiptDate: string | null
  amountCents: number | null
  currency: string | null
  reference: string
  /**
   * Names with a legal form outside the recipient's address block ("Hotel Beispiel GmbH"), the
   * one above the supplier's USt-IdNr. first; an unlabelled recipient address may be among them
   */
  supplierNames: string[]
  /** USt-IdNrs. outside the recipient's address block, in order */
  supplierVatIds: string[]
  /** USt-IdNrs. under a recipient label ("Rechnungsempfänger", "Bill to") */
  recipientVatIds: string[]
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
  /\b(rechnungsbetrag|gesamtbetrag|endbetrag|zahlbetrag|bruttobetrag|gesamtsumme|bruttosumme|rechnungssumme|endsumme)\b/i,
  /\b(zu zahlen|zu zahlender betrag|summe brutto|gesamt brutto|brutto gesamt|amount due|total due|grand total|total amount|invoice total|balance due)\b/i,
  /\b(summe|gesamt|total|betrag)\b/i
]
const NOT_TOTAL =
  /\b(netto|net|zwischensumme|subtotal|mwst|ust|umsatzsteuer|mehrwertsteuer|vat|tax|steuer|rabatt|skonto|anzahlung|bereits bezahlt|gegeben|bar|rückgeld|wechselgeld|einzelpreis)\b/i

// "inkl. 19 % MwSt." marks a gross total, not a tax line
const GROSS_NOTE =
  /\b(?:inkl|incl|including|einschl)\.?\s*(?:\d+(?:[.,]\d+)?\s*%\s*)?(?:mwst|ust|umsatzsteuer|mehrwertsteuer|vat|tax|steuern?)\b\.?/gi

const isTotalLine = (line: string, label: RegExp): boolean =>
  label.test(line) && !NOT_TOTAL.test(line.replace(GROSS_NOTE, ''))

type Total = { cents: number; currency: string | null }

function totalOf(lines: string[]): Total | null {
  // 1. A total label with its amount on the same line ("Gesamtbetrag 203,00 €"). The last such
  //    line wins: totals close an invoice, line items come before.
  for (const label of TOTAL_LABELS) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!isTotalLine(lines[i], label)) continue
      const amounts = amountsIn(lines[i]).filter((cents) => cents > 0)
      if (amounts.length > 0) {
        return { cents: amounts[amounts.length - 1], currency: currencyIn(lines[i]) }
      }
    }
  }
  // 2. Column layouts put labels and amounts on lines of their own. The gross total is then
  //    the largest amount that stands within a few lines of a strong total label or appears
  //    more than once (overview box and totals table both show it).
  const seen = new Map<number, { count: number; nearLabel: boolean; currency: string | null }>()
  const strong = TOTAL_LABELS.slice(0, 2)
  lines.forEach((line, i) => {
    if (NOT_TOTAL.test(line.replace(GROSS_NOTE, '')) && amountsIn(line).length > 0) {
      // "MwSt 19 % 12,98" names its amount; it is no total
      if (!strong.some((label) => label.test(line))) return
    }
    const near = lines
      .slice(Math.max(0, i - 3), i + 1)
      .some((other) => strong.some((label) => isTotalLine(other, label)))
    for (const cents of amountsIn(line)) {
      if (cents <= 0) continue
      const entry = seen.get(cents) ?? { count: 0, nearLabel: false, currency: null }
      entry.count++
      entry.nearLabel ||= near
      entry.currency ??= currencyIn(line)
      seen.set(cents, entry)
    }
  })
  let best: Total | null = null
  for (const [cents, entry] of seen) {
    if (!entry.nearLabel && entry.count < 2) continue
    if (!best || cents > best.cents) best = { cents, currency: entry.currency }
  }
  return best
}

const DATE_LABEL =
  /\b(rechnungsdatum|belegdatum|ausstellungsdatum|buchungsdatum|kaufdatum|ausgestellt am|invoice date|date of issue|issue date|date issued|datum|date)\b/i
// "Datum der Lieferung", or a line that is about another date (period, validity, due date)
const NOT_INVOICE_DATE =
  /\b(liefer|leistung|fällig|zahlbar|due|bestell|auftrag|zeitraum|gültig|valid|abgebucht|abbuchung)/i

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
  // No labelled date: the first date that is not part of a period or a due note
  const free = lines.filter((line) => !NOT_INVOICE_DATE.test(line)).join('\n')
  return datesIn(free)[0] ?? datesIn(fullText)[0] ?? null
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

// German and common foreign legal forms, as a letterhead or an address names them
const LEGAL_FORM = new RegExp(
  '(?<![\\p{L}\\d])(' +
    [
      'GmbH\\s*&\\s*Co\\.?\\s*(?:KGaA|KG|OHG)',
      'AG\\s*&\\s*Co\\.?\\s*KG',
      'gGmbH',
      'GmbH',
      'mbH',
      'KGaA',
      'AG',
      'KG',
      'OHG',
      'GbR',
      'PartG(?:\\s*mbB)?',
      'UG(?:\\s*\\(haftungsbeschränkt\\))?',
      'e\\.\\s?K\\.?',
      'e\\.\\s?V\\.?',
      'eG',
      'SE',
      'Limited',
      'Ltd\\.?',
      'LLC',
      'LLP',
      'PLC',
      'Inc\\.?',
      'Corp\\.?',
      'Corporation',
      'Pty\\.?\\s*Ltd\\.?',
      'SARL',
      'S\\.A\\.R\\.L\\.',
      'S\\.à\\s?r\\.l\\.',
      'S\\.L\\.U?\\.?',
      'S\\.A\\.S?\\.?',
      'SAS',
      'S\\.r\\.l\\.?',
      'Srl',
      'S\\.p\\.A\\.?',
      'SpA',
      'B\\.?V\\.?',
      'N\\.?V\\.?',
      'ApS',
      'A/S',
      'Oy',
      'sp\\.\\s?z\\s?o\\.o\\.',
      's\\.r\\.o\\.',
      'Kft\\.?'
    ].join('|') +
    ')(?=$|[\\s,·|•–\\-)]|\\.(?:\\s|$))',
  'u'
)

const NOT_A_NAME =
  /:|\b(amtsgericht|registergericht|handelsregister|registernummer|hrb|hra|sitz|geschäftsführ\w*|vorstand|aufsichtsrat|iban|bic|konto|bank)\b/i

// Labels above the recipient's address; its lines are no supplier
const RECIPIENT_LABEL =
  /^(rechnungsempfänger(?:in)?|rechnungsadresse|leistungsempfänger|empfänger|kunde|kundin|kundenadresse|lieferadresse|bill(?:ed)? to|invoice to|sold to|ship to|customer)\b/i
const RECIPIENT_LINES = 7

/** Line indexes that belong to an address block under a recipient label */
function recipientLines(lines: string[]): Set<number> {
  const inside = new Set<number>()
  lines.forEach((line, i) => {
    if (!RECIPIENT_LABEL.test(line)) return
    for (let j = i; j <= Math.min(lines.length - 1, i + RECIPIENT_LINES); j++) inside.add(j)
  })
  return inside
}

/** "Hotel Beispiel GmbH · Musterstraße 1 · 12345 Musterstadt" → "Hotel Beispiel GmbH" */
function nameIn(line: string): string | null {
  const form = LEGAL_FORM.exec(line)
  if (!form) return null
  const upTo = line.slice(0, form.index + form[0].length)
  const parts = upTo.split(/\s*[·|•,]\s*|\s{2,}|\s+[–-]\s+/)
  const name = parts[parts.length - 1].trim()
  const rest = name.slice(0, name.length - form[0].length)
  if (!/\p{L}{2}/u.test(rest) || NOT_A_NAME.test(name) || name.split(/\s+/).length > 8) return null
  return name
}

// Every EU country code plus CH, NO and GB; DE 123456789, ATU12345678, IE 1234567WA,
// NL123456789B01, FRXX123456789
const VAT_ID =
  /\b(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|GB|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|CH|NO|XI)\s?((?:U\s?)?(?:[0-9A-Z]{2}\s?)?\d[\d ]{5,13}\d(?:\s?[A-Z]{1,2}\d{0,2})?)(?![\dA-Za-z])/g

type VatHit = { id: string; line: number }

function vatIdsOf(lines: string[]): VatHit[] {
  const hits: VatHit[] = []
  lines.forEach((line, i) => {
    for (const match of line.matchAll(VAT_ID)) {
      const id = (match[1] + match[2]).replace(/\s/g, '').toUpperCase()
      const digits = id.replace(/\D/g, '').length
      if (id.length < 9 || id.length > 15 || digits < 7) continue
      if (!hits.some((hit) => hit.id === id)) hits.push({ id, line: i })
    }
  })
  return hits
}

/** What a receipt's text gives for its fields; empty values where nothing was found */
export function readReceiptText(text: string): ReceiptTextFields {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const total = totalOf(lines)
  const recipient = recipientLines(lines)
  const vatHits = vatIdsOf(lines)
  const supplierVat = vatHits.filter((hit) => !recipient.has(hit.line))

  // Names outside the recipient block, the one right above the supplier's USt-IdNr. first:
  // that is the sender's address block wherever the layout puts it
  const named = lines
    .map((line, i) => ({ name: nameIn(line), line: i }))
    .filter((entry): entry is { name: string; line: number } => entry.name !== null)
    .filter((entry) => !recipient.has(entry.line))
  const nearVat = (entry: { line: number }): boolean =>
    supplierVat.some((hit) => hit.line >= entry.line && hit.line - entry.line <= 8)
  const ordered = [...named.filter(nearVat), ...named.filter((entry) => !nearVat(entry))]
  const supplierNames: string[] = []
  for (const { name } of ordered) if (!supplierNames.includes(name)) supplierNames.push(name)

  return {
    receiptDate: dateOf(lines, text),
    amountCents: total?.cents ?? null,
    currency: total ? (total.currency ?? currencyIn(text)) : null,
    reference: referenceOf(lines),
    supplierNames,
    supplierVatIds: supplierVat.map((hit) => hit.id),
    recipientVatIds: vatHits.filter((hit) => recipient.has(hit.line)).map((hit) => hit.id)
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
