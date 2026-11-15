import type { InvoicePrintDto } from '../../../../main/api/schemas/invoice.schema'
import { needsBuyerVatId, serviceDateOf } from '../../../../main/invoice/taxSummary'
import {
  HATCH_STYLE,
  cancellationOf,
  formatDate,
  formatMoney,
  formatQuantity,
  formatRate
} from './invoiceFormat'
import {
  AddressBlock,
  CenteredLegalFooter,
  Logo,
  MetaBand,
  SenderLine,
  TaxNote,
  TotalsRow
} from './InvoiceParts'

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
      artist: 'Band',
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
export function AgencyTemplate({
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
