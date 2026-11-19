import { inject, injectable } from 'tsyringe'
import { MarketingActionRepository } from '../repositories/MarketingActionRepository'
import { InvoiceService } from './InvoiceService'
import { fromCents } from '../einvoice/amounts'
import { CreateInvoiceInput } from '../api/schemas/invoice.schema'
import {
  MARKETING_ACTION_KIND_LABELS,
  type MarketingActionDto,
  type MarketingActionFields,
  type MarketingActionInvoiceInput,
  type MarketingActionKind,
  type MarketingActionScope,
  type MarketingActionStatus,
  type MarketingPayer
} from '../api/schemas/marketing.schema'

/** "2027-03-12" → "12.03.2027" */
function germanDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}.${month}.${year}`
}

/** "12.03.2027" or "12.03.2027 – 26.03.2027"; '' without dates */
export function periodLabel(start: string | null, end: string | null): string {
  if (start && end && end !== start) return `${germanDate(start)} – ${germanDate(end)}`
  if (start) return germanDate(start)
  if (end) return `bis ${germanDate(end)}`
  return ''
}

/** The invoice line for passing a measure's cost on */
export function invoiceLine(action: {
  kind: MarketingActionKind
  title: string
  companyName: string | null
  showLabel: string | null
  tour: string
  startDate: string | null
  endDate: string | null
}): string {
  const period = periodLabel(action.startDate, action.endDate)
  return [
    `${MARKETING_ACTION_KIND_LABELS[action.kind]}: ${action.title}`,
    action.companyName && `bei ${action.companyName}`,
    action.showLabel ? `für ${action.showLabel}` : action.tour && `Tour ${action.tour}`,
    period && `(${period})`
  ]
    .filter(Boolean)
    .join(' ')
}

/** Maßnahmen of a band: list, edit, and the invoice that passes the cost on */
@injectable()
export class MarketingActionService {
  constructor(
    @inject(MarketingActionRepository) private repository: MarketingActionRepository,
    @inject(InvoiceService) private invoices: InvoiceService
  ) {}

  list(scope: MarketingActionScope): MarketingActionDto[] {
    return this.repository.list(scope).map((row) => {
      const a = row.action
      const showLabel = row.showName
        ? [
            row.venueName ? `${row.showName}, ${row.venueName}` : row.showName,
            row.showDate && germanDate(row.showDate)
          ]
            .filter(Boolean)
            .join(' · ')
        : null
      return {
        id: a.id,
        bandId: a.band_id,
        bandName: row.bandName,
        kind: a.kind as MarketingActionKind,
        title: a.title,
        status: a.status as MarketingActionStatus,
        dealMemoId: a.deal_memo_id,
        showLabel,
        showDate: row.showDate,
        tour: a.tour,
        release: a.release,
        companyId: a.company_id,
        companyName: row.companyName,
        marketingItemId: a.marketing_item_id,
        marketingItemName: row.itemName,
        startDate: a.start_date,
        endDate: a.end_date,
        region: a.region,
        costCents: a.cost_cents,
        payer: a.payer as MarketingPayer,
        receiptId: a.receipt_id,
        receiptName: row.receiptName,
        invoiceId: a.invoice_id,
        invoiceNumber: row.invoiceNumber,
        notes: a.notes
      }
    })
  }

  create(fields: MarketingActionFields): number {
    return this.repository.create(fields)
  }

  update(id: number, fields: MarketingActionFields): void {
    this.repository.update(id, fields)
  }

  delete(id: number): void {
    this.repository.delete(id)
  }

  /**
   * "Rechnung erstellen": a draft invoice with the measure's net cost as one line (19 % VAT),
   * to the band or a company, linked to the show; the draft is then edited like any other
   */
  async createInvoice(input: MarketingActionInvoiceInput): Promise<number> {
    const row = this.repository.getById(input.id)
    if (!row) throw new Error('Diese Maßnahme gibt es nicht mehr.')
    if (row.invoice_id !== null) throw new Error('Zu dieser Maßnahme gibt es schon eine Rechnung.')
    if (!row.cost_cents) throw new Error('Bitte zuerst die Kosten der Maßnahme eintragen.')
    if (input.recipient === 'company' && input.recipientCompanyId === null) {
      throw new Error('Bitte die Firma wählen, an die die Rechnung geht.')
    }
    const dto = this.list({ bandId: row.band_id }).find((a) => a.id === row.id)!
    const invoice = await this.invoices.createInvoice(
      CreateInvoiceInput.parse({
        dealMemoId: row.deal_memo_id,
        recipientKind: input.recipient,
        recipientBandId: input.recipient === 'band' ? row.band_id : null,
        recipientCompanyId: input.recipient === 'company' ? input.recipientCompanyId : null,
        periodStartDate: row.start_date,
        periodEndDate: row.end_date ?? row.start_date,
        status: 'draft',
        lineItems: [
          {
            description: invoiceLine(dto),
            quantity: 1,
            unitPriceNet: fromCents(row.cost_cents),
            taxRate: 19,
            taxCode: 'standard'
          }
        ]
      })
    )
    this.repository.setInvoice(row.id, invoice.id)
    return invoice.id
  }
}
