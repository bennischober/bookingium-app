import { injectable, inject } from 'tsyringe'
import { EInvoicePartyRepository } from '../repositories/EInvoicePartyRepository'
import { readEmbeddedInvoiceXml } from '../einvoice/facturx'
import { readSellerParty } from '../einvoice/readParty'
import {
  EInvoicePartyInput,
  type EInvoicePartyPreview,
  type EInvoicePartyResult
} from '../api/schemas/einvoice_party.schema'

/** Thrown with a message the user can read */
export class EInvoicePartyError extends Error {}

export const NO_EINVOICE =
  'In dieser Datei steckt keine E-Rechnung (ZUGFeRD, Factur-X oder XRechnung). ' +
  'Firmen lassen sich bisher nur aus E-Rechnungen anlegen.'

const isPdf = (bytes: Uint8Array): boolean =>
  bytes.length > 4 &&
  bytes[0] === 0x25 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x44 &&
  bytes[3] === 0x46

/** The e-invoice XML in a file: embedded in a PDF, or the file itself */
export async function invoiceXmlOf(bytes: Uint8Array): Promise<string | null> {
  if (isPdf(bytes)) {
    try {
      return await readEmbeddedInvoiceXml(bytes)
    } catch {
      return null
    }
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '')
  return text.trimStart().startsWith('<') ? text : null
}

@injectable()
export class EInvoicePartyService {
  constructor(@inject(EInvoicePartyRepository) private repository: EInvoicePartyRepository) {}

  /** Reads the seller of an e-invoice file and what it matches in the app */
  async read(bytes: Uint8Array, fileName: string): Promise<EInvoicePartyPreview> {
    const xml = await invoiceXmlOf(bytes)
    const read = xml ? readSellerParty(xml) : null
    if (!read) throw new EInvoicePartyError(NO_EINVOICE)
    const party = EInvoicePartyInput.parse({
      name: read.name,
      vatId: read.vatId,
      taxNumber: read.taxNumber,
      commercialRegisterNo: read.commercialRegisterNo,
      registerCourt: read.registerCourt,
      email: read.email,
      phone: read.phone,
      address: read.address,
      bank: read.bank,
      persons: read.persons
    })
    return {
      fileName,
      invoiceNumber: read.invoiceNumber,
      issueDate: read.issueDate,
      party,
      ...this.repository.matches(party)
    }
  }

  /** Writes what the user confirmed; matches are looked up again against the current data */
  apply(party: EInvoicePartyInput): EInvoicePartyResult {
    return this.repository.apply(party)
  }
}
