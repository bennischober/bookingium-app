import type {
  InvoicePartySnapshotDto,
  InvoicePrintDto
} from '../../../../main/api/schemas/invoice.schema'
import { PagedDocument } from '../print/PagedDocument'

// ========================================
// Template catalog (hardcoded by design)
// ========================================

export const INVOICE_TEMPLATES = [
  { value: 'standard', label: 'Standard' },
  { value: 'agency-de', label: 'Agentur (Deutsch)' },
  { value: 'agency-en', label: 'Agentur (Englisch)' }
] as const

export type InvoiceTemplate = (typeof INVOICE_TEMPLATES)[number]['value']

// ========================================
// Formatting helpers
// ========================================

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: currency || 'EUR'
  }).format(value)
}

// Formats date-only ISO strings (YYYY-MM-DD) without timezone pitfalls
function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [year, month, day] = iso.split('-')
  if (!year || !month || !day) return iso
  return `${day}.${month}.${year}`
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 }).format(value)
}

// Highest distinct tax rate across line items, used for "zzgl. X % Ust." labels
function dominantTaxRate(data: InvoicePrintDto): number {
  const rates = data.invoice.lineItems.map((item) => item.taxRate).filter((rate) => rate > 0)
  return rates.length > 0 ? Math.max(...rates) : 0
}

function formatPeriod(data: InvoicePrintDto): string {
  if (data.invoice.periodLabel) return data.invoice.periodLabel
  const start = formatDate(data.invoice.periodStartDate)
  const end = formatDate(data.invoice.periodEndDate)
  if (start && end) return `${start} – ${end}`
  return start || end || '-'
}

// ========================================
// Shared pieces
// ========================================

function Logo({ src }: { src?: string }) {
  if (!src) return null
  // In-flow, right-aligned within the page padding; ~22mm tall like the reference
  return <img src={src} alt="" className="mb-8 ml-auto max-h-[22mm] max-w-[70mm] object-contain" />
}

// Shows the country only for foreign recipients (matches the reference docs:
// domestic recipients get no country line, cross-border ones do)
function AddressBlock({
  party,
  issuerCountryCode
}: {
  party: InvoicePartySnapshotDto | null
  issuerCountryCode?: string
}) {
  if (!party) return null
  const isForeign =
    issuerCountryCode && party.countryCode && issuerCountryCode !== party.countryCode
  return (
    <div className="text-[10pt] leading-snug">
      <div>{party.legalName}</div>
      {(party.street || party.streetNumber) && (
        <div>
          {party.street} {party.streetNumber}
        </div>
      )}
      {(party.zipCode || party.city) && (
        <div>
          {party.zipCode} {party.city}
        </div>
      )}
      {isForeign && party.country && <div>{party.country}</div>}
    </div>
  )
}

// Centered small-print footer. One data-driven layout for both languages:
// address (no country for domestic), tax/register, court/VAT/e-mail,
// phone/website, bank, SWIFT/BIC + IBAN. Account holder only appears when it
// differs from the legal name (like the PWW reference). Labels per language.
function CenteredLegalFooter({
  issuer,
  lang
}: {
  issuer: InvoicePartySnapshotDto | null
  lang: 'de' | 'en'
}) {
  if (!issuer) return null

  const L = {
    address: lang === 'de' ? 'Adresse' : 'Address',
    taxNumber: lang === 'de' ? 'Steuernummer' : 'Tax number',
    registerNo: lang === 'de' ? 'HR-Nr' : 'Commercial reg. no.',
    registerCourt: lang === 'de' ? 'Amtsgericht' : 'Register court',
    vatId: lang === 'de' ? 'USt-IdNr.' : 'VAT ID',
    email: lang === 'de' ? 'E-Mail' : 'E-mail',
    website: lang === 'de' ? 'Website' : 'Website',
    phone: lang === 'de' ? 'Tel.' : 'Phone',
    accountHolder: lang === 'de' ? 'Kontoinhaber' : 'Account holder',
    bank: lang === 'de' ? 'Bank' : 'Bank',
    swift: 'SWIFT/BIC',
    iban: 'IBAN'
  }

  const addressValue = [
    issuer.legalName,
    [issuer.street, issuer.streetNumber].filter(Boolean).join(' ').trim(),
    [issuer.zipCode, issuer.city].filter(Boolean).join(' ').trim()
  ]
    .filter(Boolean)
    .join(', ')

  const holderDiffers = issuer.accountHolder && issuer.accountHolder !== issuer.legalName

  const lines: Array<Array<[string, string]>> = []
  if (addressValue) lines.push([[L.address, addressValue]])

  const line2: Array<[string, string]> = []
  if (issuer.taxNumber) line2.push([L.taxNumber, issuer.taxNumber])
  if (issuer.commercialRegisterNo) line2.push([L.registerNo, issuer.commercialRegisterNo])
  if (line2.length > 0) lines.push(line2)

  const line3: Array<[string, string]> = []
  if (issuer.registerCourt) line3.push([L.registerCourt, issuer.registerCourt])
  if (issuer.vatNumber || issuer.ustNumber)
    line3.push([L.vatId, issuer.vatNumber || issuer.ustNumber])
  if (issuer.email) line3.push([L.email, issuer.email])
  if (line3.length > 0) lines.push(line3)

  const line4: Array<[string, string]> = []
  if (issuer.phone) line4.push([L.phone, issuer.phone])
  if (issuer.website) line4.push([L.website, issuer.website])
  if (line4.length > 0) lines.push(line4)

  if (holderDiffers) lines.push([[L.accountHolder, issuer.accountHolder]])
  if (issuer.bankName) lines.push([[L.bank, issuer.bankName]])

  const line6: Array<[string, string]> = []
  if (issuer.bic) line6.push([L.swift, issuer.bic])
  if (issuer.iban) line6.push([L.iban, issuer.iban])
  if (line6.length > 0) lines.push(line6)

  if (lines.length === 0) return null

  return (
    <div className="mt-12 break-inside-avoid text-center text-[8.5pt] leading-relaxed text-black">
      {lines.map((line, index) => (
        <div key={index}>
          {line.map(([label, value], itemIndex) => (
            <span key={label} className="whitespace-nowrap">
              {itemIndex > 0 && <span className="ml-6"> </span>}
              <span className="font-bold">{label}:</span> {value}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

// Hatch-shaded header cell style (Word-style diagonal stripes, like the reference)
const HATCH_STYLE = {
  backgroundImage:
    'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 3px)'
}

// Gray meta band (Kuenstler | Zeitraum | ... / Artist | Period | ...).
// The reference documents use Word-style diagonal-hatch shading with no cell
// grid; borders only appear as thin rules under the header and below the row.
function MetaBand({ columns, values }: { columns: string[]; values: string[] }) {
  return (
    <table className="mt-4 w-full table-fixed border-collapse text-[9.5pt]">
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column}
              className="border-b border-neutral-400 px-2 py-1 text-left font-semibold"
              style={HATCH_STYLE}
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {values.map((value, index) => (
            <td key={index} className="border-b border-neutral-400 px-2 py-1 align-top">
              {value}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

// ========================================
// Agency template (single layout, DE/EN via dictionary)
// ========================================

type AgencyStrings = {
  heading: string
  meta: [string, string, string, string, string]
  intro: string
  items: [string, string, string]
  sumNet: string
  plusVat: (rate: string) => string
  reverseCharge: string
  total: string
  paymentDue: (date: string) => string
  thanks: string
}

const AGENCY_STRINGS: Record<'de' | 'en', AgencyStrings> = {
  de: {
    heading: 'RECHNUNG',
    meta: ['Künstler', 'Zeitraum', 'Leistungsort', 'Rechnungsdatum', 'Rechnung Nr.'],
    intro: 'Hiermit berechnen wir vereinbarungsgemäß:',
    items: ['Leistung', 'Mwst.', 'Netto'],
    sumNet: 'Summe Netto:',
    plusVat: (rate) => `zzgl. ${rate} % Ust.:`,
    reverseCharge: 'Reverse Charge Procedure applies',
    total: 'Gesamtbetrag:',
    paymentDue: (date) => `Bitte überweisen Sie den Betrag bis zum ${date} auf unser Konto.`,
    thanks: 'Wir bedanken uns recht herzlich für die gute Zusammenarbeit.'
  },
  en: {
    heading: 'INVOICE',
    meta: ['Artist', 'Period', 'Place of performance', 'Invoice date', 'Invoice No.'],
    intro: 'Herewith we charge our agreed services:',
    items: ['Performance', 'VAT', 'Net'],
    sumNet: 'Sum Net:',
    plusVat: (rate) => `plus ${rate} % VAT:`,
    reverseCharge: 'Reverse Charge Procedure applies',
    total: 'Sum total:',
    paymentDue: (date) => `Please transfer the amount until ${date} to our account.`,
    thanks:
      'We would like to thank you for your cooperation and ask you to transfer the money to our account.'
  }
}

// Single agency layout for both languages (cleaner design of the two
// reference documents, independent of the issuing company):
// logo top-right, recipient block, underlined heading, hatch-shaded meta band
// with 5 columns (incl. place of performance), 3-column items table,
// stacked totals with rules above Summe Netto and the total,
// closing sentence, centered data-driven footer
function AgencyTemplate({
  data,
  lang,
  logoUrl
}: {
  data: InvoicePrintDto
  lang: 'de' | 'en'
  logoUrl?: string
}) {
  const { invoice, issuer, recipient } = data
  const t = AGENCY_STRINGS[lang]
  const taxRate = dominantTaxRate(data)
  const hasVat = invoice.subtotalTaxAmount > 0

  return (
    <>
      <Logo src={logoUrl} />

      <div className="mt-[24mm]">
        <AddressBlock party={recipient} issuerCountryCode={issuer?.countryCode} />
      </div>

      <div className="mt-[16mm] text-[16pt] font-bold">{t.heading}</div>

      <MetaBand
        columns={t.meta}
        values={[
          invoice.recipientName,
          formatPeriod(data),
          data.venueName || '-',
          formatDate(invoice.issueDate),
          invoice.invoiceNumber === null
            ? lang === 'en'
              ? 'Draft'
              : 'Entwurf'
            : String(invoice.invoiceNumber)
        ]}
      />

      <p className="mt-6 text-[10pt]">{t.intro}</p>

      <table className="mt-4 w-full border-collapse text-[9.5pt]">
        <thead>
          <tr>
            <th
              className="border-b border-neutral-400 px-2 py-1 text-left font-semibold"
              style={HATCH_STYLE}
            >
              {t.items[0]}
            </th>
            <th
              className="w-[25mm] border-b border-neutral-400 px-2 py-1 text-left font-semibold"
              style={HATCH_STYLE}
            >
              {t.items[1]}
            </th>
            <th
              className="w-[40mm] border-b border-neutral-400 px-2 py-1 text-right font-semibold"
              style={HATCH_STYLE}
            >
              {t.items[2]}
            </th>
          </tr>
        </thead>
        <tbody>
          {invoice.lineItems.map((item) => (
            <tr key={item.id} className="border-b border-neutral-300">
              <td className="px-2 py-1 align-top">{item.description}</td>
              <td className="px-2 py-1 align-top">{formatQuantity(item.taxRate)} %</td>
              <td className="px-2 py-1 text-right align-top">
                {formatMoney(item.lineNetAmount, invoice.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Rules only above Summe Netto and the total, like the reference */}
      <div className="mt-6 ml-auto w-[90mm] break-inside-avoid text-[10pt]">
        <div className="flex justify-between border-t border-neutral-400 py-1">
          <span>{t.sumNet}</span>
          <span>{formatMoney(invoice.subtotalNetAmount, invoice.currency)}</span>
        </div>
        {hasVat ? (
          <div className="flex justify-between py-1">
            <span>{t.plusVat(formatQuantity(taxRate))}</span>
            <span>{formatMoney(invoice.subtotalTaxAmount, invoice.currency)}</span>
          </div>
        ) : (
          <div className="flex justify-between py-1">
            <span>{invoice.reverseChargeNote || t.reverseCharge}</span>
            <span>{formatMoney(invoice.subtotalTaxAmount, invoice.currency)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-neutral-400 py-1 font-bold">
          <span>{t.total}</span>
          <span>{formatMoney(invoice.totalGrossAmount, invoice.currency)}</span>
        </div>
      </div>

      <p className="mt-6 text-[10pt]">
        {invoice.dueDate ? t.paymentDue(formatDate(invoice.dueDate)) : t.thanks}
      </p>

      {invoice.notes && <p className="mt-4 text-[9pt] text-neutral-700">{invoice.notes}</p>}

      <CenteredLegalFooter issuer={issuer} lang={lang} />
    </>
  )
}

// ========================================
// Standard template
// ========================================

function StandardTemplate({ data }: { data: InvoicePrintDto }) {
  const { invoice, issuer, recipient } = data
  return (
    <>
      <div className="flex justify-between items-start">
        <div className="text-[10pt] leading-snug">
          {issuer && (
            <div>
              <div className="font-medium">{issuer.legalName}</div>
              {(issuer.street || issuer.streetNumber) && (
                <div>
                  {issuer.street} {issuer.streetNumber}
                </div>
              )}
              {(issuer.zipCode || issuer.city) && (
                <div>
                  {issuer.zipCode} {issuer.city}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[20pt] font-bold tracking-wide">RECHNUNG</div>
          <div className="mt-2 text-[10pt]">
            <div>Nr. {invoice.invoiceNumber ?? 'Entwurf'}</div>
            <div>Datum: {formatDate(invoice.issueDate)}</div>
            {invoice.dueDate && <div>Fällig: {formatDate(invoice.dueDate)}</div>}
          </div>
        </div>
      </div>

      <hr className="my-6 border-neutral-300" />

      <div className="flex justify-between items-start gap-8">
        <div className="w-1/2">
          <div className="text-[10pt] leading-snug">
            <div className="font-semibold mb-1">Rechnungsempfänger</div>
            <AddressBlock party={recipient} issuerCountryCode={issuer?.countryCode} />
          </div>
        </div>
        <div className="w-1/2 text-[10pt] leading-snug">
          {invoice.dealMemoName && (
            <div>
              <span className="font-semibold">Event:</span> {invoice.dealMemoName}
            </div>
          )}
          {invoice.periodLabel && (
            <div>
              <span className="font-semibold">Zeitraum:</span> {invoice.periodLabel}
            </div>
          )}
          {(invoice.periodStartDate || invoice.periodEndDate) && (
            <div>
              <span className="font-semibold">Leistungszeitraum:</span>{' '}
              {formatDate(invoice.periodStartDate)} – {formatDate(invoice.periodEndDate)}
            </div>
          )}
        </div>
      </div>

      <table className="mt-8 w-full text-[9.5pt]">
        <thead>
          <tr className="border-b border-neutral-400 text-left">
            <th className="py-2 pr-2 font-semibold">Pos.</th>
            <th className="py-2 pr-2 font-semibold">Beschreibung</th>
            <th className="py-2 pr-2 text-right font-semibold">Menge</th>
            <th className="py-2 pr-2 font-semibold">Einheit</th>
            <th className="py-2 pr-2 text-right font-semibold">Netto</th>
            <th className="py-2 pr-2 text-right font-semibold">MwSt. %</th>
            <th className="py-2 pr-2 text-right font-semibold">MwSt.</th>
            <th className="py-2 text-right font-semibold">Brutto</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lineItems.map((item) => (
            <tr key={item.id} className="border-b border-neutral-200 align-top">
              <td className="py-2 pr-2">{item.position}</td>
              <td className="py-2 pr-2">{item.description}</td>
              <td className="py-2 pr-2 text-right">{formatQuantity(item.quantity)}</td>
              <td className="py-2 pr-2">{item.unit}</td>
              <td className="py-2 pr-2 text-right">
                {formatMoney(item.lineNetAmount, invoice.currency)}
              </td>
              <td className="py-2 pr-2 text-right">{formatQuantity(item.taxRate)}%</td>
              <td className="py-2 pr-2 text-right">
                {formatMoney(item.lineTaxAmount, invoice.currency)}
              </td>
              <td className="py-2 text-right">
                {formatMoney(item.lineGrossAmount, invoice.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 ml-auto w-[70mm] break-inside-avoid text-[10pt]">
        <div className="flex justify-between py-1">
          <span>Zwischensumme (netto)</span>
          <span>{formatMoney(invoice.subtotalNetAmount, invoice.currency)}</span>
        </div>
        <div className="flex justify-between py-1">
          <span>MwSt.</span>
          <span>{formatMoney(invoice.subtotalTaxAmount, invoice.currency)}</span>
        </div>
        <div className="flex justify-between border-t border-neutral-400 py-2 font-bold text-[11pt]">
          <span>Gesamt</span>
          <span>{formatMoney(invoice.totalGrossAmount, invoice.currency)}</span>
        </div>
      </div>

      <div className="mt-8 space-y-2 text-[9pt] text-neutral-700">
        {invoice.reverseChargeNote && <p>{invoice.reverseChargeNote}</p>}
        {invoice.paymentTerms && (
          <p>
            <span className="font-semibold text-black">Zahlungsbedingungen: </span>
            {invoice.paymentTerms}
          </p>
        )}
        {invoice.notes && (
          <p>
            <span className="font-semibold text-black">Anmerkungen: </span>
            {invoice.notes}
          </p>
        )}
      </div>

      <CenteredLegalFooter issuer={issuer} lang="de" />
    </>
  )
}

// ========================================
// Document shell (A4 sheet + draft watermark)
// ========================================

export function InvoiceDocument({
  data,
  template,
  logoUrl
}: {
  data: InvoicePrintDto
  template: InvoiceTemplate
  logoUrl?: string
}) {
  // Drafts and cancelled invoices carry a watermark on every print
  const watermark =
    data.invoice.status === 'draft'
      ? template === 'agency-en'
        ? 'DRAFT'
        : 'ENTWURF'
      : data.invoice.status === 'cancelled'
        ? template === 'agency-en'
          ? 'CANCELLED'
          : 'STORNIERT'
        : null

  return (
    <PagedDocument>
      {/* fixed in print: Chromium repeats fixed elements on every page, centered
          per page. inline-block so the rotation applies; translucent so it
          never hides the text underneath. */}
      {watermark && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center print:fixed">
          <span className="inline-block rotate-[-30deg] text-[60pt] font-bold text-black/10 select-none">
            {watermark}
          </span>
        </div>
      )}

      {template === 'standard' && <StandardTemplate data={data} />}
      {template === 'agency-de' && <AgencyTemplate data={data} lang="de" logoUrl={logoUrl} />}
      {template === 'agency-en' && <AgencyTemplate data={data} lang="en" logoUrl={logoUrl} />}
    </PagedDocument>
  )
}
