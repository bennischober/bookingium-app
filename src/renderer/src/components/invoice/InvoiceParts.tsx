import type {
  InvoicePartySnapshotDto,
  InvoicePrintDto
} from '../../../../main/api/schemas/invoice.schema'
import { fromCents } from '../../../../main/einvoice/amounts'
import { taxNoteOf, vatGroupLabel, vatGroups, type Lang } from '../../../../main/invoice/taxSummary'
import { PaymentQr } from './PaymentQr'
import { HATCH_STYLE, formatMoney } from './invoiceFormat'

// Pieces shared by the invoice print templates

export function Logo({ src }: { src?: string }) {
  if (!src) return null
  // Top right within the page padding; ~22mm tall like the reference
  return <img src={src} alt="" className="max-h-[22mm] max-w-[70mm] object-contain" />
}

// Issuer in one small line above the recipient (return address of a window
// envelope letter, DIN 5008)
export function SenderLine({ issuer }: { issuer: InvoicePartySnapshotDto | null }) {
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
export function AddressBlock({
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
  const vatId = party.vatId
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
export function TotalsRow({
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
export function TaxNote({ data, lang }: { data: InvoicePrintDto; lang: Lang }) {
  const note = taxNoteOf(data, lang)
  if (!note) return null
  return <p className="mt-3 text-[9pt]">{note}</p>
}

// Centered small-print footer. One data-driven layout for both languages:
// address (no country for domestic), tax/register, court/VAT/e-mail,
// phone/website, bank, SWIFT/BIC + IBAN. Account holder only appears when it
// differs from the legal name (like the PWW reference). Labels per language.
export function CenteredLegalFooter({
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
  if (issuer.vatId) line3.push([L.vatId, issuer.vatId])
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

// Gray meta band (Kuenstler | Zeitraum | ... / Artist | Period | ...).
// The reference documents use Word-style diagonal-hatch shading with no cell
// grid; borders only appear as thin rules under the header and below the row.
export function MetaBand({ columns, values }: { columns: string[]; values: string[] }) {
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
