import type {
  InvoicePartySnapshotDto,
  InvoicePrintDto
} from '../../../../main/api/schemas/invoice.schema'
import { PagedDocument } from '../print/PagedDocument'
import { unitLabelOf } from '../../../../main/einvoice/codes'
import { fromCents } from '../../../../main/einvoice/amounts'
import {
  needsBuyerVatId,
  serviceDateOf,
  taxNoteOf,
  vatGroupLabel,
  vatGroups,
  type Lang
} from '../../../../main/invoice/taxSummary'
import { PaymentQr } from './PaymentQr'

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

// German invoices "3.500,00 €", English ones "€3,500.00"
const NUMBER_LOCALE: Record<Lang, string> = { de: 'de-DE', en: 'en-GB' }

function formatMoney(value: number, currency: string, lang: Lang = 'de'): string {
  return new Intl.NumberFormat(NUMBER_LOCALE[lang], {
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

function formatQuantity(value: number, lang: Lang = 'de'): string {
  return new Intl.NumberFormat(NUMBER_LOCALE[lang], { maximumFractionDigits: 3 }).format(value)
}

/** "19 %" in German, "19%" in English */
function formatRate(rate: number, lang: Lang): string {
  return lang === 'en' ? `${formatQuantity(rate, lang)}%` : `${formatQuantity(rate)} %`
}

// Stornorechnung: number and date of the invoice it cancels
function cancellationOf(data: InvoicePrintDto): { number: string; date: string } | null {
  const { invoice } = data
  if (invoice.kind !== 'cancellation') return null
  return {
    number: String(invoice.cancelsInvoiceNumber ?? ''),
    date: formatDate(invoice.cancelsInvoiceIssueDate)
  }
}

// ========================================
// Shared pieces
// ========================================

function Logo({ src }: { src?: string }) {
  if (!src) return null
  // Top right within the page padding; ~22mm tall like the reference
  return <img src={src} alt="" className="max-h-[22mm] max-w-[70mm] object-contain" />
}

// Issuer in one small line above the recipient (return address of a window
// envelope letter, DIN 5008)
function SenderLine({ issuer }: { issuer: InvoicePartySnapshotDto | null }) {
  if (!issuer) return null
  const parts = [
    issuer.legalName,
    [issuer.street, issuer.streetNumber].filter(Boolean).join(' ').trim(),
    [issuer.zipCode, issuer.city].filter(Boolean).join(' ').trim()
  ].filter(Boolean)
  return (
    <div className="mb-2 inline-block border-b border-neutral-400 text-[7.5pt] text-neutral-600">
      {parts.join(' · ')}
    </div>
  )
}

// Shows the country only for foreign recipients (matches the reference docs:
// domestic recipients get no country line, cross-border ones do). The VAT ID
// is printed when the invoice needs it (reverse charge, § 14a UStG).
function AddressBlock({
  party,
  issuerCountryCode,
  vatIdLabel
}: {
  party: InvoicePartySnapshotDto | null
  issuerCountryCode?: string
  vatIdLabel?: string
}) {
  if (!party) return null
  const isForeign =
    issuerCountryCode && party.countryCode && issuerCountryCode !== party.countryCode
  const vatId = party.vatNumber || party.ustNumber
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
      {vatIdLabel && vatId && (
        <div className="mt-1">
          {vatIdLabel}: {vatId}
        </div>
      )}
    </div>
  )
}

// Net total, VAT per rate (and per reason at 0 %), gross total. With one
// VAT group the net total is its base; with several each line names it.
function Totals({
  data,
  lang,
  labels,
  className
}: {
  data: InvoicePrintDto
  lang: Lang
  labels: { net: string; total: string }
  className: string
}) {
  const { invoice } = data
  const money = (value: number) => formatMoney(value, invoice.currency, lang)
  const groups = vatGroups(data)
  return (
    <div className={className}>
      <div className="flex justify-between gap-4 border-t border-neutral-400 py-1">
        <span>{labels.net}</span>
        <span>{money(invoice.subtotalNetAmount)}</span>
      </div>
      {groups.map((group) => (
        <div key={`${group.rate}-${group.taxCode}`} className="flex justify-between gap-4 py-1">
          <span>
            {vatGroupLabel(group, groups.length === 1, lang, (cents) => money(fromCents(cents)))}
            {labels.net.endsWith(':') && ':'}
          </span>
          <span className="whitespace-nowrap">
            {money(groups.length === 1 ? invoice.subtotalTaxAmount : fromCents(group.taxCents))}
          </span>
        </div>
      ))}
      <div className="flex justify-between gap-4 border-t border-neutral-400 py-1 font-bold">
        <span>{labels.total}</span>
        <span>{money(invoice.totalGrossAmount)}</span>
      </div>
    </div>
  )
}

// Payment QR code on the left, totals on the right: the free space next to
// the totals takes the code, so it costs no height
function TotalsRow({
  data,
  lang,
  paymentQr,
  labels,
  totalsClassName
}: {
  data: InvoicePrintDto
  lang: Lang
  paymentQr: boolean
  labels: { net: string; total: string }
  totalsClassName: string
}) {
  return (
    <div className="mt-6 flex break-inside-avoid items-start gap-6">
      {paymentQr && <PaymentQr data={data} lang={lang} />}
      <Totals
        data={data}
        lang={lang}
        labels={labels}
        className={`ml-auto shrink-0 ${totalsClassName}`}
      />
    </div>
  )
}

// Steuerhinweis (exemption reason, reverse charge) right under the totals
function TaxNote({ data, lang }: { data: InvoicePrintDto; lang: Lang }) {
  const note = taxNoteOf(data, lang)
  if (!note) return null
  return <p className="mt-3 text-[9pt]">{note}</p>
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

// Hatch-shaded header cell style (Word-style diagonal stripes, like the
// reference). A tiled SVG, not a CSS gradient: Chromium sometimes prints
// repeating gradients as function-based shadings (ShadingType 1), which
// pdf.js (the preview) can't draw and fills pink.
const HATCH_TILE =
  "<svg xmlns='http://www.w3.org/2000/svg' width='3' height='3'>" +
  "<path d='M-1 1L1 -1M0 3L3 0M2 4L4 2' stroke='#e0e0e0' stroke-width='1'/></svg>"
const HATCH_STYLE = {
  backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(HATCH_TILE)}")`
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
  // Artist, place of performance, invoice date, invoice no. (the service
  // date column is named by serviceDateOf)
  meta: { artist: string; place: string; date: string; number: string }
  intro: string
  items: [string, string, string]
  sumNet: string
  total: string
  vatId: string
  paymentDue: (date: string) => string
  thanks: string
  // Stornorechnung
  cancellationHeading: string
  cancellationIntro: string
  cancels: (number: string, date: string) => string
  offset: (number: string) => string
}

const AGENCY_STRINGS: Record<'de' | 'en', AgencyStrings> = {
  de: {
    heading: 'RECHNUNG',
    meta: {
      artist: 'Künstler',
      place: 'Leistungsort',
      date: 'Rechnungsdatum',
      number: 'Rechnung Nr.'
    },
    intro: 'Hiermit berechnen wir vereinbarungsgemäß:',
    items: ['Leistung', 'USt.', 'Netto'],
    sumNet: 'Summe Netto:',
    total: 'Gesamtbetrag:',
    vatId: 'USt-IdNr.',
    paymentDue: (date) => `Bitte überweisen Sie den Betrag bis zum ${date} auf unser Konto.`,
    thanks: 'Wir bedanken uns recht herzlich für die gute Zusammenarbeit.',
    cancellationHeading: 'STORNORECHNUNG',
    cancellationIntro: 'Hiermit stornieren wir:',
    cancels: (number, date) => `Storno zu Rechnung Nr. ${number} vom ${date}`,
    offset: (number) => `Der Betrag wird mit der Rechnung Nr. ${number} verrechnet.`
  },
  en: {
    heading: 'INVOICE',
    meta: {
      artist: 'Artist',
      place: 'Place of performance',
      date: 'Invoice date',
      number: 'Invoice No.'
    },
    intro: 'As agreed, we invoice the following services:',
    items: ['Service', 'VAT', 'Net'],
    sumNet: 'Net total:',
    total: 'Total:',
    vatId: 'VAT ID',
    paymentDue: (date) => `Please transfer the amount by ${date} to our account.`,
    cancellationHeading: 'CREDIT NOTE',
    cancellationIntro: 'Herewith we cancel:',
    cancels: (number, date) => `Cancellation of invoice no. ${number} dated ${date}`,
    offset: (number) => `This amount is offset against invoice no. ${number}.`,
    thanks:
      'We would like to thank you for your cooperation and ask you to transfer the money to our account.'
  }
}

// Single agency layout for both languages (cleaner design of the two
// reference documents, independent of the issuing company):
// logo top-right next to the recipient block (sender line above it, at the
// window position of a DIN 5008 letter), underlined heading, hatch-shaded
// meta band (artist, service date, place, invoice date and number),
// 3-column items table, payment QR code next to the totals, tax note,
// closing sentence, centered data-driven footer
function AgencyTemplate({
  data,
  lang,
  logoUrl,
  paymentQr
}: {
  data: InvoicePrintDto
  lang: 'de' | 'en'
  logoUrl?: string
  paymentQr: boolean
}) {
  const { invoice, issuer, recipient } = data
  const t = AGENCY_STRINGS[lang]
  const cancels = cancellationOf(data)
  const serviceDate = serviceDateOf(data, lang)

  return (
    <>
      <div className="flex items-start justify-between gap-8">
        <div className="pt-[38mm]">
          <SenderLine issuer={issuer} />
          <AddressBlock
            party={recipient}
            issuerCountryCode={issuer?.countryCode}
            vatIdLabel={needsBuyerVatId(data) ? t.vatId : undefined}
          />
        </div>
        <Logo src={logoUrl} />
      </div>

      <div className="mt-[10mm] text-[16pt] font-bold">
        {cancels ? t.cancellationHeading : t.heading}
      </div>
      {cancels && <div className="mt-1 text-[10pt]">{t.cancels(cancels.number, cancels.date)}</div>}

      <MetaBand
        columns={[t.meta.artist, serviceDate.label, t.meta.place, t.meta.date, t.meta.number]}
        values={[
          data.bandName || '-',
          serviceDate.value,
          // A management share is performed at the management's seat
          data.venueName || (data.managementShare && issuer?.city) || '-',
          formatDate(invoice.issueDate),
          invoice.invoiceNumber === null
            ? lang === 'en'
              ? 'Draft'
              : 'Entwurf'
            : String(invoice.invoiceNumber)
        ]}
      />

      <p className="mt-6 text-[10pt]">{cancels ? t.cancellationIntro : t.intro}</p>

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
              <td className="px-2 py-1 align-top">
                {/* Quantity is part of the service description unless it is
                    one (minus one on a Stornorechnung) */}
                {Math.abs(item.quantity) !== 1 && `${formatQuantity(item.quantity, lang)} × `}
                {item.description}
              </td>
              <td className="px-2 py-1 align-top">{formatRate(item.taxRate, lang)}</td>
              <td className="px-2 py-1 text-right align-top">
                {formatMoney(item.lineNetAmount, invoice.currency, lang)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <TotalsRow
        data={data}
        lang={lang}
        paymentQr={paymentQr}
        labels={{ net: t.sumNet, total: t.total }}
        totalsClassName="w-[90mm] text-[10pt]"
      />
      <TaxNote data={data} lang={lang} />

      <p className="mt-4 text-[10pt]">
        {cancels
          ? t.offset(cancels.number)
          : invoice.dueDate
            ? t.paymentDue(formatDate(invoice.dueDate))
            : t.thanks}
      </p>

      {invoice.notes && <p className="mt-4 text-[9pt] text-neutral-700">{invoice.notes}</p>}

      <CenteredLegalFooter issuer={issuer} lang={lang} />
    </>
  )
}

// ========================================
// Standard template
// ========================================

function StandardTemplate({ data, paymentQr }: { data: InvoicePrintDto; paymentQr: boolean }) {
  const { invoice, issuer, recipient } = data
  const cancels = cancellationOf(data)
  const serviceDate = serviceDateOf(data, 'de')
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
          <div className="text-[20pt] font-bold tracking-wide">
            {cancels ? 'STORNORECHNUNG' : 'RECHNUNG'}
          </div>
          <div className="mt-2 text-[10pt]">
            {cancels && (
              <div>
                zu Rechnung Nr. {cancels.number} vom {cancels.date}
              </div>
            )}
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
            <AddressBlock
              party={recipient}
              issuerCountryCode={issuer?.countryCode}
              vatIdLabel={needsBuyerVatId(data) ? 'USt-IdNr.' : undefined}
            />
          </div>
        </div>
        <div className="w-1/2 text-[10pt] leading-snug">
          {data.bandName && (
            <div>
              <span className="font-semibold">Künstler:</span> {data.bandName}
            </div>
          )}
          {invoice.dealMemoName && (
            <div>
              <span className="font-semibold">Event:</span> {invoice.dealMemoName}
            </div>
          )}
          {invoice.periodLabel && serviceDate.value !== invoice.periodLabel && (
            <div>
              <span className="font-semibold">Zeitraum:</span> {invoice.periodLabel}
            </div>
          )}
          <div>
            <span className="font-semibold">{serviceDate.label}:</span> {serviceDate.value}
          </div>
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
              <td className="py-2 pr-2">{unitLabelOf(item.unit)}</td>
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

      <TotalsRow
        data={data}
        lang="de"
        paymentQr={paymentQr}
        labels={{ net: 'Zwischensumme (netto)', total: 'Gesamt' }}
        totalsClassName="w-[85mm] text-[10pt]"
      />
      <TaxNote data={data} lang="de" />

      <div className="mt-4 space-y-2 text-[9pt] text-neutral-700">
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
  logoUrl,
  paymentQr = true
}: {
  data: InvoicePrintDto
  template: InvoiceTemplate
  logoUrl?: string
  /** EPC payment QR code on payable invoices (setting) */
  paymentQr?: boolean
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

      {template === 'standard' && <StandardTemplate data={data} paymentQr={paymentQr} />}
      {template === 'agency-de' && (
        <AgencyTemplate data={data} lang="de" logoUrl={logoUrl} paymentQr={paymentQr} />
      )}
      {template === 'agency-en' && (
        <AgencyTemplate data={data} lang="en" logoUrl={logoUrl} paymentQr={paymentQr} />
      )}
    </PagedDocument>
  )
}
