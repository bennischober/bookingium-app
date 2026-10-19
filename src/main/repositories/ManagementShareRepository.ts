import { inject, injectable } from 'tsyringe'
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { InvoiceRepository } from './InvoiceRepository'
import { roundMoney } from '../einvoice/amounts'
import {
  managementShareAmount,
  quarterDates,
  quarterLabel,
  type CreateManagementShareInput,
  type ManagementShareDto
} from '../api/schemas/management_contract.schema'

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

@injectable()
export class ManagementShareRepository {
  constructor(@inject(InvoiceRepository) private invoiceRepository: InvoiceRepository) {}

  /**
   * Bills a quarter from a management contract: a DRAFT invoice from the
   * management company to the band's company with one line
   * "Managementbeteiligung 4. Quartal 2025" = income × commission %, due
   * after the contract's payment days. The income lines are kept with it.
   */
  async createForContract(input: CreateManagementShareInput): Promise<ManagementShareDto> {
    const shareId = db.transaction((tx) => {
      const contract = tx
        .select()
        .from(schema.management_contract)
        .where(eq(schema.management_contract.id, input.contractId))
        .get()
      if (!contract) throw new Error('Managementvertrag nicht gefunden')
      if (!contract.management_company_id) {
        throw new Error('Im Vertrag ist kein Management ausgewählt')
      }
      const band = tx.select().from(schema.band).where(eq(schema.band.id, contract.band_id)).get()
      if (!band) throw new Error('Band nicht gefunden')

      const label = quarterLabel(input.year, input.quarter)
      // A quarter is billed once; a cancelled (storniert) invoice frees it again
      const existing = tx
        .select({ invoiceNumber: schema.invoice.invoice_number })
        .from(schema.management_share)
        .innerJoin(schema.invoice, eq(schema.management_share.invoice_id, schema.invoice.id))
        .where(
          and(
            eq(schema.management_share.band_id, band.id),
            eq(schema.management_share.year, input.year),
            eq(schema.management_share.quarter, input.quarter),
            ne(schema.invoice.status, 'cancelled')
          )
        )
        .get()
      if (existing) {
        throw new Error(
          `Das ${label} ist bereits abgerechnet (${
            existing.invoiceNumber === null ? 'Entwurf' : `Rechnung Nr. ${existing.invoiceNumber}`
          })`
        )
      }

      const incomeTotal = roundMoney(input.income.reduce((sum, line) => sum + line.netAmount, 0))
      const amount = managementShareAmount(incomeTotal, contract.commission_percent)
      if (amount <= 0) throw new Error('Die Beteiligung beträgt 0,00 € – bitte Einnahmen erfassen')

      const period = quarterDates(input.year, input.quarter)
      const issueDate = input.issueDate ?? new Date().toISOString().slice(0, 10)
      const invoice = this.invoiceRepository.createTx(tx, {
        companyId: contract.management_company_id,
        recipientKind: 'company',
        recipientCompanyId: band.company_id,
        periodStartDate: period.start,
        periodEndDate: period.end,
        periodLabel: label,
        issueDate,
        dueDate: addDays(issueDate, contract.payment_days),
        status: 'draft',
        currency: 'EUR',
        lineItems: [
          {
            description: `Managementbeteiligung ${label}`,
            quantity: 1,
            unit: 'service',
            unitPriceNet: amount,
            taxRate: input.taxRate,
            taxCode: input.taxRate > 0 ? 'standard' : 'exempt'
          }
        ],
        totalAmount: 0,
        paymentTerms: `Zahlbar innerhalb von ${contract.payment_days} Tagen nach Rechnungsdatum`,
        reverseChargeNote: '',
        buyerReference: '',
        notes: ''
      })

      const share = tx
        .insert(schema.management_share)
        .values({
          invoice_id: invoice.id,
          band_id: band.id,
          management_contract_id: contract.id,
          year: input.year,
          quarter: input.quarter,
          commission_percent: contract.commission_percent
        })
        .returning({ id: schema.management_share.id })
        .get()
      input.income.forEach((line, index) => {
        tx.insert(schema.management_share_income)
          .values({
            share_id: share.id,
            position: index + 1,
            description: line.description,
            net_amount: line.netAmount
          })
          .run()
      })
      return share.id
    })

    return (await this.list({ shareId }))[0]
  }

  /** A band's billed quarters, newest quarter first */
  async listByBand(bandId: number): Promise<ManagementShareDto[]> {
    return this.list({ bandId })
  }

  private async list(filter: { bandId: number } | { shareId: number }) {
    const rows = await db
      .select({ share: schema.management_share, invoice: schema.invoice })
      .from(schema.management_share)
      .innerJoin(schema.invoice, eq(schema.management_share.invoice_id, schema.invoice.id))
      .where(
        'bandId' in filter
          ? eq(schema.management_share.band_id, filter.bandId)
          : eq(schema.management_share.id, filter.shareId)
      )
      .orderBy(
        desc(schema.management_share.year),
        desc(schema.management_share.quarter),
        desc(schema.management_share.id)
      )
    if (rows.length === 0) return []

    const incomeRows = await db
      .select()
      .from(schema.management_share_income)
      .where(
        inArray(
          schema.management_share_income.share_id,
          rows.map((row) => row.share.id)
        )
      )
      .orderBy(asc(schema.management_share_income.position))

    return rows.map(({ share, invoice }) => {
      const income = incomeRows
        .filter((line) => line.share_id === share.id)
        .map((line) => ({ description: line.description, netAmount: line.net_amount }))
      return {
        id: share.id,
        invoiceId: share.invoice_id,
        bandId: share.band_id,
        managementContractId: share.management_contract_id,
        year: share.year,
        quarter: share.quarter,
        commissionPercent: share.commission_percent,
        income,
        incomeTotal: roundMoney(income.reduce((sum, line) => sum + line.netAmount, 0)),
        netAmount: invoice.subtotal_net_amount,
        invoiceNumber: invoice.invoice_number,
        invoiceStatus: invoice.status,
        createdAt: share.created_at
      }
    })
  }
}
