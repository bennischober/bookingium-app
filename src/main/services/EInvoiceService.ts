import { inject, injectable } from 'tsyringe'
import { InvoiceRepository } from '../repositories/InvoiceRepository'
import { SettingsService } from './SettingsService'
import { InvoiceMapper } from '../api/mappers/invoice.mapper'
import type { EInvoiceCheckDto, PreviewInvoicePartiesInput } from '../api/schemas/invoice.schema'
import { eInvoiceInputOf } from '../einvoice/input'
import { prepareEInvoice } from '../einvoice/prepare'
import { buildCiiXml } from '../einvoice/cii'
import { embedFacturX } from '../einvoice/facturx'

/**
 * E-invoices (ZUGFeRD/Factur-X, EN 16931): the completeness check of an
 * invoice and its XML, embedded into the invoice PDF when it is saved.
 * Issued invoices use their frozen snapshots; drafts are checked with the
 * parties' current master data, which issuing will freeze.
 */
@injectable()
export class EInvoiceService {
  constructor(
    @inject(InvoiceRepository) private invoiceRepository: InvoiceRepository,
    @inject(SettingsService) private settingsService: SettingsService
  ) {}

  /** What the e-invoice of an invoice looks like right now, with its XML when ready */
  async check(invoiceId: number): Promise<EInvoiceCheckDto & { xml: string | null }> {
    const entity = await this.invoiceRepository.getByIdWithSnapshots(invoiceId)
    if (!entity) throw new Error('Rechnung nicht gefunden')

    if (!this.settingsService.get().eInvoiceEmbed) {
      return { state: 'disabled', missing: [], xml: null }
    }
    if (entity.status === 'cancelled') return { state: 'cancelled', missing: [], xml: null }

    const data = InvoiceMapper.toPrintDto(
      entity,
      entity.issuerSnapshot ?? null,
      entity.recipientSnapshot ?? null
    )

    if (entity.status === 'draft') {
      const parties = this.invoiceRepository.currentParties(invoiceId)
      const result = prepareEInvoice(
        eInvoiceInputOf({
          ...data,
          issuer: InvoiceMapper.toPartyPreviewDto(parties.issuer),
          recipient: parties.recipient ? InvoiceMapper.toPartyPreviewDto(parties.recipient) : null
        }),
        { ignoreNumber: true }
      )
      return { state: result.complete ? 'draft' : 'incomplete', missing: result.missing, xml: null }
    }

    const result = prepareEInvoice(eInvoiceInputOf(data))
    return result.complete
      ? { state: 'ready', missing: [], xml: buildCiiXml(result.prepared) }
      : { state: 'incomplete', missing: result.missing, xml: null }
  }

  /**
   * The invoice PDF with its e-invoice embedded when it is ready; otherwise
   * (or if embedding fails) the PDF as printed, with the reason
   */
  async attachToPdf(
    invoiceId: number,
    pdf: Uint8Array,
    title: string
  ): Promise<{ pdf: Uint8Array; eInvoice: EInvoiceCheckDto }> {
    const { xml, ...check } = await this.check(invoiceId)
    if (!xml) return { pdf, eInvoice: check }
    try {
      return { pdf: await embedFacturX(pdf, xml, { title }), eInvoice: check }
    } catch (error) {
      console.error('Embedding the e-invoice failed:', error)
      return {
        pdf,
        eInvoice: { state: 'incomplete', missing: ['E-Rechnung konnte nicht eingebettet werden'] }
      }
    }
  }

  /** Issuer and recipient as a draft with these settings would get them (form check) */
  previewParties(input: PreviewInvoicePartiesInput) {
    const parties = this.invoiceRepository.previewParties(input)
    return {
      issuer: InvoiceMapper.toPartyPreviewDto(parties.issuer),
      recipient: InvoiceMapper.toPartyPreviewDto(parties.recipient)
    }
  }
}
