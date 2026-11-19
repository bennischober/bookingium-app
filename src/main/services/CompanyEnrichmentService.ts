import { inject, injectable } from 'tsyringe'
import { readSourceFile } from '../api/sourceFiles'
import { CompanyEnrichmentRepository } from '../repositories/CompanyEnrichmentRepository'
import { EInvoicePartyRepository } from '../repositories/EInvoicePartyRepository'
import { invoiceXmlOf } from './EInvoicePartyService'
import { readSellerParty } from '../einvoice/readParty'
import { readInvoiceText } from '../einvoice/invoiceText'
import { pdfText } from '../einvoice/pdfText'
import {
  fillsFor,
  matchSender,
  proposalFromText,
  type SenderProposal
} from '../einvoice/companyEnrichment'
import {
  EInvoicePartyInput,
  type EInvoicePartyResult,
  type EInvoicePartySource
} from '../api/schemas/einvoice_party.schema'
import type { CompanyEnrichmentDto } from '../api/schemas/company_enrichment.schema'

const isPdf = (bytes: Uint8Array): boolean =>
  bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44

/**
 * #236: completes a known company from an invoice it sent - an e-invoice's data, or what a plain
 * PDF's text says. Only empty fields are filled, after the user confirmed the values.
 */
@injectable()
export class CompanyEnrichmentService {
  constructor(
    @inject(CompanyEnrichmentRepository) private repository: CompanyEnrichmentRepository,
    @inject(EInvoicePartyRepository) private parties: EInvoicePartyRepository
  ) {}

  /** What an invoice file would add to the company it is from; null when nothing */
  async check(source: EInvoicePartySource, senderEmail = ''): Promise<CompanyEnrichmentDto | null> {
    const { bytes } = await readSourceFile(
      source,
      ['pdf', 'xml'],
      'Nur PDF- und XML-Rechnungen lassen sich auswerten.'
    )
    return this.checkBytes(bytes, senderEmail)
  }

  async checkBytes(bytes: Uint8Array, senderEmail = ''): Promise<CompanyEnrichmentDto | null> {
    const companies = this.repository.companies()
    const own = this.repository.ownCompanyIds()
    const ownCompanies = companies.filter((company) => own.has(company.id))

    const xml = await invoiceXmlOf(bytes)
    const seller = xml ? readSellerParty(xml) : null
    if (seller) {
      const match = matchSender(
        {
          vatIds: [seller.vatId],
          taxNumbers: [seller.taxNumber],
          ibans: [seller.bank.iban],
          emails: [seller.email, senderEmail, ...seller.persons.map((p) => p.email)],
          names: [seller.name]
        },
        '',
        companies,
        own
      )
      if (!match) return null
      const party = EInvoicePartyInput.parse({
        name: match.company.name,
        vatId: seller.vatId,
        taxNumber: seller.taxNumber,
        commercialRegisterNo: seller.commercialRegisterNo,
        registerCourt: seller.registerCourt,
        email: seller.email,
        phone: seller.phone,
        address: seller.address,
        bank: seller.bank,
        persons: seller.persons
      })
      const proposal: SenderProposal = {
        name: match.company.name,
        vatId: party.vatId,
        taxNumber: party.taxNumber,
        email: party.email,
        phone: party.phone,
        iban: party.bank.iban,
        bic: party.bank.bic,
        street: party.address.street,
        streetNumber: party.address.streetNumber,
        zipCode: party.address.zipCode,
        city: party.address.city
      }
      const fills = fillsFor(match.company, proposal)
      // people of the e-invoice not yet with the company
      const persons = this.parties.matches(party).persons
      party.persons.forEach((person, index) => {
        if (persons[index]?.isMember) return
        fills.push({
          key: `person${index}`,
          label: person.role || 'Person',
          value: [`${person.firstName} ${person.lastName}`.trim(), person.email]
            .filter(Boolean)
            .join(', ')
        })
      })
      if (fills.length === 0) return null
      return {
        companyId: match.company.id,
        companyName: match.company.name,
        origin: 'einvoice',
        matchedBy: match.by,
        fills,
        party
      }
    }

    if (!isPdf(bytes)) return null
    const text = await pdfText(bytes)
    if (!text.trim()) return null
    const facts = readInvoiceText(text)
    const match = matchSender(
      { ...facts, emails: [...facts.emails, senderEmail], names: [] },
      text,
      companies,
      own
    )
    if (!match) return null
    const proposal = proposalFromText(facts, ownCompanies, match.company)
    const fills = fillsFor(match.company, proposal)
    if (fills.length === 0) return null
    const party = EInvoicePartyInput.parse({
      name: match.company.name,
      vatId: proposal.vatId,
      taxNumber: proposal.taxNumber,
      email: proposal.email,
      phone: proposal.phone,
      address: {
        street: proposal.street,
        streetNumber: proposal.streetNumber,
        zipCode: proposal.zipCode,
        city: proposal.city,
        countryCode: proposal.zipCode ? 'DE' : ''
      },
      bank: { iban: proposal.iban, bic: proposal.bic, accountHolder: match.company.name },
      persons: []
    })
    return {
      companyId: match.company.id,
      companyName: match.company.name,
      origin: 'pdf',
      matchedBy: match.by,
      fills,
      party
    }
  }

  /** Fills the company's empty fields with what the user confirmed */
  apply(companyId: number, party: EInvoicePartyInput): EInvoicePartyResult {
    return this.parties.apply(party, companyId)
  }
}
