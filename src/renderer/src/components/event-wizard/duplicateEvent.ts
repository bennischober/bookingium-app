// #199: a new date from an existing event. A tour is often the same band, deal and LoPro on many
// dates, so those come along; the date and the club / festival are asked for again, and nothing
// of the source event's own history is copied (contracts, invoices, deposits, documents, mails,
// follow-ups, hotel and travel). Pure, so the rule is unit tested.
import type { DealMemoDto } from '../../../../main/api/schemas/deal_memo.schema'
import type { WizardCarry, WizardPrefill } from './wizardState'

/** Money for the wizard's text fields: 12.5 -> "12.5", none -> "" */
const amount = (value: number | null): string => (value === null ? '' : String(value))

/** What the event wizard opens with to duplicate `source` */
export function duplicateOf(source: DealMemoDto): {
  prefill: WizardPrefill
  carry: WizardCarry
} {
  return {
    prefill: {
      // date and club / festival stay as the wizard opens (empty, or a date it was opened with)
      name: source.name,
      bandId: source.bandId,
      loProPersonId: source.loProPersonId,
      loProCompanyId: source.loProCompanyId,
      deal: source.deal,
      // a new date is not confirmed yet
      status: 'pending',
      ticketPriceVvk: amount(source.ticketPriceVvk),
      ticketPriceAk: amount(source.ticketPriceAk),
      notes: source.notes
    },
    carry: {
      invoiceCompanyId: source.invoiceCompanyId,
      representingCompanyId: source.representingCompanyId,
      guaranteeAmount: source.guaranteeAmount,
      guaranteeVatRate: source.guaranteeVatRate,
      contractNotes: source.contractNotes,
      tour: source.tour
    }
  }
}
