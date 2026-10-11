import type { InvoicePartySnapshotDto, InvoicePrintDto } from '../../../../main/api/schemas/invoice.schema'

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

// Centered small-print footer matching the BMM reference line grouping:
// 1) Adresse (name, street • zip city)  2) Steuernummer + HR-Nr
// 3) Amtsgericht + USt-IdNr + E-Mail    4) Tel. + Website
// 5) Bank                               6) SWIFT/BIC + IBAN
function CenteredLegalFooter({ issuer }: { issuer: InvoicePartySnapshotDto | null }) {
  if (!issuer) return null

  const addressValue = [
    issuer.legalName,
    [issuer.street, issuer.streetNumber].filter(Boolean).join(' ').trim(),
    [issuer.zipCode, issuer.city].filter(Boolean).join(' ').trim()
  ]
    .filter(Boolean)
    .join(', ')

  const lines: Array<Array<[string, string]>> = []
  if (addressValue) lines.push([['Adresse', addressValue]])

  const line2: Array<[string, string]> = []
  if (issuer.taxNumber) line2.push(['Steuernummer', issuer.taxNumber])
  if (issuer.commercialRegisterNo) line2.push(['HR-Nr', issuer.commercialRegisterNo])
  if (line2.length > 0) lines.push(line2)

  const line3: Array<[string, string]> = []
  if (issuer.registerCourt) line3.push(['Amtsgericht', issuer.registerCourt])
  if (issuer.vatNumber || issuer.ustNumber) line3.push(['USt-IdNr.', issuer.vatNumber || issuer.ustNumber])
  if (issuer.email) line3.push(['E-Mail', issuer.email])
  if (line3.length > 0) lines.push(line3)

  const line4: Array<[string, string]> = []
  if (issuer.phone) line4.push(['Tel.', issuer.phone])
  if (issuer.website) line4.push(['Website', issuer.website])
  if (line4.length > 0) lines.push(line4)

  if (issuer.bankName) lines.push([['Bank', issuer.bankName]])

  const line6: Array<[string, string]> = []
  if (issuer.bic) line6.push(['SWIFT/BIC', issuer.bic])
  if (issuer.iban) line6.push(['IBAN', issuer.iban])
  if (line6.length > 0) lines.push(line6)

  return (
    <div className="mt-12 text-center text-[8.5pt] leading-relaxed text-black">
      {lines.map((line, index) => (
        <div key={index}>
          {line.map(([label, value], itemIndex) => (
            <span key={label} className="whitespace-nowrap">
              {itemIndex > 0 && <span className="ml-6"> </span>}
              <span className="font-bold">{label}</span> {value}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

// Centered footer for the English template (PWW reference):
// Address: • Account holder: • SWIFT/BIC + IBAN: • Bank:
function CenteredLegalFooterEn({ issuer }: { issuer: InvoicePartySnapshotDto | null }) {
  if (!issuer) return null

  const addressValue = [
    issuer.legalName,
    [issuer.street, issuer.streetNumber].filter(Boolean).join(' ').trim(),
    [issuer.zipCode, issuer.city].filter(Boolean).join(' ').trim(),
    issuer.country
  ]
    .filter(Boolean)
    .join(' • ')

  const lines: Array<Array<[string, string]>> = []
  if (addressValue) lines.push([['Address', addressValue]])
  if (issuer.accountHolder) lines.push([['Account holder', issuer.accountHolder]])

  const swiftIban: Array<[string, string]> = []
  if (issuer.bic) swiftIban.push(['SWIFT/BIC', issuer.bic])
  if (issuer.iban) swiftIban.push(['IBAN', issuer.iban])
  if (swiftIban.length > 0) lines.push(swiftIban)

  if (issuer.bankName) lines.push([['Bank', issuer.bankName]])

  if (lines.length === 0) return null

  return (
    <div className="mt-12 text-center text-[8.5pt] leading-relaxed text-black">
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

// Gray-shaded meta band (Kuenstler | Zeitraum | ... on DE, Artist | Period | ... on EN).
// The reference documents use a Word-style diagonal-hatch header shading with no
// cell grid; borders only appear as thin rules under the header and below the row.
function MetaBand({
  columns,
  values
}: {
  columns: string[]
  values: string[]
}) {
  return (
    <table className="mt-4 w-full table-fixed border-collapse text-[9.5pt]">
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column}
              className="border-b border-neutral-400 px-2 py-1 text-left font-semibold"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 3px)'
              }}
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
// Template variants
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
            <div>
              Nr. {invoice.companyId}-{invoice.invoiceNumber}
            </div>
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
              <td className="py-2 pr-2 text-right">{formatMoney(item.lineNetAmount, invoice.currency)}</td>
              <td className="py-2 pr-2 text-right">{formatQuantity(item.taxRate)}%</td>
              <td className="py-2 pr-2 text-right">{formatMoney(item.lineTaxAmount, invoice.currency)}</td>
              <td className="py-2 text-right">{formatMoney(item.lineGrossAmount, invoice.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 ml-auto w-[70mm] text-[10pt]">
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

      <CenteredLegalFooter issuer={issuer} />
    </>
  )
}

// Modeled after the BMM AG reference invoice (bmm_ag_invoice.png):
// logo top-right, recipient block, RECHNUNG, shaded meta band,
// shaded Leistung/Mwst./Netto items table, ruled totals, centered footer
function AgencyDeTemplate({ data, logoUrl }: { data: InvoicePrintDto; logoUrl?: string }) {
  const { invoice, issuer, recipient } = data
  const taxRate = dominantTaxRate(data)
  const hasVat = invoice.subtotalTaxAmount > 0

  return (
    <>
      <Logo src={logoUrl} />

      <div className="mt-[24mm]">
        <AddressBlock party={recipient} issuerCountryCode={issuer?.countryCode} />
      </div>

      <div className="mt-[16mm] text-[16pt] font-bold underline">RECHNUNG</div>

      <MetaBand
        columns={['Künstler', 'Zeitraum', 'Leistungsort', 'Rechnungsdatum', 'Rechnung Nr.']}
        values={[
          invoice.recipientName,
          formatPeriod(data),
          data.venueName || '-',
          formatDate(invoice.issueDate),
          String(invoice.invoiceNumber)
        ]}
      />

      <p className="mt-6 text-[10pt]">Hiermit berechnen wir vereinbarungsgemäß:</p>

      <table className="mt-4 w-full border-collapse text-[9.5pt]">
        <thead>
          <tr>
            <th
              className="border-b border-neutral-400 px-2 py-1 text-left font-semibold"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 3px)'
              }}
            >
              Leistung
            </th>
            <th
              className="w-[25mm] border-b border-neutral-400 px-2 py-1 text-left font-semibold"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 3px)'
              }}
            >
              Mwst.
            </th>
            <th
              className="w-[40mm] border-b border-neutral-400 px-2 py-1 text-right font-semibold"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 3px)'
              }}
            >
              Netto
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

      {/* Rules only above Summe Netto and Gesamtbetrag, like the reference */}
      <div className="mt-6 ml-auto w-[90mm] text-[10pt]">
        <div className="flex justify-between border-t border-neutral-400 py-1">
          <span>Summe Netto:</span>
          <span>{formatMoney(invoice.subtotalNetAmount, invoice.currency)}</span>
        </div>
        {hasVat && (
          <div className="flex justify-between py-1">
            <span>zzgl. {formatQuantity(taxRate)} % Ust.:</span>
            <span>{formatMoney(invoice.subtotalTaxAmount, invoice.currency)}</span>
          </div>
        )}
        {invoice.reverseChargeNote && (
          <div className="flex justify-between py-1">
            <span>{invoice.reverseChargeNote}</span>
            <span>{formatMoney(invoice.subtotalTaxAmount, invoice.currency)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-neutral-400 py-1 font-bold">
          <span>Gesamtbetrag:</span>
          <span>{formatMoney(invoice.totalGrossAmount, invoice.currency)}</span>
        </div>
      </div>

      <p className="mt-6 text-[10pt]">
        {invoice.dueDate
          ? `Bitte überweisen Sie den Betrag bis zum ${formatDate(invoice.dueDate)} auf unser Konto.`
          : 'Wir bedanken uns recht herzlich für die gute Zusammenarbeit.'}
      </p>

      {invoice.notes && <p className="mt-4 text-[9pt] text-neutral-700">{invoice.notes}</p>}

      <CenteredLegalFooter issuer={issuer} />
    </>
  )
}

// Modeled after the Pretty Wild Water reference invoice
// (pretty_wild_waters_invoice.png): logo top-right, gray italic letterhead
// with dot-separated address and VAT line, recipient block, INVOICE,
// shaded Artist/Period/Invoice date/Invoice No. band, Performance section,
// Sum Net / Reverse Charge / Sum total presentation, centered footer
function AgencyEnTemplate({ data, logoUrl }: { data: InvoicePrintDto; logoUrl?: string }) {
  const { invoice, issuer, recipient } = data
  const taxRate = dominantTaxRate(data)
  const hasVat = invoice.subtotalTaxAmount > 0

  return (
    <>
      <Logo src={logoUrl} />

      {issuer && (
        <div className="mt-[20mm]">
          <div className="text-[17pt] font-bold italic tracking-wide text-neutral-400">
            {issuer.legalName}
          </div>
          <div className="mt-1 text-[9.5pt] text-neutral-400">
            {[issuer.street, issuer.streetNumber].filter(Boolean).join(' ')}
            {issuer.zipCode || issuer.city ? ' • ' : ''}
            {[issuer.zipCode, issuer.city].filter(Boolean).join(' ')}
            {issuer.country ? ' • ' : ''}
            {issuer.country}
          </div>
          {(issuer.vatNumber || issuer.ustNumber) && (
            <div className="mt-1 text-[9.5pt] text-neutral-400">
              VAT: {issuer.vatNumber || issuer.ustNumber}
            </div>
          )}
        </div>
      )}

      <div className="mt-[16mm]">
        <AddressBlock party={recipient} issuerCountryCode={issuer?.countryCode} />
      </div>

      <div className="mt-[14mm] text-[16pt] font-bold">INVOICE</div>

      <MetaBand
        columns={['Artist', 'Period', 'Invoice date', 'Invoice No.']}
        values={[
          invoice.recipientName,
          formatPeriod(data),
          formatDate(invoice.issueDate),
          String(invoice.invoiceNumber)
        ]}
      />

      <p className="mt-4 text-[10pt]">{invoice.notes || 'Herewith we charge our agreed services:'}</p>

      <div className="mt-3">
        <div
          className="border-b border-neutral-400 px-2 py-1 text-[9.5pt] font-semibold"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 3px)'
          }}
        >
          Performance
        </div>
        <div className="mt-1 border-t border-dashed border-neutral-500" />
        <table className="mt-2 w-full text-[10pt]">
          <tbody>
            {invoice.lineItems.map((item) => (
              <tr key={item.id}>
                <td className="py-1 align-top">{item.description}</td>
                <td className="w-[45mm] py-1 text-right align-top">
                  {formatMoney(item.lineNetAmount, invoice.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 ml-auto w-[95mm] text-[10pt]">
        <div className="flex justify-between py-1">
          <span>{invoice.lineItems[0]?.description || 'Sum Net'}</span>
          <span>
            <span className="font-semibold">Sum Net: </span>
            {formatMoney(invoice.subtotalNetAmount, invoice.currency)}
          </span>
        </div>
        {hasVat ? (
          <div className="flex justify-between py-1">
            <span />
            <span>
              <span className="font-semibold">plus {formatQuantity(taxRate)} % VAT: </span>
              {formatMoney(invoice.subtotalTaxAmount, invoice.currency)}
            </span>
          </div>
        ) : (
          <div className="flex justify-between py-1">
            <span>Reverse Charge Procedure applies</span>
            <span>
              <span className="font-semibold">tax.: </span>
              {formatMoney(invoice.subtotalTaxAmount, invoice.currency)}
            </span>
          </div>
        )}
        <div className="flex justify-between border-t border-neutral-400 py-1">
          <span />
          <span>
            <span className="font-bold">Sum total: </span>
            <span className="font-bold">{formatMoney(invoice.totalGrossAmount, invoice.currency)}</span>
          </span>
        </div>
      </div>

      <p className="mt-8 text-[10pt]">
        We would like to thank you for your cooperation and ask you to transfer the money to our
        account.
      </p>

      <CenteredLegalFooterEn issuer={issuer} />
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
  const isDraft = data.invoice.status === 'draft'

  return (
    <div className="relative mx-auto w-[210mm] min-h-[297mm] bg-white p-[18mm] text-black shadow-lg print:shadow-none print:m-0 print:w-auto print:min-h-0">
      {isDraft && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center print:block">
          <span className="rotate-[-30deg] text-[60pt] font-bold text-neutral-200 select-none">
            ENTWURF
          </span>
        </div>
      )}

      {template === 'standard' && <StandardTemplate data={data} />}
      {template === 'agency-de' && <AgencyDeTemplate data={data} logoUrl={logoUrl} />}
      {template === 'agency-en' && <AgencyEnTemplate data={data} logoUrl={logoUrl} />}
    </div>
  )
}
