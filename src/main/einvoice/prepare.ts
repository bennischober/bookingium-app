// Completeness check of an e-invoice ("Für die E-Rechnung fehlt: …") and the
// prepared data the XML is written from. Everything the XML needs is
// derived here, so an invoice either passes the check and gets an XML that
// meets the EN 16931 rules, or gets the list of what is missing and no XML.
// Pure - the invoice form runs the same check live in the renderer.
import type { InvoicePartySnapshotDto, InvoiceTaxCode } from '../api/schemas/invoice.schema'
import { computeInvoiceAmounts, toCents } from './amounts'
import {
  DEFAULT_EXEMPTION,
  TAX_CODE_LABELS,
  countryCodeOf,
  isEuCountry,
  needsExemptionReason,
  unitCodeOf,
  unitLabelOf,
  vatCategoryOf,
  vatIdOf,
  type VatCategory
} from './codes'

export type EInvoiceLineInput = {
  description: string
  quantity: number
  unit: string
  unitPriceNet: number
  taxRate: number
  taxCode: InvoiceTaxCode
}

/** The invoice as it is (or would be) issued: the same data the PDF shows */
export type EInvoiceInput = {
  /** null for drafts (number comes on issue) */
  invoiceNumber: number | null
  issueDate: string
  dueDate: string | null
  currency: string
  buyerReference: string
  periodStartDate: string | null
  periodEndDate: string | null
  /** Date of the linked event, the date of supply */
  eventDate: string | null
  paymentTerms: string
  /** Tax note printed on the invoice (reverse_charge_note) */
  taxNote: string
  notes: string
  seller: InvoicePartySnapshotDto | null
  buyer: InvoicePartySnapshotDto | null
  lines: EInvoiceLineInput[]
  /** Totals stored on the invoice (shown on the PDF); must match the lines */
  storedTotals?: { net: number; tax: number; gross: number }
  /** Stornorechnung: a credit note (381) for this invoice; amounts positive */
  cancels?: { invoiceNumber: number | null; issueDate: string | null } | null
  /** XRechnung (public-sector buyers) instead of plain EN 16931 */
  xrechnung?: boolean
}

export type PreparedParty = {
  name: string
  street: string
  zipCode: string
  city: string
  countryCode: string
  email: string
  /** VAT id with country prefix (BT-31/BT-48) */
  vatId: string | null
  /** Steuernummer (seller only, BT-32) */
  taxNumber: string | null
  /** Commercial register number (seller only, BT-30) */
  registrationId: string | null
  contact: { name: string; phone: string; email: string } | null
}

export type PreparedLine = {
  id: number
  description: string
  quantity: number
  unitCode: string
  unitPriceNet: number
  netCents: number
  category: VatCategory
  /** null for "not subject to VAT" (O), which has no rate */
  rate: number | null
}

export type PreparedVatGroup = {
  category: VatCategory
  rate: number | null
  basisCents: number
  taxCents: number
  exemptionReason: string | null
  exemptionCode: string | null
}

export type PreparedEInvoice = {
  /** 380 commercial invoice, 381 credit note (Stornorechnung) */
  typeCode: '380' | '381'
  /** The invoice a credit note refers to (BT-25/BT-26) */
  precedingInvoice: { number: string; issueDate: string } | null
  xrechnung: boolean
  number: string
  issueDate: string
  dueDate: string | null
  currency: string
  buyerReference: string
  period: { start: string | null; end: string | null } | null
  deliveryDate: string | null
  paymentTerms: string
  notes: string[]
  seller: PreparedParty
  buyer: PreparedParty
  /** Deliver-to country (intra-community supplies) */
  shipToCountry: string | null
  payment: { iban: string; accountName: string; bic: string } | null
  lines: PreparedLine[]
  vatGroups: PreparedVatGroup[]
  totals: { lineCents: number; taxBasisCents: number; taxCents: number; grossCents: number }
}

export type EInvoiceCheck =
  | { complete: true; missing: []; prepared: PreparedEInvoice }
  | { complete: false; missing: string[]; prepared: null }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function text(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function streetLine(party: InvoicePartySnapshotDto): string {
  return [text(party.street), text(party.streetNumber)].filter(Boolean).join(' ')
}

function checkParty(
  party: InvoicePartySnapshotDto | null,
  role: 'Rechnungssteller' | 'Rechnungsempfänger',
  missing: string[]
): PreparedParty | null {
  if (!party || !text(party.legalName)) {
    missing.push(`${role}: Name`)
    return null
  }
  const street = streetLine(party)
  const countryCode = countryCodeOf(party.countryCode, party.country)
  const absent = [
    !street && 'Straße',
    !text(party.zipCode) && 'PLZ',
    !text(party.city) && 'Ort',
    !countryCode && 'Land'
  ].filter(Boolean)
  if (absent.length > 0) missing.push(`${role}: ${absent.join(', ')}`)

  const vatId = vatIdOf(party.vatNumber) ?? vatIdOf(party.ustNumber)
  // "USt-Nr." without country prefix is a tax number, not a VAT id
  const taxNumber =
    text(party.taxNumber) || (vatIdOf(party.ustNumber) ? '' : text(party.ustNumber)) || null
  const contactName = text(party.contactName)
  const contactPhone = text(party.contactPhone)
  const contactEmail = text(party.contactEmail)

  return {
    name: text(party.legalName),
    street,
    zipCode: text(party.zipCode),
    city: text(party.city),
    countryCode: countryCode ?? '',
    email: text(party.email),
    vatId,
    taxNumber,
    registrationId: text(party.commercialRegisterNo) || null,
    contact:
      contactName || contactPhone || contactEmail
        ? { name: contactName, phone: contactPhone, email: contactEmail }
        : null
  }
}

/**
 * Checks an invoice for the e-invoice and prepares its data. `ignoreNumber`
 * for drafts: they get their number on issue, everything else must be there.
 */
export function prepareEInvoice(
  input: EInvoiceInput,
  options: { ignoreNumber?: boolean } = {}
): EInvoiceCheck {
  const missing: string[] = []

  if (input.invoiceNumber === null && !options.ignoreNumber) {
    missing.push('Rechnungsnummer (Rechnung ist noch ein Entwurf)')
  }
  if (!ISO_DATE.test(input.issueDate)) missing.push('Rechnungsdatum')
  const currency = text(input.currency).toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) missing.push('Währung als ISO-Code (z. B. EUR)')

  const seller = checkParty(input.seller, 'Rechnungssteller', missing)
  const buyer = checkParty(input.buyer, 'Rechnungsempfänger', missing)
  if (seller && !seller.email) missing.push('Rechnungssteller: E-Mail')

  // Lines: unit code and VAT category
  if (input.lines.length === 0) missing.push('Positionen')
  const amounts = computeInvoiceAmounts(input.lines)
  const lines: PreparedLine[] = []
  input.lines.forEach((line, index) => {
    const position = `Position ${index + 1}`
    if (!text(line.description)) missing.push(`${position}: Beschreibung`)
    const unitCode = unitCodeOf(line.unit)
    if (!unitCode) {
      missing.push(
        `${position}: Einheit, die die E-Rechnung kennt (statt „${unitLabelOf(line.unit)}“)`
      )
    }
    const category = vatCategoryOf(line.taxCode, line.taxRate)
    const codeLabel = TAX_CODE_LABELS[line.taxCode]
    if ('problem' in category) {
      missing.push(
        category.problem === 'rate_must_be_zero'
          ? `${position}: 0 % MwSt. bei „${codeLabel}“`
          : category.problem === 'rate_must_be_positive'
            ? `${position}: MwSt.-Satz über 0 % bei „${codeLabel}“`
            : `${position}: Steuerschlüssel statt „sonstig“ mit 0 % (z. B. steuerfrei, Reverse Charge)`
      )
    }
    if (unitCode && 'category' in category) {
      lines.push({
        id: index + 1,
        description: text(line.description),
        quantity: line.quantity,
        unitCode,
        unitPriceNet: line.unitPriceNet,
        netCents: amounts.lines[index].netCents,
        category: category.category,
        rate: category.category === 'O' ? null : line.taxRate
      })
    }
  })

  // VAT breakdown per category and rate; tax only for S (all others are 0 %)
  const groups = new Map<string, PreparedVatGroup>()
  for (const line of lines) {
    const key = `${line.category}|${line.rate}`
    const group = groups.get(key) ?? {
      category: line.category,
      rate: line.rate,
      basisCents: 0,
      taxCents: 0,
      exemptionReason: null,
      exemptionCode: null
    }
    group.basisCents += line.netCents
    groups.set(key, group)
  }
  const taxNote = text(input.taxNote)
  for (const group of groups.values()) {
    group.taxCents =
      group.category === 'S'
        ? (amounts.rates.find((rate) => rate.rate === group.rate)?.taxCents ?? 0)
        : 0
    if (needsExemptionReason(group.category)) {
      const fallback = DEFAULT_EXEMPTION[group.category]
      group.exemptionReason = taxNote || fallback?.reason || null
      group.exemptionCode = fallback?.code ?? null
      if (!group.exemptionReason) {
        missing.push('Steuerhinweis mit dem Grund der Steuerbefreiung (z. B. § 4 Nr. 20 a UStG)')
      }
    }
  }
  const categories = new Set(lines.map((line) => line.category))

  // Who has to be identified for which category (BR-S/Z/E/AE/IC/G-2)
  const needsSellerId = [...categories].some((category) => category !== 'O')
  if (seller && needsSellerId && !seller.vatId && !seller.taxNumber) {
    missing.push('Rechnungssteller: USt-IdNr. oder Steuernummer')
  }
  if (seller && (categories.has('K') || categories.has('G')) && !seller.vatId) {
    missing.push('Rechnungssteller: USt-IdNr. (für innergemeinschaftliche Lieferung/Ausfuhr)')
  }
  if (buyer && (categories.has('AE') || categories.has('K')) && !buyer.vatId) {
    missing.push('Rechnungsempfänger: USt-IdNr. (für Reverse Charge)')
  }
  // The seller must be identifiable by VAT id or register number (BR-CO-26);
  // "not subject to VAT" invoices may not carry the VAT id (BR-O-2)
  if (seller && !seller.registrationId && (!seller.vatId || categories.has('O'))) {
    missing.push(
      categories.has('O')
        ? 'Rechnungssteller: Handelsregisternummer (bei „nicht steuerbar“ ohne USt-IdNr.)'
        : 'Rechnungssteller: USt-IdNr. oder Handelsregisternummer'
    )
  }
  // Policy: services to buyers outside the EU are not taxable here (O)
  if (buyer?.countryCode && categories.has('AE') && !isEuCountry(buyer.countryCode)) {
    missing.push('„nicht steuerbar“ statt „Reverse Charge“ (Empfänger außerhalb der EU)')
  }
  if (categories.has('O') && categories.size > 1) {
    missing.push('„nicht steuerbar“ nur ohne andere Steuerschlüssel in derselben Rechnung')
  }
  const period =
    input.periodStartDate || input.periodEndDate
      ? { start: input.periodStartDate || null, end: input.periodEndDate || null }
      : null
  if (period?.start && period.end && period.end < period.start) {
    missing.push('Zeitraum: Ende nach dem Beginn')
  }
  if (categories.has('K') && !period && !input.eventDate) {
    missing.push('Leistungszeitraum (für innergemeinschaftliche Lieferungen)')
  }

  // Totals (BR-CO-10 … BR-CO-16), and the PDF must show the same amounts
  const taxCents = [...groups.values()].reduce((sum, group) => sum + group.taxCents, 0)
  const grossCents = amounts.netCents + taxCents
  if (grossCents <= 0) missing.push('Rechnungsbetrag über 0')
  if (grossCents > 0 && !input.dueDate && !text(input.paymentTerms)) {
    missing.push('Fälligkeitsdatum oder Zahlungsbedingungen')
  }
  const stored = input.storedTotals
  if (
    stored &&
    lines.length === input.lines.length &&
    (toCents(stored.net) !== amounts.netCents ||
      toCents(stored.tax) !== taxCents ||
      toCents(stored.gross) !== grossCents)
  ) {
    missing.push('Beträge der Rechnung passend zu den Positionen (Rundung weicht ab)')
  }

  const cancels = input.cancels ?? null
  if (cancels && (cancels.invoiceNumber === null || !cancels.issueDate)) {
    missing.push('Nummer und Datum der stornierten Rechnung')
  }

  // XRechnung (CIUS of the German public sector): BR-DE-1/2/5/6/7/15,
  // PEPPOL-EN16931-R010 (buyer electronic address)
  const iban = (input.seller?.iban ?? '').replace(/\s/g, '').toUpperCase()
  if (input.xrechnung) {
    if (!text(input.buyerReference)) missing.push('Leitweg-ID (für die XRechnung)')
    const contact = seller?.contact
    if (seller && (!contact?.name || !contact.phone || !contact.email)) {
      missing.push(
        'Rechnungssteller: Ansprechpartner für Rechnungen mit Telefon und E-Mail (XRechnung)'
      )
    }
    if (seller && !iban) missing.push('Rechnungssteller: IBAN (XRechnung)')
    if (buyer && !buyer.email) missing.push('Rechnungsempfänger: E-Mail (XRechnung)')
  }

  if (missing.length > 0 || !seller || !buyer) {
    return { complete: false, missing, prepared: null }
  }

  // "Not subject to VAT" invoices carry no VAT ids (BR-O-2 … BR-O-4)
  const notSubject = categories.has('O')

  return {
    complete: true,
    missing: [],
    prepared: {
      typeCode: cancels ? '381' : '380',
      precedingInvoice: cancels
        ? { number: String(cancels.invoiceNumber), issueDate: cancels.issueDate ?? '' }
        : null,
      xrechnung: input.xrechnung ?? false,
      number: String(input.invoiceNumber ?? ''),
      issueDate: input.issueDate,
      dueDate: input.dueDate && ISO_DATE.test(input.dueDate) ? input.dueDate : null,
      currency,
      buyerReference: text(input.buyerReference),
      period,
      deliveryDate: input.eventDate && ISO_DATE.test(input.eventDate) ? input.eventDate : null,
      paymentTerms: text(input.paymentTerms),
      notes: [text(input.notes)].filter(Boolean),
      seller: notSubject ? { ...seller, vatId: null } : seller,
      buyer: notSubject ? { ...buyer, vatId: null } : buyer,
      shipToCountry: categories.has('K') ? buyer.countryCode : null,
      payment: iban
        ? {
            iban,
            accountName: text(input.seller?.accountHolder),
            bic: text(input.seller?.bic).toUpperCase()
          }
        : null,
      lines,
      vatGroups: [...groups.values()],
      totals: {
        lineCents: amounts.netCents,
        taxBasisCents: amounts.netCents,
        taxCents,
        grossCents
      }
    }
  }
}
