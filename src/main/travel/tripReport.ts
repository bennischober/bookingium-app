// The report of a business trip (Reisekostenabrechnung, #225 step 2) as one PDF: a summary page
// (traveller, trip, per diem per day, mileage, receipts, total) followed by the pages of the
// trip's PDF receipts, so DATEV gets the claim and its evidence as one document. pdf-lib only,
// no Electron. Standard Helvetica (WinAnsi) covers German umlauts and the euro sign.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { fromCents } from '../einvoice/amounts'
import { TRIP_DAY_LABELS, type TripAllowances, type Vehicle } from './allowances'

export interface TripReportReceipt {
  date: string | null
  label: string
  amountCents: number | null
  currency: string
  /** The receipt's PDF; null for one that is not a PDF (e-invoice XML) */
  pdf: Uint8Array | null
}

export interface TripReportInput {
  companyName: string
  travellerName: string
  purpose: string
  destination: string
  countryCode: string
  startAt: string
  endAt: string
  kilometres: number
  vehicle: Vehicle
  allowances: TripAllowances
  receipts: TripReportReceipt[]
  notes: string
}

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 50

const euro = (cents: number): string =>
  `${fromCents(cents).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

const money = (cents: number, currency: string): string =>
  currency === 'EUR'
    ? euro(cents)
    : `${fromCents(cents).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`

const germanDate = (iso: string): string => {
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${day}.${month}.${year}`
}

const dateTime = (value: string): string => `${germanDate(value)}, ${value.slice(11, 16)} Uhr`

/** Characters Helvetica (WinAnsi) cannot draw become "?" instead of failing the report */
function printable(font: PDFFont, text: string): string {
  return [...text]
    .map((char) => {
      try {
        font.encodeText(char)
        return char
      } catch {
        return '?'
      }
    })
    .join('')
}

/** The sum of the receipts in euros; receipts in other currencies are listed, not added */
export function receiptsTotalCents(receipts: TripReportReceipt[]): number {
  return receipts.reduce(
    (sum, receipt) =>
      receipt.currency === 'EUR' && receipt.amountCents !== null ? sum + receipt.amountCents : sum,
    0
  )
}

export async function buildTripReport(input: TripReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Reisekostenabrechnung ${input.travellerName}`)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let page: PDFPage = doc.addPage([A4.width, A4.height])
  let y = A4.height - MARGIN

  const newPageIfNeeded = (space: number): void => {
    if (y - space >= MARGIN) return
    page = doc.addPage([A4.width, A4.height])
    y = A4.height - MARGIN
  }
  const text = (value: string, x: number, options: { size?: number; bold?: boolean } = {}) => {
    const size = options.size ?? 10
    const f = options.bold ? bold : font
    page.drawText(printable(f, value), { x, y, size, font: f, color: rgb(0.1, 0.1, 0.1) })
  }
  const right = (value: string, xRight: number, options: { bold?: boolean } = {}) => {
    const f = options.bold ? bold : font
    const safe = printable(f, value)
    page.drawText(safe, {
      x: xRight - f.widthOfTextAtSize(safe, 10),
      y,
      size: 10,
      font: f,
      color: rgb(0.1, 0.1, 0.1)
    })
  }
  const line = () => {
    page.drawLine({
      start: { x: MARGIN, y: y + 4 },
      end: { x: A4.width - MARGIN, y: y + 4 },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7)
    })
  }
  const RIGHT = A4.width - MARGIN

  text('Reisekostenabrechnung', MARGIN, { size: 18, bold: true })
  y -= 22
  if (input.companyName) {
    text(input.companyName, MARGIN, { size: 10 })
    y -= 24
  }
  const facts: Array<[string, string]> = [
    ['Reisende Person', input.travellerName],
    ['Anlass', input.purpose],
    [
      'Reiseziel',
      [input.destination, input.countryCode !== 'DE' ? input.countryCode : '']
        .filter(Boolean)
        .join(', ')
    ],
    ['Beginn', dateTime(input.startAt)],
    ['Ende', dateTime(input.endAt)],
    ['Dauer', `${input.allowances.totalHours.toLocaleString('de-DE')} Stunden`]
  ]
  for (const [label, value] of facts) {
    text(label, MARGIN, { bold: true })
    text(value || '–', MARGIN + 120)
    y -= 15
  }

  y -= 12
  text('Verpflegungsmehraufwand', MARGIN, { size: 12, bold: true })
  y -= 18
  const columns = {
    day: MARGIN,
    kind: MARGIN + 80,
    hours: MARGIN + 220,
    allowance: 390,
    deduction: 465,
    net: RIGHT
  }
  text('Tag', columns.day, { bold: true })
  text('Art', columns.kind, { bold: true })
  right('Stunden', columns.hours + 40, { bold: true })
  right('Pauschale', columns.allowance, { bold: true })
  right('Kürzung', columns.deduction, { bold: true })
  right('Betrag', columns.net, { bold: true })
  y -= 6
  line()
  y -= 10
  for (const day of input.allowances.days) {
    newPageIfNeeded(15)
    text(germanDate(day.date), columns.day)
    text(TRIP_DAY_LABELS[day.kind], columns.kind)
    right(day.hours.toLocaleString('de-DE', { maximumFractionDigits: 2 }), columns.hours + 40)
    right(euro(day.allowanceCents), columns.allowance)
    right(day.deductionCents ? `− ${euro(day.deductionCents)}` : '–', columns.deduction)
    right(euro(day.netCents), columns.net)
    y -= 14
  }
  line()
  y -= 10
  text('Summe Verpflegungsmehraufwand', MARGIN, { bold: true })
  right(euro(input.allowances.allowancesCents), RIGHT, { bold: true })
  y -= 22

  if (input.kilometres > 0) {
    newPageIfNeeded(40)
    text('Fahrtkosten', MARGIN, { size: 12, bold: true })
    y -= 18
    const rate = input.vehicle === 'car' ? '0,30 €' : '0,20 €'
    text(
      `${input.kilometres.toLocaleString('de-DE')} km × ${rate} (${input.vehicle === 'car' ? 'eigener Pkw' : 'anderes Kfz'})`,
      MARGIN
    )
    right(euro(input.allowances.mileageCents), RIGHT, { bold: true })
    y -= 22
  }

  newPageIfNeeded(40)
  text('Belege', MARGIN, { size: 12, bold: true })
  y -= 18
  if (input.receipts.length === 0) {
    text('Keine Belege', MARGIN)
    y -= 14
  }
  for (const receipt of input.receipts) {
    newPageIfNeeded(15)
    text(receipt.date ? germanDate(receipt.date) : '–', MARGIN)
    text(receipt.label + (receipt.pdf ? '' : ' (E-Rechnung, separat)'), MARGIN + 80)
    right(receipt.amountCents === null ? '–' : money(receipt.amountCents, receipt.currency), RIGHT)
    y -= 14
  }
  const receiptsCents = receiptsTotalCents(input.receipts)
  line()
  y -= 10
  text('Summe Belege (EUR)', MARGIN, { bold: true })
  right(euro(receiptsCents), RIGHT, { bold: true })
  y -= 26

  newPageIfNeeded(60)
  const total = input.allowances.allowancesCents + input.allowances.mileageCents + receiptsCents
  text('Erstattungsbetrag', MARGIN, { size: 12, bold: true })
  right(euro(total), RIGHT, { bold: true })
  y -= 16
  text(
    'Verpflegungsmehraufwand und Kilometerpauschale nach § 9 Abs. 4a EStG / § 3 Nr. 16 EStG.',
    MARGIN,
    { size: 8 }
  )
  if (input.notes) {
    y -= 22
    newPageIfNeeded(30)
    text('Anmerkung', MARGIN, { bold: true })
    y -= 14
    for (const part of input.notes.split('\n')) {
      newPageIfNeeded(14)
      text(part.slice(0, 110), MARGIN)
      y -= 13
    }
  }

  // The receipts' own pages after the summary
  for (const receipt of input.receipts) {
    if (!receipt.pdf) continue
    try {
      const source = await PDFDocument.load(receipt.pdf, { ignoreEncryption: true })
      const pages = await doc.copyPages(source, source.getPageIndices())
      for (const copied of pages) doc.addPage(copied)
    } catch {
      // A receipt pdf-lib cannot read is listed above but not attached
    }
  }
  return doc.save()
}
