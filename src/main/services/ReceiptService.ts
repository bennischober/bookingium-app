import { injectable, inject } from 'tsyringe'
import { readFile } from 'fs/promises'
import { ReceiptRepository } from '../repositories/ReceiptRepository'
import { EInvoicePartyRepository } from '../repositories/EInvoicePartyRepository'
import { invoiceXmlOf } from './EInvoicePartyService'
import { readSellerParty } from '../einvoice/readParty'
import {
  imageToPdf,
  RECEIPT_CONTENT_TYPES,
  receiptFileKind,
  receiptFileName,
  suggestReceiptName
} from '../receipts/receiptFiles'
import { storeReceiptFile } from '../utils/receiptStorage'
import { findDocumentFile, getDocumentFullPath } from '../utils/fileStorage'
import {
  RECEIPT_CATEGORY_LABELS,
  type ReceiptDraft,
  type ReceiptFields,
  type ReceiptListInput,
  type UpdateReceiptInput
} from '../api/schemas/receipt.schema'

export const UNSUPPORTED_RECEIPT_FILE =
  'Belege können PDF-, XML-, JPG- oder PNG-Dateien sein. Andere Bilder (z. B. HEIC vom iPhone) ' +
  'bitte vorher als JPG speichern.'

/** Where a receipt's file came from, kept with it */
export type ReceiptOrigin = { messageId: string | null; mailAccountId: string } | null

/** The stored form of a file: PDFs and XML as they are, photos as a one-page PDF */
export async function receiptBytes(
  bytes: Uint8Array
): Promise<{ bytes: Uint8Array; extension: 'pdf' | 'xml' }> {
  const kind = receiptFileKind(bytes)
  if (kind === 'pdf' || kind === 'xml') return { bytes, extension: kind }
  if (kind === 'jpeg' || kind === 'png') {
    try {
      return { bytes: await imageToPdf(bytes, kind), extension: 'pdf' }
    } catch {
      throw new Error('Das Bild konnte nicht gelesen werden.')
    }
  }
  throw new Error(UNSUPPORTED_RECEIPT_FILE)
}

@injectable()
export class ReceiptService {
  constructor(
    @inject(ReceiptRepository) private repository: ReceiptRepository,
    @inject(EInvoicePartyRepository) private parties: EInvoicePartyRepository
  ) {}

  /** What a file suggests for a new receipt; an e-invoice fills date, amount and supplier */
  async read(bytes: Uint8Array, sourceName: string): Promise<ReceiptDraft> {
    const kind = receiptFileKind(bytes)
    if (!kind) throw new Error(UNSUPPORTED_RECEIPT_FILE)
    const xml = kind === 'pdf' || kind === 'xml' ? await invoiceXmlOf(bytes) : null
    const invoice = xml ? readSellerParty(xml) : null
    if (kind === 'xml' && !invoice) {
      throw new Error('Diese XML-Datei ist keine E-Rechnung (ZUGFeRD, Factur-X oder XRechnung).')
    }
    const supplierMatch = invoice ? this.parties.findCompany(invoice) : null
    const supplierName = supplierMatch?.name ?? invoice?.name ?? ''
    const receiptDate = invoice?.issueDate || null
    const reference = invoice?.invoiceNumber ?? ''
    const fields: ReceiptFields = {
      companyId: null,
      category: 'incoming',
      receiptDate,
      amountCents: invoice?.totalCents ?? null,
      currency: invoice?.currency || 'EUR',
      supplierCompanyId: supplierMatch?.id ?? null,
      supplierName,
      reference,
      notes: '',
      inDatev: false,
      fileName: invoice
        ? suggestReceiptName({
            receiptDate,
            supplierName,
            reference,
            categoryLabel: RECEIPT_CATEGORY_LABELS.incoming
          })
        : sourceName.replace(/\.[^.]+$/, '') || 'Beleg'
    }
    return {
      sourceName,
      isEInvoice: invoice !== null,
      isImage: kind === 'jpeg' || kind === 'png',
      fields,
      supplierMatch: supplierMatch ? { id: supplierMatch.id, name: supplierMatch.name } : null
    }
  }

  /** Stores the file (photos as PDF) and records the receipt; returns its id */
  async create(fields: ReceiptFields, bytes: Uint8Array, origin: ReceiptOrigin): Promise<number> {
    const stored = await receiptBytes(bytes)
    const fileName = receiptFileName(fields.fileName, stored.extension)
    const companyId = fields.companyId ?? this.repository.defaultCompanyId()
    const file = await storeReceiptFile(stored.bytes, fileName, fields.receiptDate)
    return this.repository.create({
      ...this.columns(fields),
      company_id: companyId,
      file_name: fileName,
      file_path: file.relativePath,
      file_size: file.fileSize,
      source_message_id: origin?.messageId ?? null,
      source_mail_account_id: origin?.mailAccountId ?? null
    })
  }

  /** Changes the fields; a new name keeps the stored file's extension */
  update(input: UpdateReceiptInput): void {
    const row = this.repository.getById(input.id)
    if (!row) throw new Error('Beleg nicht gefunden')
    const extension = row.receipt.file_name.toLowerCase().endsWith('.xml') ? 'xml' : 'pdf'
    this.repository.update(input.id, {
      ...this.columns(input),
      // Changing the own company back to "default" keeps the stored one
      company_id: input.companyId ?? row.receipt.company_id,
      file_name: receiptFileName(input.fileName, extension)
    })
  }

  private columns(fields: ReceiptFields) {
    return {
      category: fields.category,
      receipt_date: fields.receiptDate,
      amount_cents: fields.amountCents,
      currency: fields.currency,
      supplier_company_id: fields.supplierCompanyId,
      // A linked company names the supplier; the typed name is kept for when it goes
      supplier_name: fields.supplierName,
      reference: fields.reference,
      notes: fields.notes,
      in_datev: fields.inDatev ?? false
    }
  }

  getById(id: number) {
    return this.repository.getById(id)
  }

  list(input: ReceiptListInput) {
    return this.repository.list(input)
  }

  listNotHandedOver() {
    return this.repository.listNotHandedOver()
  }

  listTransfers(id: number) {
    return this.repository.listTransfers(id)
  }

  /** The absolute path of the stored file, null if it is gone */
  async filePath(id: number): Promise<string | null> {
    const row = this.repository.getById(id)
    if (!row) return null
    return await findDocumentFile(row.receipt.file_path)
  }

  /** The stored file's bytes and the type to send it as */
  async fileBytes(id: number): Promise<{ bytes: Uint8Array; contentType: string }> {
    const row = this.repository.getById(id)
    if (!row) throw new Error('Beleg nicht gefunden')
    const bytes = new Uint8Array(await readFile(await getDocumentFullPath(row.receipt.file_path)))
    const kind = row.receipt.file_name.toLowerCase().endsWith('.xml') ? 'xml' : 'pdf'
    return { bytes, contentType: RECEIPT_CONTENT_TYPES[kind] }
  }

  /** Removes the record; the router has moved the file to the trash */
  deleteRecord(id: number): void {
    this.repository.delete(id)
  }
}
