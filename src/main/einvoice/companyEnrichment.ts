// #236: which known company an invoice is from, and what of its data is still empty. Pure: the
// service reads the file and the companies. An invoice names its recipient too (our own
// companies, the bands' companies): their values are never taken as the sender's.

import type { CompanyFacts } from '../repositories/CompanyEnrichmentRepository'
import type { CompanyEnrichmentFill } from '../api/schemas/company_enrichment.schema'
import { formatIban, type InvoiceTextFacts } from './invoiceText'
import { normalizeKey } from '../import/normalize'
import { GENERIC_DOMAINS } from '../mail/genericDomains'

/** What the invoice says about its sender, one value each ('' for unknown) */
export type SenderProposal = {
  name: string
  vatId: string
  taxNumber: string
  email: string
  phone: string
  iban: string
  bic: string
  street: string
  streetNumber: string
  zipCode: string
  city: string
}

export type MatchedBy = 'vatId' | 'taxNumber' | 'iban' | 'email' | 'name'

const vatKey = (value: string): string => value.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
const digits = (value: string): string => value.replace(/\D/g, '')
const ibanKey = (value: string): string => value.replace(/\s/g, '').toUpperCase()
const domainOf = (email: string): string => email.trim().toLowerCase().split('@')[1] ?? ''

/** The only company of `candidates`, null for none or several */
const single = (candidates: CompanyFacts[]): CompanyFacts | null => {
  const ids = new Set(candidates.map((c) => c.id))
  return ids.size === 1 ? candidates[0] : null
}

/**
 * The company an invoice is from: by VAT id, tax number, IBAN, the e-mail domain (of the
 * invoice or the mail's sender), else the longest company name in the text. Our own companies
 * are never the sender.
 */
export function matchSender(
  facts: {
    vatIds: string[]
    taxNumbers: string[]
    ibans: string[]
    emails: string[]
    names: string[]
  },
  text: string,
  companies: CompanyFacts[],
  own: Set<number>
): { company: CompanyFacts; by: MatchedBy } | null {
  const others = companies.filter((company) => !own.has(company.id))
  const vats = new Set(facts.vatIds.map(vatKey).filter(Boolean))
  const byVat = single(others.filter((c) => c.vatId && vats.has(vatKey(c.vatId))))
  if (byVat) return { company: byVat, by: 'vatId' }
  const taxes = new Set(facts.taxNumbers.map(digits).filter((t) => t.length >= 8))
  const byTax = single(others.filter((c) => c.taxNumber && taxes.has(digits(c.taxNumber))))
  if (byTax) return { company: byTax, by: 'taxNumber' }
  const ibans = new Set(facts.ibans.map(ibanKey))
  const byIban = single(others.filter((c) => c.iban && ibans.has(ibanKey(c.iban))))
  if (byIban) return { company: byIban, by: 'iban' }
  const domains = new Set(
    facts.emails.map(domainOf).filter((domain) => domain && !GENERIC_DOMAINS.has(domain))
  )
  const byDomain = single(others.filter((c) => c.domains.some((domain) => domains.has(domain))))
  if (byDomain) return { company: byDomain, by: 'email' }

  const haystack = ` ${normalizeKey([...facts.names, text].join(' '))} `
  const named = others
    .map((company) => ({ company, key: normalizeKey(company.name) }))
    .filter(({ key }) => key.length >= 4 && haystack.includes(` ${key} `))
    .sort((a, b) => b.key.length - a.key.length)
  if (named.length === 0) return null
  // two different companies of the same longest name are no answer
  const longest = named.filter(({ key }) => key.length === named[0].key.length)
  return longest.length === 1 ? { company: longest[0].company, by: 'name' } : null
}

/**
 * The sender's values from a plain invoice's text: of each kind the one value left once our
 * own companies' values are taken out; '' where none or several are left
 */
export function proposalFromText(
  facts: InvoiceTextFacts,
  ownCompanies: CompanyFacts[],
  sender: CompanyFacts
): SenderProposal {
  const ownVats = new Set(ownCompanies.map((c) => vatKey(c.vatId)).filter(Boolean))
  const ownTaxes = new Set(ownCompanies.map((c) => digits(c.taxNumber)).filter(Boolean))
  const ownIbans = new Set(ownCompanies.map((c) => ibanKey(c.iban)).filter(Boolean))
  const ownDomains = new Set(ownCompanies.flatMap((c) => c.domains))
  const ownZips = new Set(ownCompanies.map((c) => c.zipCode).filter(Boolean))
  const one = (values: string[]): string => (values.length === 1 ? values[0] : '')

  const vatId = one(facts.vatIds.filter((v) => !ownVats.has(vatKey(v))))
  const taxNumber = one(facts.taxNumbers.filter((t) => !ownTaxes.has(digits(t))))
  const iban = one(facts.ibans.filter((i) => !ownIbans.has(ibanKey(i))))
  const senderDomains = new Set(sender.domains)
  const emails = facts.emails.filter((e) => !ownDomains.has(domainOf(e)))
  const email =
    emails.find((e) => senderDomains.has(domainOf(e))) ?? (emails.length === 1 ? emails[0] : '')
  const addresses = facts.addresses.filter((a) => !ownZips.has(a.zipCode))
  const address = addresses.length >= 1 ? addresses[0] : null
  return {
    name: sender.name,
    vatId,
    taxNumber,
    email,
    phone: one(facts.phones),
    iban: iban ? formatIban(iban) : '',
    bic: iban ? one(facts.bics) : '',
    street: address?.street ?? '',
    streetNumber: address?.streetNumber ?? '',
    zipCode: address?.zipCode ?? '',
    city: address?.city ?? ''
  }
}

/** The values of the proposal that would fill an empty field of the company */
export function fillsFor(company: CompanyFacts, proposal: SenderProposal): CompanyEnrichmentFill[] {
  const fills: CompanyEnrichmentFill[] = []
  const add = (key: string, label: string, current: string, value: string): void => {
    if (!current.trim() && value.trim()) fills.push({ key, label, value: value.trim() })
  }
  if (!company.street && !company.zipCode && !company.city) {
    const line = [
      [proposal.street, proposal.streetNumber].filter(Boolean).join(' '),
      [proposal.zipCode, proposal.city].filter(Boolean).join(' ')
    ]
      .filter(Boolean)
      .join(', ')
    add('address', 'Adresse', '', line)
  }
  add('email', 'E-Mail', company.email, proposal.email)
  add('phone', 'Telefon', company.phone, proposal.phone)
  add('vatId', 'USt-IdNr.', company.vatId, proposal.vatId)
  add('taxNumber', 'Steuernummer', company.taxNumber, proposal.taxNumber)
  add('iban', 'IBAN', company.iban, proposal.iban)
  if (!company.iban && proposal.iban) add('bic', 'BIC', company.bic, proposal.bic)
  return fills
}
