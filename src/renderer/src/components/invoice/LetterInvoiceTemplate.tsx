import type {
  InvoicePartySnapshotDto,
  InvoicePrintDto
} from '../../../../main/api/schemas/invoice.schema'
import { needsBuyerVatId, serviceDateOf, type Lang } from '../../../../main/invoice/taxSummary'
import { cancellationOf, formatDate, formatQuantity, unitLabel } from './invoiceFormat'
import { AddressBlock, Logo, TaxNote } from './InvoiceParts'
import { PaymentQr } from './PaymentQr'
import { letterAmount, letterRate, letterServiceLabel, letterTotals } from './letterFormat'

// ========================================
// Geschäftsbrief template (DIN 5008 business letter)
// ========================================

// The layout of an invoice from accounting software: logo top right, the sender in one small
// line above the recipient at the window position, an info block (number, date, service date)
// to the right of it, the heading, a full items table with unit price and VAT rate, totals as
// "Summe / x % USt. auf EUR … / Endbetrag", and the company's legal data in four footer
// columns. Every value comes from the frozen invoice data, nothing is fixed here.
// German and English share the layout; only the words come from LETTER_STRINGS.

type LetterStrings = {
  invoiceNumber: string
  draft: string
  customerNumber: string
  issueDate: string
  due: string
  band: string
  heading: string
  cancellationHeading: string
  cancels: (number: string, date: string) => string
  columns: [string, string, string, string, string, string]
  offset: (number: string) => string
  vatId: string
  footer: { phone: string; taxNumber: string; vatId: string; registerCourt: string }
}

const LETTER_STRINGS: Record<Lang, LetterStrings> = {
  de: {
    invoiceNumber: 'Rechnungs-Nr.',
    draft: 'Entwurf',
    customerNumber: 'Kundennummer',
    issueDate: 'Belegdatum',
    due: 'Fällig',
    band: 'Band',
    heading: 'Rechnung',
    cancellationHeading: 'Stornorechnung',
    cancels: (number, date) => `zu Rechnung Nr. ${number} vom ${date}`,
    columns: ['Bezeichnung', 'Menge', 'Einheit', 'Preis', 'USt', 'Betrag'],
    offset: (number) => `Der Betrag wird mit der Rechnung Nr. ${number} verrechnet.`,
    vatId: 'USt-IdNr.',
    footer: {
      phone: 'Tel.:',
      taxNumber: 'Steuernummer:',
      vatId: 'USt-IdNr.:',
      registerCourt: 'Amtsgericht'
    }
  },
  en: {
    invoiceNumber: 'Invoice no.',
    draft: 'Draft',
    customerNumber: 'Customer no.',
    issueDate: 'Invoice date',
    due: 'Due date',
    band: 'Artist',
    heading: 'Invoice',
    cancellationHeading: 'Cancellation invoice',
    cancels: (number, date) => `for invoice no. ${number} dated ${date}`,
    columns: ['Description', 'Quantity', 'Unit', 'Price', 'VAT', 'Amount'],
    offset: (number) => `This amount is offset against invoice no. ${number}.`,
    vatId: 'VAT ID',
    footer: {
      phone: 'Phone:',
      taxNumber: 'Tax number:',
      vatId: 'VAT ID:',
      registerCourt: 'Register court'
    }
  }
}

export function LetterTemplate({
  data,
  lang,
  logoUrl,
  paymentQr
}: {
  data: InvoicePrintDto
  lang: Lang
  logoUrl?: string
  paymentQr: boolean
}) {
  const { invoice, issuer, recipient } = data
  const t = LETTER_STRINGS[lang]
  const cancels = cancellationOf(data)
  const serviceDate = serviceDateOf(data, lang)
  const currency = invoice.currency || 'EUR'
  const totals = letterTotals(data, lang)

  return (
    <>
      <div className="flex min-h-[22mm] justify-end">
        <Logo src={logoUrl} />
      </div>

      <div className="mt-[14mm] flex items-start justify-between gap-8">
        <div className="w-[95mm]">
          <LetterSenderLine issuer={issuer} />
          <AddressBlock
            party={recipient}
            issuerCountryCode={issuer?.countryCode}
            vatIdLabel={needsBuyerVatId(data) ? t.vatId : undefined}
          />
        </div>
        <div className="w-[68mm] text-[9.5pt] leading-snug">
          <div>
            {t.invoiceNumber}: {invoice.invoiceNumber ?? t.draft}
          </div>
          {recipient?.customerNumber != null && (
            <div>
              {t.customerNumber}: {recipient.customerNumber}
            </div>
          )}
          <div>
            {t.issueDate}: {formatDate(invoice.issueDate)}
          </div>
          <div>
            {letterServiceLabel(serviceDate.label)}: {serviceDate.value}
          </div>
          {invoice.dueDate && !cancels && (
            <div>
              {t.due}: {formatDate(invoice.dueDate)}
            </div>
          )}
          {data.bandName && (
            <div>
              {t.band}: {data.bandName}
            </div>
          )}
        </div>
      </div>

      <div className="mt-[16mm] text-[16pt] font-bold">
        {cancels ? t.cancellationHeading : t.heading}
      </div>
      {cancels && <div className="mt-1 text-[10pt]">{t.cancels(cancels.number, cancels.date)}</div>}

      <table className="mt-6 w-full border-collapse text-[9pt]">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1 pr-2 font-bold">{t.columns[0]}</th>
            <th className="py-1 pr-2 text-right font-bold">{t.columns[1]}</th>
            <th className="py-1 pr-2 font-bold">{t.columns[2]}</th>
            <th className="py-1 pr-2 text-right font-bold">{t.columns[3]}</th>
            <th className="py-1 pr-2 text-right font-bold">{t.columns[4]}</th>
            <th className="py-1 text-right font-bold">
              {t.columns[5]} {currency}
            </th>
          </tr>
        </thead>
        <tbody>
          {invoice.lineItems.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="py-1 pr-2">{item.description}</td>
              <td className="py-1 pr-2 text-right">{formatQuantity(item.quantity, lang)}</td>
              <td className="py-1 pr-2">{unitLabel(item.unit, lang)}</td>
              <td className="py-1 pr-2 text-right">{letterAmount(item.unitPriceNet, lang)}</td>
              <td className="py-1 pr-2 text-right whitespace-nowrap">
                {letterRate(item.taxRate, lang)}
              </td>
              <td className="py-1 text-right">{letterAmount(item.lineNetAmount, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex break-inside-avoid items-start gap-6">
        {paymentQr && <PaymentQr data={data} lang={lang} />}
        <div className="ml-auto w-[95mm] text-[9pt]">
          {totals.map((line) => (
            <div
              key={line.label}
              className={
                line.kind === 'sum'
                  ? 'flex justify-between gap-4 font-bold'
                  : line.kind === 'total'
                    ? 'flex justify-between gap-4 border-t border-black font-bold'
                    : 'flex justify-between gap-4'
              }
            >
              <span>{line.label}</span>
              <span>{line.value}</span>
            </div>
          ))}
        </div>
      </div>
      <TaxNote data={data} lang={lang} />

      <div className="mt-4 space-y-2 text-[9pt]">
        {cancels && <p>{t.offset(cancels.number)}</p>}
        {invoice.paymentTerms && <p>{invoice.paymentTerms}</p>}
        {invoice.notes && <p>{invoice.notes}</p>}
      </div>

      <LetterFooter issuer={issuer} labels={t.footer} />
    </>
  )
}

/** The return address in one small line above the recipient (DIN 5008 window) */
function LetterSenderLine({ issuer }: { issuer: InvoicePartySnapshotDto | null }) {
  if (!issuer) return null
  const parts = [
    issuer.legalName,
    [issuer.street, issuer.streetNumber].filter(Boolean).join(' ').trim(),
    [issuer.zipCode, issuer.city].filter(Boolean).join(' ').trim()
  ].filter(Boolean)
  return <div className="mb-1 truncate text-[6.5pt]">{parts.join(', ')}</div>
}

/**
 * The company's legal data in four columns: address | contact and register | tax numbers |
 * bank. A column without data stays empty, a missing value leaves its line out.
 */
function LetterFooter({
  issuer,
  labels
}: {
  issuer: InvoicePartySnapshotDto | null
  labels: LetterStrings['footer']
}) {
  if (!issuer) return null
  const columns: Array<Array<[string | null, string]>> = [
    [
      [null, issuer.legalName],
      [null, [issuer.street, issuer.streetNumber].filter(Boolean).join(' ').trim()],
      [null, [issuer.zipCode, issuer.city].filter(Boolean).join(' ').trim()]
    ],
    [
      [labels.phone, issuer.phone],
      [null, issuer.email],
      [null, issuer.commercialRegisterNo],
      [null, issuer.registerCourt ? `${labels.registerCourt} ${issuer.registerCourt}` : '']
    ],
    [
      [labels.taxNumber, issuer.taxNumber],
      [labels.vatId, issuer.vatId]
    ],
    [
      [null, issuer.bankName],
      ['IBAN:', issuer.iban],
      ['BIC:', issuer.bic]
    ]
  ]
  return (
    <div className="mt-16 flex break-inside-avoid justify-between gap-4 text-[6.5pt] leading-snug">
      {columns.map((column, index) => (
        <table key={index} className="border-collapse self-start">
          <tbody>
            {column
              .filter(([, value]) => value)
              .map(([label, value]) =>
                label ? (
                  <tr key={label}>
                    <td className="pr-2 align-top">{label}</td>
                    <td className="whitespace-nowrap">{value}</td>
                  </tr>
                ) : (
                  <tr key={value}>
                    <td colSpan={2} className="whitespace-nowrap">
                      {value}
                    </td>
                  </tr>
                )
              )}
          </tbody>
        </table>
      ))}
    </div>
  )
}
