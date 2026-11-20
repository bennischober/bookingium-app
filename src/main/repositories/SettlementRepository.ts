import { inject, injectable } from 'tsyringe'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { InvoiceRepository } from './InvoiceRepository'
import { fromCents } from '../einvoice/amounts'
import {
  computeSettlement,
  gageInEuroCents,
  isForeignCurrency,
  managementFee
} from '../settlement/settlement'
import { formatMoney } from '../invoice/money'
import { SettlementInputSchema } from '../api/schemas/settlement.schema'

// #228: a show's settlement (one per event) and the management fee invoice made from it

/** "13.11.2026" */
const germanDate = (iso: string): string => {
  const [year, month, day] = iso.split('-')
  return `${day}.${month}.${year}`
}

const euro = (cents: number): string =>
  `${fromCents(cents).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/** 1.17 → "1,17", 1.168234 → "1,168234" */
const rateText = (rate: number): string =>
  rate.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 6 })

@injectable()
export class SettlementRepository {
  constructor(@inject(InvoiceRepository) private invoiceRepository: InvoiceRepository) {}

  getByEvent(eventId: number) {
    return db
      .select()
      .from(schema.event_settlement)
      .where(eq(schema.event_settlement.deal_memo_id, eventId))
      .get()
  }

  /** The event with its band, for the fee */
  event(eventId: number) {
    return db
      .select({
        id: schema.deal_memo.id,
        date: schema.deal_memo.date,
        bandId: schema.deal_memo.band_id,
        city: schema.address.city,
        venueName: schema.venue.name
      })
      .from(schema.deal_memo)
      .leftJoin(schema.venue, eq(schema.venue.id, schema.deal_memo.venue_id))
      .leftJoin(schema.address, eq(schema.address.id, schema.venue.address_id))
      .where(eq(schema.deal_memo.id, eventId))
      .get()
  }

  /** The band's newest management contract with its management company's name */
  contractOfBand(bandId: number) {
    return db
      .select({
        id: schema.management_contract.id,
        managementCompanyId: schema.management_contract.management_company_id,
        managementCompanyName: schema.company.name,
        commissionPercent: schema.management_contract.commission_percent,
        agencyPercent: schema.management_contract.agency_percent,
        paymentDays: schema.management_contract.payment_days
      })
      .from(schema.management_contract)
      .leftJoin(
        schema.company,
        eq(schema.company.id, schema.management_contract.management_company_id)
      )
      .where(eq(schema.management_contract.band_id, bandId))
      .orderBy(desc(schema.management_contract.id))
      .get()
  }

  feeInvoice(invoiceId: number | null) {
    if (invoiceId === null) return null
    return (
      db
        .select({
          id: schema.invoice.id,
          invoiceNumber: schema.invoice.invoice_number,
          status: schema.invoice.status
        })
        .from(schema.invoice)
        .where(eq(schema.invoice.id, invoiceId))
        .get() ?? null
    )
  }

  save(eventId: number, input: SettlementInputSchema, sourceFileName: string): void {
    const data = JSON.stringify(input)
    const existing = this.getByEvent(eventId)
    if (existing) {
      db.update(schema.event_settlement)
        .set({
          data,
          source_file_name: sourceFileName || existing.source_file_name,
          updated_at: sql`datetime('now')`
        })
        .where(eq(schema.event_settlement.id, existing.id))
        .run()
      return
    }
    db.insert(schema.event_settlement)
      .values({ deal_memo_id: eventId, data, source_file_name: sourceFileName })
      .run()
  }

  /**
   * The management fee of the show as a DRAFT invoice from the management company to the band's
   * company: one line, gage net less the agency's commission times the contract's commission.
   * Refused while an earlier fee invoice of this settlement is not cancelled.
   */
  createFeeInvoice(eventId: number, vatRate = 19): number {
    return db.transaction((tx) => {
      const settlement = tx
        .select()
        .from(schema.event_settlement)
        .where(eq(schema.event_settlement.deal_memo_id, eventId))
        .get()
      if (!settlement) throw new Error('Für dieses Event ist keine Abrechnung gespeichert')
      if (settlement.fee_invoice_id !== null) {
        const earlier = tx
          .select({ status: schema.invoice.status, number: schema.invoice.invoice_number })
          .from(schema.invoice)
          .where(eq(schema.invoice.id, settlement.fee_invoice_id))
          .get()
        if (earlier && earlier.status !== 'cancelled') {
          throw new Error(
            `Die Managementbeteiligung ist schon erstellt (${
              earlier.number === null ? 'Entwurf' : `Rechnung Nr. ${earlier.number}`
            })`
          )
        }
      }
      const event = this.event(eventId)
      if (!event) throw new Error('Event nicht gefunden')
      const contract = this.contractOfBand(event.bandId)
      if (!contract) throw new Error('Die Band hat keinen Managementvertrag')
      if (!contract.managementCompanyId)
        throw new Error('Im Managementvertrag ist kein Management ausgewählt')
      const band = tx.select().from(schema.band).where(eq(schema.band.id, event.bandId)).get()
      if (!band?.company_id) throw new Error('Die Band hat keine Firma, an die die Rechnung geht')

      const input = SettlementInputSchema.parse(JSON.parse(settlement.data))
      const result = computeSettlement(input)
      // The fee is always billed in euros: a settlement in another currency needs its rate
      const gageEuroCents = gageInEuroCents(result.gageCents, input)
      if (gageEuroCents === null)
        throw new Error(
          `Die Abrechnung ist in ${input.currency}: Für die Managementbeteiligung fehlt der Umrechnungskurs in Euro`
        )
      const fee = managementFee(
        gageEuroCents,
        contract.agencyPercent,
        contract.commissionPercent,
        vatRate
      )
      if (fee.netCents <= 0) throw new Error('Die Beteiligung beträgt 0,00 € – die Gage fehlt')
      const show = [event.venueName, event.city].filter(Boolean).join(', ')
      // "Gage netto 3.600,00 £ zum Kurs 1,17 (13.11.2026) = 4.212,00 €"
      const base = isForeignCurrency(input)
        ? `${formatMoney(fromCents(result.gageCents), input.currency)} zum Kurs ${rateText(input.eurRate ?? 0)}` +
          `${input.eurRateDate ? ` (${germanDate(input.eurRateDate)})` : ''} = ${euro(fee.baseCents)}`
        : euro(fee.baseCents)
      const issueDate = new Date().toISOString().slice(0, 10)
      const due = new Date(Date.parse(`${issueDate}T00:00:00Z`) + contract.paymentDays * 86_400_000)
        .toISOString()
        .slice(0, 10)
      const invoice = this.invoiceRepository.createTx(tx, {
        companyId: contract.managementCompanyId,
        recipientKind: 'company',
        recipientCompanyId: band.company_id,
        dealMemoId: eventId,
        issueDate,
        dueDate: due,
        periodStartDate: event.date,
        periodEndDate: event.date,
        status: 'draft',
        currency: 'EUR',
        lineItems: [
          {
            description:
              `Managementbeteiligung Konzert ${show ? `${show} ` : ''}am ${germanDate(event.date)}: ` +
              `Gage netto ${base} abzgl. ${contract.agencyPercent} % Agentur = ` +
              `${euro(fee.afterAgencyCents)}, davon ${contract.commissionPercent} %`,
            quantity: 1,
            unit: 'service',
            unitPriceNet: fromCents(fee.netCents),
            taxRate: vatRate,
            taxCode: vatRate > 0 ? 'standard' : 'exempt'
          }
        ],
        totalAmount: 0,
        paymentTerms: `Zahlbar innerhalb von ${contract.paymentDays} Tagen nach Rechnungsdatum`,
        reverseChargeNote: '',
        buyerReference: '',
        xrechnung: false,
        notes: ''
      })
      tx.update(schema.event_settlement)
        .set({ fee_invoice_id: invoice.id, updated_at: sql`datetime('now')` })
        .where(and(eq(schema.event_settlement.id, settlement.id)))
        .run()
      return invoice.id
    })
  }
}
