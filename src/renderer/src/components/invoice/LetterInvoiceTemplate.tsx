import type {
  InvoicePartySnapshotDto,
  InvoicePrintDto
} from '../../../../main/api/schemas/invoice.schema'
import { unitLabelOf } from '../../../../main/einvoice/codes'
import { needsBuyerVatId, serviceDateOf } from '../../../../main/invoice/taxSummary'
import { cancellationOf, formatDate, formatQuantity } from './invoiceFormat'
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

export function LetterTemplate({
  data,
  logoUrl,
  paymentQr
}: {
  data: InvoicePrintDto
  logoUrl?: string
  paymentQr: boolean
}) {
  const { invoice, issuer, recipient } = data
  const cancels = cancellationOf(data)
  const serviceDate = serviceDateOf(data, 'de')
  const currency = invoice.currency || 'EUR'
  const totals = letterTotals(data)

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
            vatIdLabel={needsBuyerVatId(data) ? 'USt-IdNr.' : undefined}
          />
        </div>
        <div className="w-[68mm] text-[9.5pt] leading-snug">
          <div>Rechnungs-Nr.: {invoice.invoiceNumber ?? 'Entwurf'}</div>
          <div>Belegdatum: {formatDate(invoice.issueDate)}</div>
          <div>
            {letterServiceLabel(serviceDate.label)}: {serviceDate.value}
          </div>
          {invoice.dueDate && !cancels && <div>Fällig: {formatDate(invoice.dueDate)}</div>}
          {data.bandName && <div>Band: {data.bandName}</div>}
        </div>
      </div>

      <div className="mt-[16mm] text-[16pt] font-bold">
        {cancels ? 'Stornorechnung' : 'Rechnung'}
      </div>
      {cancels && (
        <div className="mt-1 text-[10pt]">
          zu Rechnung Nr. {cancels.number} vom {cancels.date}
        </div>
      )}

      <table className="mt-6 w-full border-collapse text-[9pt]">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1 pr-2 font-bold">Bezeichnung</th>
            <th className="py-1 pr-2 text-right font-bold">Menge</th>
            <th className="py-1 pr-2 font-bold">Einheit</th>
            <th className="py-1 pr-2 text-right font-bold">Preis</th>
            <th className="py-1 pr-2 text-right font-bold">USt</th>
            <th className="py-1 text-right font-bold">Betrag {currency}</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lineItems.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="py-1 pr-2">{item.description}</td>
              <td className="py-1 pr-2 text-right">{formatQuantity(item.quantity)}</td>
              <td className="py-1 pr-2">{unitLabelOf(item.unit)}</td>
              <td className="py-1 pr-2 text-right">{letterAmount(item.unitPriceNet)}</td>
              <td className="py-1 pr-2 text-right whitespace-nowrap">{letterRate(item.taxRate)}</td>
              <td className="py-1 text-right">{letterAmount(item.lineNetAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex break-inside-avoid items-start gap-6">
        {paymentQr && <PaymentQr data={data} lang="de" />}
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
      <TaxNote data={data} lang="de" />

      <div className="mt-4 space-y-2 text-[9pt]">
        {cancels && <p>Der Betrag wird mit der Rechnung Nr. {cancels.number} verrechnet.</p>}
        {invoice.paymentTerms && <p>{invoice.paymentTerms}</p>}
        {invoice.notes && <p>{invoice.notes}</p>}
      </div>

      <LetterFooter issuer={issuer} />
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
function LetterFooter({ issuer }: { issuer: InvoicePartySnapshotDto | null }) {
  if (!issuer) return null
  const columns: Array<Array<[string | null, string]>> = [
    [
      [null, issuer.legalName],
      [null, [issuer.street, issuer.streetNumber].filter(Boolean).join(' ').trim()],
      [null, [issuer.zipCode, issuer.city].filter(Boolean).join(' ').trim()]
    ],
    [
      ['Tel.:', issuer.phone],
      [null, issuer.email],
      [null, issuer.commercialRegisterNo],
      [null, issuer.registerCourt ? `Amtsgericht ${issuer.registerCourt}` : '']
    ],
    [
      ['Steuernummer:', issuer.taxNumber],
      ['USt-IdNr.:', issuer.vatId]
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
