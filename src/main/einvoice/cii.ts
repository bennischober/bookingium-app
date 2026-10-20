// Factur-X / ZUGFeRD XML (UN/CEFACT Cross Industry Invoice D16B), profile
// EN 16931, written from a checked invoice (prepare.ts). Element order
// follows the CII schema sequences.
import { formatCents } from './amounts'
import type { PreparedEInvoice, PreparedParty, PreparedVatGroup } from './prepare'

/** Guideline id of the EN 16931 profile (Factur-X "EN 16931", ZUGFeRD "COMFORT") */
export const EN16931_GUIDELINE = 'urn:cen.eu:en16931:2017'
/** XRechnung 3.0 (German public sector CIUS) and its business process (BT-23) */
export const XRECHNUNG_GUIDELINE =
  'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0'
const PEPPOL_BILLING_PROCESS = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** <tag>value</tag>, nothing for an empty value */
function el(tag: string, value: string | null | undefined, attributes = ''): string {
  if (value === null || value === undefined || value === '') return ''
  return `<${tag}${attributes}>${escapeXml(value)}</${tag}>`
}

/** Wraps children; nothing when all children are empty */
function group(tag: string, ...children: string[]): string {
  const inner = children.join('')
  return inner ? `<${tag}>${inner}</${tag}>` : ''
}

function date(tag: string, iso: string | null): string {
  if (!iso) return ''
  return `<${tag}><udt:DateTimeString format="102">${iso.replace(/-/g, '')}</udt:DateTimeString></${tag}>`
}

/** Decimal without exponent and trailing zeros, at most 4 places ("1", "2.5") */
function decimal(value: number): string {
  return String(Number(value.toFixed(4)))
}

function tradeParty(tag: string, party: PreparedParty, role: 'seller' | 'buyer'): string {
  const contact = party.contact
  return group(
    tag,
    el('ram:Name', party.name),
    role === 'seller' && party.registrationId
      ? group('ram:SpecifiedLegalOrganization', el('ram:ID', party.registrationId))
      : '',
    contact
      ? group(
          'ram:DefinedTradeContact',
          el('ram:PersonName', contact.name),
          group('ram:TelephoneUniversalCommunication', el('ram:CompleteNumber', contact.phone)),
          group('ram:EmailURIUniversalCommunication', el('ram:URIID', contact.email))
        )
      : '',
    group(
      'ram:PostalTradeAddress',
      el('ram:PostcodeCode', party.zipCode),
      el('ram:LineOne', party.street),
      el('ram:CityName', party.city),
      el('ram:CountryID', party.countryCode)
    ),
    group('ram:URIUniversalCommunication', el('ram:URIID', party.email, ' schemeID="EM"')),
    group('ram:SpecifiedTaxRegistration', el('ram:ID', party.vatId, ' schemeID="VA"')),
    role === 'seller'
      ? group('ram:SpecifiedTaxRegistration', el('ram:ID', party.taxNumber, ' schemeID="FC"'))
      : ''
  )
}

function headerTax(vat: PreparedVatGroup): string {
  return group(
    'ram:ApplicableTradeTax',
    el('ram:CalculatedAmount', formatCents(vat.taxCents)),
    el('ram:TypeCode', 'VAT'),
    el('ram:ExemptionReason', vat.exemptionReason),
    el('ram:BasisAmount', formatCents(vat.basisCents)),
    el('ram:CategoryCode', vat.category),
    el('ram:ExemptionReasonCode', vat.exemptionCode),
    vat.rate === null ? '' : el('ram:RateApplicablePercent', decimal(vat.rate))
  )
}

export function buildCiiXml(invoice: PreparedEInvoice): string {
  const { seller, buyer, totals, currency } = invoice

  const lines = invoice.lines.map((line) =>
    group(
      'ram:IncludedSupplyChainTradeLineItem',
      group('ram:AssociatedDocumentLineDocument', el('ram:LineID', String(line.id))),
      group('ram:SpecifiedTradeProduct', el('ram:Name', line.description)),
      group(
        'ram:SpecifiedLineTradeAgreement',
        group('ram:NetPriceProductTradePrice', el('ram:ChargeAmount', decimal(line.unitPriceNet)))
      ),
      group(
        'ram:SpecifiedLineTradeDelivery',
        el('ram:BilledQuantity', decimal(line.quantity), ` unitCode="${line.unitCode}"`)
      ),
      group(
        'ram:SpecifiedLineTradeSettlement',
        group(
          'ram:ApplicableTradeTax',
          el('ram:TypeCode', 'VAT'),
          el('ram:CategoryCode', line.category),
          line.rate === null ? '' : el('ram:RateApplicablePercent', decimal(line.rate))
        ),
        group(
          'ram:SpecifiedTradeSettlementLineMonetarySummation',
          el('ram:LineTotalAmount', formatCents(line.netCents))
        )
      )
    )
  )

  const agreement = group(
    'ram:ApplicableHeaderTradeAgreement',
    el('ram:BuyerReference', invoice.buyerReference),
    tradeParty('ram:SellerTradeParty', seller, 'seller'),
    tradeParty('ram:BuyerTradeParty', buyer, 'buyer')
  )

  // Always present (may be empty); ship-to country for intra-community supplies
  const delivery =
    '<ram:ApplicableHeaderTradeDelivery>' +
    (invoice.shipToCountry
      ? group(
          'ram:ShipToTradeParty',
          group('ram:PostalTradeAddress', el('ram:CountryID', invoice.shipToCountry))
        )
      : '') +
    (invoice.deliveryDate
      ? group(
          'ram:ActualDeliverySupplyChainEvent',
          date('ram:OccurrenceDateTime', invoice.deliveryDate)
        )
      : '') +
    '</ram:ApplicableHeaderTradeDelivery>'

  const payment = invoice.payment
  const settlement = group(
    'ram:ApplicableHeaderTradeSettlement',
    el('ram:InvoiceCurrencyCode', currency),
    payment
      ? group(
          'ram:SpecifiedTradeSettlementPaymentMeans',
          el('ram:TypeCode', '58'),
          group(
            'ram:PayeePartyCreditorFinancialAccount',
            el('ram:IBANID', payment.iban),
            el('ram:AccountName', payment.accountName)
          ),
          group('ram:PayeeSpecifiedCreditorFinancialInstitution', el('ram:BICID', payment.bic))
        )
      : '',
    ...invoice.vatGroups.map(headerTax),
    invoice.period
      ? group(
          'ram:BillingSpecifiedPeriod',
          date('ram:StartDateTime', invoice.period.start),
          date('ram:EndDateTime', invoice.period.end)
        )
      : '',
    group(
      'ram:SpecifiedTradePaymentTerms',
      el('ram:Description', invoice.paymentTerms),
      date('ram:DueDateDateTime', invoice.dueDate)
    ),
    group(
      'ram:SpecifiedTradeSettlementHeaderMonetarySummation',
      el('ram:LineTotalAmount', formatCents(totals.lineCents)),
      el('ram:TaxBasisTotalAmount', formatCents(totals.taxBasisCents)),
      el('ram:TaxTotalAmount', formatCents(totals.taxCents), ` currencyID="${currency}"`),
      el('ram:GrandTotalAmount', formatCents(totals.grossCents)),
      el('ram:DuePayableAmount', formatCents(totals.grossCents))
    ),
    invoice.precedingInvoice
      ? group(
          'ram:InvoiceReferencedDocument',
          el('ram:IssuerAssignedID', invoice.precedingInvoice.number),
          '<ram:FormattedIssueDateTime><qdt:DateTimeString format="102">' +
            invoice.precedingInvoice.issueDate.replace(/-/g, '') +
            '</qdt:DateTimeString></ram:FormattedIssueDateTime>'
        )
      : ''
  )

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rsm:CrossIndustryInvoice' +
    ' xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"' +
    ' xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"' +
    ' xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"' +
    ' xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">' +
    group(
      'rsm:ExchangedDocumentContext',
      invoice.xrechnung
        ? group(
            'ram:BusinessProcessSpecifiedDocumentContextParameter',
            el('ram:ID', PEPPOL_BILLING_PROCESS)
          )
        : '',
      group(
        'ram:GuidelineSpecifiedDocumentContextParameter',
        el('ram:ID', invoice.xrechnung ? XRECHNUNG_GUIDELINE : EN16931_GUIDELINE)
      )
    ) +
    group(
      'rsm:ExchangedDocument',
      el('ram:ID', invoice.number),
      el('ram:TypeCode', invoice.typeCode),
      date('ram:IssueDateTime', invoice.issueDate),
      ...invoice.notes.map((note) => group('ram:IncludedNote', el('ram:Content', note)))
    ) +
    group('rsm:SupplyChainTradeTransaction', ...lines, agreement, delivery, settlement) +
    '</rsm:CrossIndustryInvoice>\n'
  )
}
