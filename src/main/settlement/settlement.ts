// Concert settlement (Konzertabrechnung, #228): what the promoter owes the band for one show, the
// way the agencies' settlement sheet computes it, and the management fee billed from it. Pure:
// the event's settlement tab shows the same numbers live that are stored. Amounts are integer
// cents; rounding goes through einvoice/amounts.ts only.
//
// Tickets: per ticket system and price category, sold × (price + per-ticket extras) is the
// gross revenue; net = gross / (1 + ticket VAT). The deal is a guarantee and up to four door
// split tiers on the net revenue ("50 % ab 0 €"), either VERSUS (the higher of the two) or PLUS
// (both). The Werbekostenzuschuss (WKZ) is an amount per ticket sold, reimbursed costs
// (Übernachtung, Technik, Promo) are flat net amounts, the support fee usually goes to the
// support band directly. Each position takes its own VAT and its advances.
//
// The management fee is taken on the gage only - never on WKZ or reimbursed costs: gage net,
// less the booking agency's commission, times the management commission, plus VAT.
//
// A settlement from abroad comes in its own currency (a tour in England in GBP): every amount of
// the input is in that currency, and the management fee, always billed in euros, is taken on
// the gage converted at the rate the user enters (gageInEuroCents).

import { convertCents, fromCents, toCents, vatCents } from '../einvoice/amounts'

export interface SettlementTicketLine {
  /** "CTS EVENTIM", "Abendkasse" */
  system: string
  /** "Online", "VVK Stelle", "Regulär", "reduziert" */
  category: string
  /** Gross price per ticket */
  priceCents: number
  /** Refundierung, Ausgleichs- and Zusatzgebühren per ticket, gross */
  extraCents: number
  sold: number
  /** Werbekostenzuschuss per ticket sold, gross */
  wkzCents: number
}

export interface SettlementTier {
  /** Share of the net ticket revenue, in percent */
  percent: number
  /** From this net ticket revenue on */
  fromCents: number
}

export interface SettlementCost {
  label: string
  netCents: number
}

export type SettlementDealMode = 'versus' | 'plus'

export interface SettlementInput {
  lines: SettlementTicketLine[]
  /** VAT in the ticket prices and the WKZ, percent (7 for concerts in Germany) */
  ticketVatRate: number
  guaranteeCents: number
  dealMode: SettlementDealMode
  tiers: SettlementTier[]
  /** VAT on the gage, percent */
  gageVatRate: number
  costs: SettlementCost[]
  /** VAT on the reimbursed costs, percent */
  costsVatRate: number
  supportFeeCents: number
  supportVatRate: number
  advances: { gageCents: number; wkzCents: number; costsCents: number; supportCents: number }
  /** ISO 4217 code of every amount above; 'EUR' for a settlement in euros */
  currency: string
  /** Euros for one unit of `currency` (1.17 for GBP), null until entered; unused for EUR */
  eurRate: number | null
  /** ISO date the rate is from (the payment or the ECB reference rate), '' for none */
  eurRateDate: string
}

export interface SettlementPosition {
  netCents: number
  advanceCents: number
  /** Net less advances */
  openNetCents: number
  vatCents: number
  openGrossCents: number
}

export interface SettlementResult {
  sold: number
  ticketGrossCents: number
  ticketNetCents: number
  /** What each tier earned, in tier order */
  tierCents: number[]
  /** Gage net: guarantee vs. or plus the door split */
  gageCents: number
  /** Which side won a versus deal */
  gageFrom: 'guarantee' | 'split'
  wkzGrossCents: number
  wkzNetCents: number
  gage: SettlementPosition
  wkz: SettlementPosition
  costs: SettlementPosition
  support: SettlementPosition
  /** Gage, WKZ and costs; the support fee is billed apart */
  totalOpenNetCents: number
  totalOpenGrossCents: number
}

// The sheet keeps every intermediate value unrounded (net = gross / 1,07, the split, the VAT) and
// rounds only what it shows; so does this module, so the cents match the promoter's invoice
// (4.517,00 €, not 4.517,01 €). `Exact` values are euros as floating point numbers.

type ExactPosition = { net: number; advance: number; rate: number }

function position({ net, advance, rate }: ExactPosition): SettlementPosition {
  const openNet = net - advance
  const netCents = toCents(net)
  const openNetCents = toCents(openNet)
  const openGrossCents = toCents(openNet * (1 + rate / 100))
  return {
    netCents,
    advanceCents: toCents(advance),
    openNetCents,
    vatCents: openGrossCents - openNetCents,
    openGrossCents
  }
}

/** A tier's share in euros, unrounded (the sheet's formula) */
function tierExact(net: number, tier: SettlementTier, nextFromCents: number): number {
  const from = fromCents(tier.fromCents)
  const next = fromCents(nextFromCents)
  if (tier.percent <= 0 || net <= from) return 0
  const upTo = next > from && net > next ? next : net
  return ((upTo - from) * tier.percent) / 100
}

/**
 * What one tier earns: its percent of the net revenue above its threshold, up to the next
 * tier's threshold when that one is set and reached
 */
export function tierAmount(netCents: number, tier: SettlementTier, nextFromCents: number): number {
  return toCents(tierExact(fromCents(netCents), tier, nextFromCents))
}

export function computeSettlement(input: SettlementInput): SettlementResult {
  const sold = input.lines.reduce((sum, line) => sum + line.sold, 0)
  const ticketGrossCents = input.lines.reduce(
    (sum, line) => sum + line.sold * (line.priceCents + line.extraCents),
    0
  )
  const ticketNet = fromCents(ticketGrossCents) / (1 + input.ticketVatRate / 100)
  const tiers = input.tiers.map((tier, index) =>
    tierExact(ticketNet, tier, input.tiers[index + 1]?.fromCents ?? 0)
  )
  const split = tiers.reduce((sum, value) => sum + value, 0)
  const guarantee = fromCents(input.guaranteeCents)
  const versusSplitWins = split > guarantee
  const gage = input.dealMode === 'plus' ? guarantee + split : versusSplitWins ? split : guarantee
  const wkzGrossCents = input.lines.reduce((sum, line) => sum + line.sold * line.wkzCents, 0)
  const wkzNet = fromCents(wkzGrossCents) / (1 + input.ticketVatRate / 100)
  const costsNet = fromCents(input.costs.reduce((sum, cost) => sum + cost.netCents, 0))
  const advances = input.advances

  const exact = {
    gage: { net: gage, advance: fromCents(advances.gageCents), rate: input.gageVatRate },
    wkz: { net: wkzNet, advance: fromCents(advances.wkzCents), rate: input.ticketVatRate },
    costs: { net: costsNet, advance: fromCents(advances.costsCents), rate: input.costsVatRate },
    support: {
      net: fromCents(input.supportFeeCents),
      advance: fromCents(advances.supportCents),
      rate: input.supportVatRate
    }
  }
  const billed = [exact.gage, exact.wkz, exact.costs]
  return {
    sold,
    ticketGrossCents,
    ticketNetCents: toCents(ticketNet),
    tierCents: tiers.map((value) => toCents(value)),
    gageCents: toCents(gage),
    gageFrom: input.dealMode === 'versus' && !versusSplitWins ? 'guarantee' : 'split',
    wkzGrossCents,
    wkzNetCents: toCents(wkzNet),
    gage: position(exact.gage),
    wkz: position(exact.wkz),
    costs: position(exact.costs),
    support: position(exact.support),
    totalOpenNetCents: toCents(billed.reduce((sum, p) => sum + p.net - p.advance, 0)),
    totalOpenGrossCents: toCents(
      billed.reduce((sum, p) => sum + (p.net - p.advance) * (1 + p.rate / 100), 0)
    )
  }
}

export interface ManagementFee {
  /** Gage net, the base */
  baseCents: number
  agencyCents: number
  /** Gage net after the agency's commission */
  afterAgencyCents: number
  netCents: number
  vatCents: number
  grossCents: number
}

/**
 * The management fee of one show: (gage net − agency %) × commission %, plus VAT. Only the gage
 * counts, never WKZ or reimbursed costs (640,51 € gross for a gage of 4.221,50 € at 15 % / 15 %).
 */
export function managementFee(
  gageNetCents: number,
  agencyPercent: number,
  commissionPercent: number,
  vatRate: number
): ManagementFee {
  const afterAgency = (fromCents(gageNetCents) * (100 - agencyPercent)) / 100
  const net = toCents((afterAgency * commissionPercent) / 100)
  const vat = vatCents(net, vatRate)
  const afterAgencyCents = toCents(afterAgency)
  return {
    baseCents: gageNetCents,
    agencyCents: gageNetCents - afterAgencyCents,
    afterAgencyCents,
    netCents: net,
    vatCents: vat,
    grossCents: net + vat
  }
}

export const EMPTY_SETTLEMENT: SettlementInput = {
  lines: [],
  ticketVatRate: 7,
  guaranteeCents: 0,
  dealMode: 'versus',
  tiers: [{ percent: 0, fromCents: 0 }],
  gageVatRate: 7,
  costs: [],
  costsVatRate: 19,
  supportFeeCents: 0,
  supportVatRate: 7,
  advances: { gageCents: 0, wkzCents: 0, costsCents: 0, supportCents: 0 },
  currency: 'EUR',
  eurRate: null,
  eurRateDate: ''
}

/** Whether the settlement is in a currency other than euros */
export function isForeignCurrency(input: Pick<SettlementInput, 'currency'>): boolean {
  return input.currency !== 'EUR'
}

/**
 * The gage net in euro cents, the base of the management fee: as it is for a settlement in
 * euros, converted at the entered rate otherwise; null while the rate of a foreign currency is
 * missing.
 */
export function gageInEuroCents(
  gageCents: number,
  input: Pick<SettlementInput, 'currency' | 'eurRate'>
): number | null {
  if (!isForeignCurrency(input)) return gageCents
  return input.eurRate !== null && input.eurRate > 0 ? convertCents(gageCents, input.eurRate) : null
}
