// The seller of a received e-invoice (#222): who sent it, as the company and the people
// the app would create for it. Reads both syntaxes an e-invoice comes in: CII
// (ZUGFeRD/Factur-X, XRechnung CII) and UBL (XRechnung UBL, Invoice and CreditNote).
// Pure (no Node, no DOM), like the rest of this folder apart from facturx.ts.

import { cleanText, countryByCode, parsePersons } from '../import/normalize'
import { at, childrenNamed, parseXml, textAt, type XmlElement } from './xmlTree'
import { toCents } from './amounts'

export interface EInvoicePartyPerson {
  firstName: string
  lastName: string
  email: string
  phone: string
  /** "Kontakt" for the invoice contact, "Geschäftsführer" for one named in the notes */
  role: string
}

export interface EInvoiceParty {
  syntax: 'cii' | 'ubl'
  /** The invoice the data came from, for the preview */
  invoiceNumber: string
  /** ISO date or '' */
  issueDate: string
  /** Amount due incl. VAT in cents, null if the XML has none (#225) */
  totalCents: number | null
  /** ISO 4217 code of the invoice, '' if none */
  currency: string
  name: string
  vatId: string
  taxNumber: string
  commercialRegisterNo: string
  registerCourt: string
  email: string
  phone: string
  address: {
    street: string
    streetNumber: string
    addressSuffix: string
    zipCode: string
    city: string
    state: string
    country: string
    countryCode: string
  }
  bank: { iban: string; bic: string; accountHolder: string }
  persons: EInvoicePartyPerson[]
}

export const CONTACT_ROLE = 'Kontakt'
export const MANAGING_DIRECTOR_ROLE = 'Geschäftsführer'

/** "Musterstraße 12a" → street and number; anything else stays the street */
export function splitStreet(line: string): { street: string; streetNumber: string } {
  const text = cleanText(line)
  const match = /^(.*\D)\s+(\d+\s*[a-z]?(?:\s*[-/]\s*\d+\s*[a-z]?)?)$/i.exec(text)
  if (!match || !match[1].trim()) return { street: text, streetNumber: '' }
  return { street: match[1].trim(), streetNumber: match[2].replace(/\s+/g, '') }
}

const VAT_ID = /^[A-Z]{2}[0-9A-Z+*.]{2,13}$/

const normalizeVatId = (raw: string): string => raw.replace(/[\s.-]+/g, '').toUpperCase()

/** "Amtsgericht Musterstadt HRB 12345" in legal info or notes */
function registerOf(texts: string[]): { commercialRegisterNo: string; registerCourt: string } {
  let commercialRegisterNo = ''
  let registerCourt = ''
  for (const text of texts) {
    if (!commercialRegisterNo) {
      const register = /\b(HR[AB]|GnR|PR|VR)\s*(?:Nr\.?\s*)?(\d+\s*[A-Z]?)\b/.exec(text)
      if (register) commercialRegisterNo = `${register[1]} ${register[2].replace(/\s+/g, '')}`
    }
    if (!registerCourt) {
      // "AG" alone is a legal form too ("Muster AG"), so it counts only right before HRA/HRB
      const court =
        /\b(?:Amtsgericht|Registergericht)\s*:?\s+([A-ZÄÖÜ][\wÄÖÜäöüß.-]*(?:\s(?:am|an der|im|in der)\s[\wÄÖÜäöüß.-]+|\s\([^)]+\))?)/.exec(
          text
        ) ?? /\bAG\s+([A-ZÄÖÜ][\wÄÖÜäöüß.-]*)\s*,?\s*HR[AB]\b/.exec(text)
      if (court) registerCourt = `Amtsgericht ${court[1]}`
    }
  }
  return { commercialRegisterNo, registerCourt }
}

// Text after a Geschäftsführer label runs until the next piece of legal info
const DIRECTOR_LABEL =
  /(?:Geschäftsführ(?:er(?:in)?|erinnen|ung|ende\s+Gesellschafter(?:in)?)|\bGF|Managing\s+Directors?)\s*[:.]?\s+/gi
const DIRECTOR_END =
  /\s*(?:[|;\n]|\b(?:Amtsgericht|Registergericht|AG\s|HR[AB]|USt|UStId|Steuer|St\.?-?Nr|Sitz|IBAN|BIC|Bank|Tel|Telefon|Fax|E-?Mail|www\.|Web)\b|\s[-–]\s)/i

/** The people a note names as Geschäftsführer ("Geschäftsführer: Erika Muster, Max Muster") */
export function managingDirectorsOf(
  texts: string[]
): Array<{ firstName: string; lastName: string }> {
  const found: Array<{ firstName: string; lastName: string }> = []
  for (const text of texts) {
    for (const label of text.matchAll(DIRECTOR_LABEL)) {
      const rest = text.slice((label.index ?? 0) + label[0].length)
      const end = DIRECTOR_END.exec(rest)
      const names = (end ? rest.slice(0, end.index) : rest).replace(/[.,]+$/, '')
      for (const person of parsePersons(names)) {
        // A single word is a title or a fragment, not a person
        if (!person.lastName) continue
        const key = `${person.firstName} ${person.lastName}`.toLowerCase()
        if (found.some((other) => `${other.firstName} ${other.lastName}`.toLowerCase() === key))
          continue
        found.push({ firstName: person.firstName, lastName: person.lastName })
      }
    }
  }
  return found
}

function personOfName(name: string): { firstName: string; lastName: string } | null {
  const [person] = parsePersons(name)
  return person ? { firstName: person.firstName, lastName: person.lastName } : null
}

function isoDate(raw: string): string {
  const compact = raw.replace(/\s+/g, '')
  if (/^\d{8}$/.test(compact))
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(compact)) return compact
  return ''
}

/** "1234.50" (XML decimal) in cents, null if there is no number */
function centsOf(raw: string): number | null {
  const value = raw.trim()
  if (!/^-?\d+(\.\d+)?$/.test(value)) return null
  return toCents(Number(value))
}

const currencyOf = (raw: string): string => {
  const code = raw.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : ''
}

function emptyParty(syntax: EInvoiceParty['syntax']): EInvoiceParty {
  return {
    syntax,
    invoiceNumber: '',
    issueDate: '',
    totalCents: null,
    currency: '',
    name: '',
    vatId: '',
    taxNumber: '',
    commercialRegisterNo: '',
    registerCourt: '',
    email: '',
    phone: '',
    address: {
      street: '',
      streetNumber: '',
      addressSuffix: '',
      zipCode: '',
      city: '',
      state: '',
      country: '',
      countryCode: ''
    },
    bank: { iban: '', bic: '', accountHolder: '' },
    persons: []
  }
}

function setTaxId(party: EInvoiceParty, raw: string, scheme: string): void {
  const value = cleanText(raw)
  if (!value) return
  const compact = normalizeVatId(value)
  if (scheme === 'VA' || scheme === 'VAT' || (!scheme && VAT_ID.test(compact))) {
    if (!party.vatId) party.vatId = compact
  } else if (!party.taxNumber) {
    party.taxNumber = value
  }
}

function addPeople(
  party: EInvoiceParty,
  contact: EInvoicePartyPerson | null,
  notes: string[]
): void {
  if (contact) party.persons.push(contact)
  for (const director of managingDirectorsOf(notes)) {
    const same = party.persons.find(
      (person) =>
        person.firstName.toLowerCase() === director.firstName.toLowerCase() &&
        person.lastName.toLowerCase() === director.lastName.toLowerCase()
    )
    if (same) continue
    party.persons.push({ ...director, email: '', phone: '', role: MANAGING_DIRECTOR_ROLE })
  }
}

function setAddress(
  party: EInvoiceParty,
  lines: string[],
  zipCode: string,
  city: string,
  state: string,
  countryCode: string
): void {
  const [first = '', ...rest] = lines.map(cleanText).filter(Boolean)
  const { street, streetNumber } = splitStreet(first)
  const code = countryCode.trim().toUpperCase()
  party.address = {
    street,
    streetNumber,
    addressSuffix: rest.join(', '),
    zipCode: cleanText(zipCode),
    city: cleanText(city),
    state: cleanText(state),
    country: countryByCode(code)?.name ?? '',
    countryCode: /^[A-Z]{2}$/.test(code) ? code : ''
  }
}

function readCii(root: XmlElement): EInvoiceParty {
  const party = emptyParty('cii')
  party.invoiceNumber = textAt(root, 'ExchangedDocument', 'ID')
  party.issueDate = isoDate(textAt(root, 'ExchangedDocument', 'IssueDateTime', 'DateTimeString'))

  const transaction = at(root, 'SupplyChainTradeTransaction')
  const seller = at(transaction, 'ApplicableHeaderTradeAgreement', 'SellerTradeParty')
  const summation = at(
    transaction,
    'ApplicableHeaderTradeSettlement',
    'SpecifiedTradeSettlementHeaderMonetarySummation'
  )
  party.totalCents =
    centsOf(textAt(summation, 'GrandTotalAmount')) ?? centsOf(textAt(summation, 'DuePayableAmount'))
  party.currency = currencyOf(
    textAt(transaction, 'ApplicableHeaderTradeSettlement', 'InvoiceCurrencyCode')
  )
  party.name =
    cleanText(textAt(seller, 'Name')) ||
    cleanText(textAt(seller, 'SpecifiedLegalOrganization', 'TradingBusinessName'))

  for (const registration of childrenNamed(seller, 'SpecifiedTaxRegistration')) {
    const id = at(registration, 'ID')
    setTaxId(party, id?.text ?? '', id?.attributes.schemeID ?? '')
  }

  const address = at(seller, 'PostalTradeAddress')
  setAddress(
    party,
    [textAt(address, 'LineOne'), textAt(address, 'LineTwo'), textAt(address, 'LineThree')],
    textAt(address, 'PostcodeCode'),
    textAt(address, 'CityName'),
    textAt(address, 'CountrySubDivisionName'),
    textAt(address, 'CountryID')
  )

  const electronic = at(seller, 'URIUniversalCommunication', 'URIID')
  if (electronic && (electronic.attributes.schemeID ?? 'EM') === 'EM') {
    party.email = electronic.text
  }

  const contactElement = at(seller, 'DefinedTradeContact')
  const contactName = personOfName(textAt(contactElement, 'PersonName'))
  const contactEmail = textAt(contactElement, 'EmailURIUniversalCommunication', 'URIID')
  const contactPhone = textAt(contactElement, 'TelephoneUniversalCommunication', 'CompleteNumber')
  // Without a person's name the contact's details belong to the company
  if (!party.email && !contactName) party.email = contactEmail
  if (!contactName) party.phone = contactPhone
  const contact = contactName
    ? { ...contactName, email: contactEmail, phone: contactPhone, role: CONTACT_ROLE }
    : null

  const notes = [
    textAt(seller, 'Description'),
    textAt(seller, 'SpecifiedLegalOrganization', 'ID'),
    ...childrenNamed(at(root, 'ExchangedDocument'), 'IncludedNote').map((note) =>
      textAt(note, 'Content')
    )
  ].filter(Boolean)
  Object.assign(party, registerOf(notes))
  addPeople(party, contact, notes)

  const settlement = at(transaction, 'ApplicableHeaderTradeSettlement')
  for (const means of childrenNamed(settlement, 'SpecifiedTradeSettlementPaymentMeans')) {
    const account = at(means, 'PayeePartyCreditorFinancialAccount')
    const iban = textAt(account, 'IBANID').replace(/\s+/g, '').toUpperCase()
    if (!iban) continue
    party.bank = {
      iban,
      bic: textAt(means, 'PayeeSpecifiedCreditorFinancialInstitution', 'BICID').toUpperCase(),
      accountHolder: cleanText(textAt(account, 'AccountName'))
    }
    break
  }
  return party
}

function readUbl(root: XmlElement): EInvoiceParty {
  const party = emptyParty('ubl')
  party.invoiceNumber = textAt(root, 'ID')
  party.issueDate = isoDate(textAt(root, 'IssueDate'))
  const total = at(root, 'LegalMonetaryTotal')
  party.totalCents =
    centsOf(textAt(total, 'TaxInclusiveAmount')) ?? centsOf(textAt(total, 'PayableAmount'))
  party.currency = currencyOf(textAt(root, 'DocumentCurrencyCode'))

  const seller = at(root, 'AccountingSupplierParty', 'Party')
  const legal = at(seller, 'PartyLegalEntity')
  party.name =
    cleanText(textAt(legal, 'RegistrationName')) || cleanText(textAt(seller, 'PartyName', 'Name'))

  for (const scheme of childrenNamed(seller, 'PartyTaxScheme')) {
    const kind = textAt(scheme, 'TaxScheme', 'ID').toUpperCase()
    setTaxId(party, textAt(scheme, 'CompanyID'), kind === 'VAT' ? 'VA' : 'FC')
  }

  const address = at(seller, 'PostalAddress')
  setAddress(
    party,
    [
      textAt(address, 'StreetName'),
      textAt(address, 'AdditionalStreetName'),
      textAt(address, 'AddressLine', 'Line')
    ],
    textAt(address, 'PostalZone'),
    textAt(address, 'CityName'),
    textAt(address, 'CountrySubentity'),
    textAt(address, 'Country', 'IdentificationCode')
  )

  const endpoint = at(seller, 'EndpointID')
  if (endpoint && endpoint.attributes.schemeID === 'EM') party.email = endpoint.text

  const contactElement = at(seller, 'Contact')
  const contactName = personOfName(textAt(contactElement, 'Name'))
  const contactEmail = textAt(contactElement, 'ElectronicMail')
  const contactPhone = textAt(contactElement, 'Telephone')
  if (!party.email && !contactName) party.email = contactEmail
  if (!contactName) party.phone = contactPhone
  const contact = contactName
    ? { ...contactName, email: contactEmail, phone: contactPhone, role: CONTACT_ROLE }
    : null

  const notes = [
    textAt(legal, 'CompanyLegalForm'),
    textAt(legal, 'CompanyID'),
    ...childrenNamed(root, 'Note').map((note) => note.text)
  ].filter(Boolean)
  Object.assign(party, registerOf(notes))
  addPeople(party, contact, notes)

  for (const means of childrenNamed(root, 'PaymentMeans')) {
    const account = at(means, 'PayeeFinancialAccount')
    const iban = textAt(account, 'ID').replace(/\s+/g, '').toUpperCase()
    if (!iban) continue
    party.bank = {
      iban,
      bic: textAt(account, 'FinancialInstitutionBranch', 'ID').toUpperCase(),
      accountHolder: cleanText(textAt(account, 'Name'))
    }
    break
  }
  return party
}

/** The seller of an e-invoice XML, null if the text is no e-invoice or names no seller */
export function readSellerParty(xml: string): EInvoiceParty | null {
  const root = parseXml(xml.replace(/^\uFEFF/, ''))
  if (!root) return null
  const party =
    root.name === 'CrossIndustryInvoice'
      ? readCii(root)
      : root.name === 'Invoice' || root.name === 'CreditNote'
        ? readUbl(root)
        : null
  if (!party || !party.name) return null
  // An e-mail address in the phone field and the like: keep only what looks right
  if (party.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(party.email)) party.email = ''
  for (const person of party.persons) {
    if (person.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email)) person.email = ''
  }
  return party
}
