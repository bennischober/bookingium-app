import type { InvoicePrintDto } from '../../../../main/api/schemas/invoice.schema'
import { needsBuyerVatId, serviceDateOf, type Lang } from '../../../../main/invoice/taxSummary'
import {
  cancellationOf,
  formatDate,
  formatMoney,
  formatQuantity,
  formatRate,
  unitLabel
} from './invoiceFormat'
import { AddressBlock, CenteredLegalFooter, TaxNote, TotalsRow } from './InvoiceParts'

// ========================================
// Standard template (one layout, DE/EN via dictionary)
// ========================================

type StandardStrings = {
  heading: string
  cancellationHeading: string
  cancels: (number: string, date: string) => string
  number: string
  draft: string
  date: string
  due: string
  recipient: string
  band: string
  event: string
  period: string
  columns: [string, string, string, string, string, string, string, string]
  net: string
  total: string
  paymentTerms: string
  notes: string
  offset: (number: string) => string
  vatId: string
}

const STANDARD_STRINGS: Record<Lang, StandardStrings> = {
  de: {
    heading: 'RECHNUNG',
    cancellationHeading: 'STORNORECHNUNG',
    cancels: (number, date) => `zu Rechnung Nr. ${number} vom ${date}`,
    number: 'Nr.',
    draft: 'Entwurf',
    date: 'Datum',
    due: 'Fällig',
    recipient: 'Rechnungsempfänger',
    band: 'Band',
    event: 'Event',
    period: 'Zeitraum',
    columns: ['Pos.', 'Beschreibung', 'Menge', 'Einheit', 'Netto', 'MwSt. %', 'MwSt.', 'Brutto'],
    net: 'Zwischensumme (netto)',
    total: 'Gesamt',
    paymentTerms: 'Zahlungsbedingungen',
    notes: 'Anmerkungen',
    offset: (number) => `Der Betrag wird mit der Rechnung Nr. ${number} verrechnet.`,
    vatId: 'USt-IdNr.'
  },
  en: {
    heading: 'INVOICE',
    cancellationHeading: 'CANCELLATION INVOICE',
    cancels: (number, date) => `for invoice no. ${number} dated ${date}`,
    number: 'No.',
    draft: 'Draft',
    date: 'Date',
    due: 'Due date',
    recipient: 'Bill to',
    band: 'Artist',
    event: 'Event',
    period: 'Period',
    columns: ['Item', 'Description', 'Qty', 'Unit', 'Net', 'VAT %', 'VAT', 'Gross'],
    net: 'Subtotal (net)',
    total: 'Total',
    paymentTerms: 'Payment terms',
    notes: 'Notes',
    offset: (number) => `This amount is offset against invoice no. ${number}.`,
    vatId: 'VAT ID'
  }
}

export function StandardTemplate({
  data,
  lang,
  paymentQr
}: {
  data: InvoicePrintDto
  lang: Lang
  paymentQr: boolean
}) {
  const { invoice, issuer, recipient } = data
  const t = STANDARD_STRINGS[lang]
  const cancels = cancellationOf(data)
  const serviceDate = serviceDateOf(data, lang)
  const money = (value: number) => formatMoney(value, invoice.currency, lang)
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
            {cancels ? t.cancellationHeading : t.heading}
          </div>
          <div className="mt-2 text-[10pt]">
            {cancels && <div>{t.cancels(cancels.number, cancels.date)}</div>}
            <div>
              {t.number} {invoice.invoiceNumber ?? t.draft}
            </div>
            <div>
              {t.date}: {formatDate(invoice.issueDate)}
            </div>
            {invoice.dueDate && !cancels && (
              <div>
                {t.due}: {formatDate(invoice.dueDate)}
              </div>
            )}
          </div>
        </div>
      </div>

      <hr className="my-6 border-neutral-300" />

      <div className="flex justify-between items-start gap-8">
        <div className="w-1/2">
          <div className="text-[10pt] leading-snug">
            <div className="font-semibold mb-1">{t.recipient}</div>
            <AddressBlock
              party={recipient}
              issuerCountryCode={issuer?.countryCode}
              vatIdLabel={needsBuyerVatId(data) ? t.vatId : undefined}
            />
          </div>
        </div>
        <div className="w-1/2 text-[10pt] leading-snug">
          {data.bandName && (
            <div>
              <span className="font-semibold">{t.band}:</span> {data.bandName}
            </div>
          )}
          {invoice.dealMemoName && (
            <div>
              <span className="font-semibold">{t.event}:</span> {invoice.dealMemoName}
            </div>
          )}
          {invoice.periodLabel && serviceDate.value !== invoice.periodLabel && (
            <div>
              <span className="font-semibold">{t.period}:</span> {invoice.periodLabel}
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
            <th className="py-2 pr-2 font-semibold">{t.columns[0]}</th>
            <th className="py-2 pr-2 font-semibold">{t.columns[1]}</th>
            <th className="py-2 pr-2 text-right font-semibold">{t.columns[2]}</th>
            <th className="py-2 pr-2 font-semibold">{t.columns[3]}</th>
            <th className="py-2 pr-2 text-right font-semibold">{t.columns[4]}</th>
            <th className="py-2 pr-2 text-right font-semibold">{t.columns[5]}</th>
            <th className="py-2 pr-2 text-right font-semibold">{t.columns[6]}</th>
            <th className="py-2 text-right font-semibold">{t.columns[7]}</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lineItems.map((item) => (
            <tr key={item.id} className="border-b border-neutral-200 align-top">
              <td className="py-2 pr-2">{item.position}</td>
              <td className="py-2 pr-2">{item.description}</td>
              <td className="py-2 pr-2 text-right">{formatQuantity(item.quantity, lang)}</td>
              <td className="py-2 pr-2">{unitLabel(item.unit, lang)}</td>
              <td className="py-2 pr-2 text-right">{money(item.lineNetAmount)}</td>
              <td className="py-2 pr-2 text-right">{formatRate(item.taxRate, lang)}</td>
              <td className="py-2 pr-2 text-right">{money(item.lineTaxAmount)}</td>
              <td className="py-2 text-right">{money(item.lineGrossAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <TotalsRow
        data={data}
        lang={lang}
        paymentQr={paymentQr}
        labels={{ net: t.net, total: t.total }}
        totalsClassName="w-[85mm] text-[10pt]"
      />
      <TaxNote data={data} lang={lang} />

      <div className="mt-4 space-y-2 text-[9pt] text-neutral-700">
        {cancels && <p className="text-black">{t.offset(cancels.number)}</p>}
        {invoice.paymentTerms && (
          <p>
            <span className="font-semibold text-black">{t.paymentTerms}: </span>
            {invoice.paymentTerms}
          </p>
        )}
        {invoice.notes && (
          <p>
            <span className="font-semibold text-black">{t.notes}: </span>
            {invoice.notes}
          </p>
        )}
      </div>

      <CenteredLegalFooter issuer={issuer} lang={lang} />
    </>
  )
}
