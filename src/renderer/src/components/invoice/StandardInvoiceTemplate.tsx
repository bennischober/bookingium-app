import type { InvoicePrintDto } from '../../../../main/api/schemas/invoice.schema'
import { unitLabelOf } from '../../../../main/einvoice/codes'
import { needsBuyerVatId, serviceDateOf } from '../../../../main/invoice/taxSummary'
import { cancellationOf, formatDate, formatMoney, formatQuantity } from './invoiceFormat'
import { AddressBlock, CenteredLegalFooter, TaxNote, TotalsRow } from './InvoiceParts'

// ========================================
// Standard template
// ========================================

export function StandardTemplate({
  data,
  paymentQr
}: {
  data: InvoicePrintDto
  paymentQr: boolean
}) {
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
