import type { InvoicePartySnapshotDto, InvoicePrintDto } from '../../../../main/api/schemas/invoice.schema'

// ========================================
// Template catalog (hardcoded by design)
// ========================================

export const INVOICE_TEMPLATES = [
  { value: 'standard', label: 'Standard' },
  { value: 'agency-de', label: 'Agency (German)' },
  { value: 'agency-en', label: 'Agency (English)' }
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

// ========================================
// Shared document pieces
// ========================================

function PartyBlock({
  heading,
  party
}: {
  heading?: string
  party: InvoicePartySnapshotDto | null
}) {
  return (
    <div className="text-[10pt] leading-snug">
      {heading && <div className="font-semibold mb-1">{heading}</div>}
      {party ? (
        <div>
          <div className="font-medium">{party.legalName}</div>
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
          {party.country && <div>{party.country}</div>}
          {party.email && <div>{party.email}</div>}
          {party.phone && <div>{party.phone}</div>}
        </div>
      ) : (
        <div className="text-neutral-400">-</div>
      )}
    </div>
  )
}

// Legal footer: registration/tax data on the left, bank data below
function LegalFooter({
  issuer,
  lang
}: {
  issuer: InvoicePartySnapshotDto | null
  lang: 'de' | 'en'
}) {
  if (!issuer) return null

  const labels =
    lang === 'de'
      ? {
          address: 'Adresse',
          taxNumber: 'Steuernummer',
          registerNo: 'HR-Nr.',
          registerCourt: 'Amtsgericht',
          vatId: 'USt-IdNr.',
          email: 'E-Mail',
          website: 'Website',
          phone: 'Tel.',
          accountHolder: 'Kontoinhaber',
          bank: 'Bank',
          swift: 'SWIFT/BIC',
          iban: 'IBAN'
        }
      : {
          address: 'Address',
          taxNumber: 'Tax number',
          registerNo: 'Commercial reg. no.',
          registerCourt: 'Register court',
          vatId: 'VAT ID',
          email: 'E-mail',
          website: 'Website',
          phone: 'Phone',
          accountHolder: 'Account holder',
          bank: 'Bank',
          swift: 'SWIFT/BIC',
          iban: 'IBAN'
        }

  const address = [
    issuer.street && `${issuer.street} ${issuer.streetNumber}`.trim(),
    issuer.zipCode && `${issuer.zipCode} ${issuer.city}`.trim(),
    issuer.country
  ]
    .filter(Boolean)
    .join(', ')

  const legal = ([
    [labels.address, address],
    [labels.taxNumber, issuer.taxNumber],
    [labels.registerNo, issuer.commercialRegisterNo],
    [labels.registerCourt, issuer.registerCourt],
    [labels.vatId, issuer.vatNumber || issuer.ustNumber],
    [labels.email, issuer.email],
    [labels.website, issuer.website],
    [labels.phone, issuer.phone]
  ] as Array<[string, string]>).filter(([, value]) => value)

  const bank = ([
    [labels.accountHolder, issuer.accountHolder],
    [labels.bank, issuer.bankName],
    [labels.swift, issuer.bic],
    [labels.iban, issuer.iban]
  ] as Array<[string, string]>).filter(([, value]) => value)

  if (legal.length === 0 && bank.length === 0) return null

  return (
    <div className="mt-10 border-t border-neutral-300 pt-3 text-[8pt] text-neutral-700">
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {legal.map(([label, value]) => (
          <span key={label}>
            <span className="font-semibold">{label}</span> {value}
          </span>
        ))}
      </div>
      {bank.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
          {bank.map(([label, value]) => (
            <span key={label}>
              <span className="font-semibold">{label}</span> {value}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// Meta row (artist | period | place | date | number) used by agency templates
function MetaRow({ data, lang }: { data: InvoicePrintDto; lang: 'de' | 'en' }) {
  const labels =
    lang === 'de'
      ? ['Künstler', 'Zeitraum', 'Leistungsort', 'Rechnungsdatum', 'Rechnung Nr.']
      : ['Artist', 'Period', 'Place of performance', 'Invoice date', 'Invoice No.']

  const period = data.invoice.periodLabel || `${formatDate(data.invoice.periodStartDate)} – ${formatDate(data.invoice.periodEndDate)}`

  const cells = [
    data.invoice.recipientName,
    period || '-',
    data.venueName || '-',
    formatDate(data.invoice.issueDate),
    String(data.invoice.invoiceNumber)
  ]

  return (
    <table className="mt-4 w-full text-[9.5pt]">
      <thead>
        <tr className="border-b border-neutral-400 text-left">
          {labels.map((label) => (
            <th key={label} className="py-1 pr-3 font-semibold">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-neutral-200">
          {cells.map((cell, index) => (
            <td key={index} className="py-1 pr-3 align-top">
              {cell}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

function LineItemsTable({ data }: { data: InvoicePrintDto }) {
  const { invoice } = data
  return (
    <table className="mt-6 w-full text-[9.5pt]">
      <thead>
        <tr className="border-b border-neutral-400 text-left">
          <th className="py-2 pr-2 font-semibold">Pos.</th>
          <th className="py-2 pr-2 font-semibold">Description</th>
          <th className="py-2 pr-2 text-right font-semibold">Qty</th>
          <th className="py-2 pr-2 font-semibold">Unit</th>
          <th className="py-2 pr-2 text-right font-semibold">Net</th>
          <th className="py-2 pr-2 text-right font-semibold">VAT %</th>
          <th className="py-2 pr-2 text-right font-semibold">VAT</th>
          <th className="py-2 text-right font-semibold">Gross</th>
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
        <PartyBlock heading="From" party={issuer} />
        <div className="text-right">
          <div className="text-[20pt] font-bold tracking-wide">INVOICE</div>
          <div className="mt-2 text-[10pt]">
            <div>
              No. {invoice.companyId}-{invoice.invoiceNumber}
            </div>
            <div>Date: {formatDate(invoice.issueDate)}</div>
            {invoice.dueDate && <div>Due: {formatDate(invoice.dueDate)}</div>}
          </div>
        </div>
      </div>

      <hr className="my-6 border-neutral-300" />

      <div className="flex justify-between items-start gap-8">
        <div className="w-1/2">
          <PartyBlock heading="Bill to" party={recipient} />
        </div>
        <div className="w-1/2 text-[10pt] leading-snug">
          {invoice.dealMemoName && (
            <div>
              <span className="font-semibold">Event:</span> {invoice.dealMemoName}
            </div>
          )}
          {invoice.periodLabel && (
            <div>
              <span className="font-semibold">Period:</span> {invoice.periodLabel}
            </div>
          )}
          {(invoice.periodStartDate || invoice.periodEndDate) && (
            <div>
              <span className="font-semibold">Service period:</span>{' '}
              {formatDate(invoice.periodStartDate)} – {formatDate(invoice.periodEndDate)}
            </div>
          )}
        </div>
      </div>

      <LineItemsTable data={data} />

      <div className="mt-6 ml-auto w-[70mm] text-[10pt]">
        <div className="flex justify-between py-1">
          <span>Subtotal (net)</span>
          <span>{formatMoney(invoice.subtotalNetAmount, invoice.currency)}</span>
        </div>
        <div className="flex justify-between py-1">
          <span>VAT</span>
          <span>{formatMoney(invoice.subtotalTaxAmount, invoice.currency)}</span>
        </div>
        <div className="flex justify-between border-t border-neutral-400 py-2 font-bold text-[11pt]">
          <span>Total</span>
          <span>{formatMoney(invoice.totalGrossAmount, invoice.currency)}</span>
        </div>
      </div>

      <div className="mt-8 space-y-2 text-[9pt] text-neutral-700">
        {invoice.reverseChargeNote && <p>{invoice.reverseChargeNote}</p>}
        {invoice.paymentTerms && (
          <p>
            <span className="font-semibold text-black">Payment terms: </span>
            {invoice.paymentTerms}
          </p>
        )}
        {invoice.notes && (
          <p>
            <span className="font-semibold text-black">Notes: </span>
            {invoice.notes}
          </p>
        )}
      </div>

      {issuer && (issuer.iban || issuer.bic) && (
        <div className="mt-10 border-t border-neutral-300 pt-3 text-[8.5pt] text-neutral-600">
          {issuer.iban && (
            <span>
              IBAN: {issuer.iban}
              {issuer.bic ? ' · ' : ''}
            </span>
          )}
          {issuer.bic && <span>BIC: {issuer.bic}</span>}
        </div>
      )}
    </>
  )
}

function AgencyDeTemplate({ data }: { data: InvoicePrintDto }) {
  const { invoice, issuer, recipient } = data
  const taxRate = dominantTaxRate(data)
  const hasVat = invoice.subtotalTaxAmount > 0

  return (
    <>
      <div className="flex justify-between items-start">
        <PartyBlock party={issuer} />
        {recipient && (
          <div className="text-right text-[9pt] text-neutral-600">
            <div className="font-semibold text-black">An</div>
            <div>{recipient.legalName}</div>
          </div>
        )}
      </div>

      <div className="mt-8 text-[16pt] font-bold">RECHNUNG</div>

      <MetaRow data={data} lang="de" />

      <p className="mt-6 text-[10pt]">Hiermit berechnen wir vereinbarungsgemäß:</p>

      <LineItemsTable data={data} />

      <div className="mt-6 ml-auto w-[80mm] text-[10pt]">
        <div className="flex justify-between py-1">
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
            <span>{formatMoney(0, invoice.currency)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-neutral-400 py-2 font-bold text-[11pt]">
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

      <LegalFooter issuer={issuer} lang="de" />
    </>
  )
}

function AgencyEnTemplate({ data }: { data: InvoicePrintDto }) {
  const { invoice, issuer, recipient } = data
  const taxRate = dominantTaxRate(data)
  const hasVat = invoice.subtotalTaxAmount > 0

  return (
    <>
      <PartyBlock party={recipient} />

      <div className="mt-8 text-[16pt] font-bold">INVOICE</div>

      <MetaRow data={data} lang="en" />

      <p className="mt-6 text-[10pt]">Herewith we charge our agreed services:</p>

      <LineItemsTable data={data} />

      <div className="mt-6 ml-auto w-[80mm] text-[10pt]">
        <div className="flex justify-between py-1">
          <span>Sum Net:</span>
          <span>{formatMoney(invoice.subtotalNetAmount, invoice.currency)}</span>
        </div>
        {hasVat ? (
          <div className="flex justify-between py-1">
            <span>plus {formatQuantity(taxRate)} % VAT:</span>
            <span>{formatMoney(invoice.subtotalTaxAmount, invoice.currency)}</span>
          </div>
        ) : (
          <div className="flex justify-between py-1">
            <span>{invoice.reverseChargeNote || 'Reverse Charge Procedure applies'}</span>
            <span>{formatMoney(invoice.subtotalTaxAmount, invoice.currency)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-neutral-400 py-2 font-bold text-[11pt]">
          <span>Sum total:</span>
          <span>{formatMoney(invoice.totalGrossAmount, invoice.currency)}</span>
        </div>
      </div>

      <p className="mt-6 text-[10pt]">
        {invoice.dueDate
          ? `Please transfer the amount until ${formatDate(invoice.dueDate)} to our account.`
          : 'We would like to thank you for your cooperation and ask you to transfer the money to our account.'}
      </p>

      {invoice.notes && <p className="mt-4 text-[9pt] text-neutral-700">{invoice.notes}</p>}

      <LegalFooter issuer={issuer} lang="en" />
    </>
  )
}

// ========================================
// Document shell (A4 sheet + draft watermark)
// ========================================

export function InvoiceDocument({
  data,
  template
}: {
  data: InvoicePrintDto
  template: InvoiceTemplate
}) {
  const isDraft = data.invoice.status === 'draft'

  return (
    <div className="relative mx-auto w-[210mm] min-h-[297mm] bg-white p-[18mm] text-black shadow-lg print:shadow-none print:m-0 print:w-auto print:min-h-0">
      {isDraft && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center print:block">
          <span className="rotate-[-30deg] text-[60pt] font-bold text-neutral-200 select-none">
            DRAFT
          </span>
        </div>
      )}

      {template === 'standard' && <StandardTemplate data={data} />}
      {template === 'agency-de' && <AgencyDeTemplate data={data} />}
      {template === 'agency-en' && <AgencyEnTemplate data={data} />}
    </div>
  )
}
