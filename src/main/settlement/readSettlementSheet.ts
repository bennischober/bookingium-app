// The promoter's settlement sheet (#228): the booking agencies' "KONZERTABRECHNUNG" template, its
// first sheet as the list import reads it (import/xlsx.ts). Rows are found by their label in
// column A, not by number, so a template with a row more or less still reads; values sit in the
// columns B-I (one per ticket line) or in J (totals). Pure.

import { toCents } from '../einvoice/amounts'
import { cleanText, normalizeKey } from '../import/normalize'
import { parseShowDate } from '../import/agencyBookings'
import { EMPTY_SETTLEMENT, type SettlementInput, type SettlementTicketLine } from './settlement'

export interface SettlementSheet {
  input: SettlementInput
  artist: string
  /** ISO date or '' */
  date: string
  city: string
  venue: string
  promoter: string
  /** What the sheet itself shows, to check the computation against */
  sheet: {
    gageNetCents: number | null
    totalNetCents: number | null
    totalGrossCents: number | null
  }
}

const TICKET_COLUMNS = [1, 2, 3, 4, 5, 6, 7, 8]
const TOTAL_COLUMN = 9

/** "4221,495327103", "0,07", "2000" (the import's number text) as a number; 0 for nothing */
function numberOf(raw: string | undefined): number {
  const text = cleanText(raw ?? '').replace(/\s|€/g, '')
  if (!text) return 0
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text
  const value = Number(normalized)
  return Number.isFinite(value) ? value : 0
}

/** A rate cell: 0,07 or 7 (%) as percent */
const percentOf = (raw: string | undefined): number => {
  const value = numberOf(raw)
  return value > 0 && value < 1 ? Math.round(value * 10000) / 100 : value
}

/** Reads the sheet; null when it is not the settlement template */
export function readSettlementSheet(records: string[][]): SettlementSheet | null {
  const rows = records.map((record) => record.map((cell) => cleanText(cell ?? '')))
  const keyOf = (row: string[] | undefined): string => normalizeKey(row?.[0] ?? '')
  const indexOf = (label: string, from = 0): number => {
    const key = normalizeKey(label)
    for (let index = from; index < rows.length; index++)
      if (keyOf(rows[index]) === key) return index
    return -1
  }
  const rowOf = (label: string, from = 0): string[] | undefined => rows[indexOf(label, from)]
  /** The "zzgl. MwSt." rate right after a row */
  const rateAfter = (label: string, fallback: number): number => {
    const at = indexOf(label)
    if (at < 0) return fallback
    const vat = indexOf('zzgl. MwSt.', at + 1)
    return vat > at && vat <= at + 2 ? percentOf(rows[vat][1]) || fallback : fallback
  }
  const total = (label: string, from = 0): number | null => {
    const row = rowOf(label, from)
    return row ? toCents(numberOf(row[TOTAL_COLUMN])) : null
  }
  /** "abzgl. Abschlagszahlungen" below a position of the Rechnungspositionen */
  const advanceAfter = (label: string, from: number): number => {
    const at = indexOf(label, from)
    if (at < 0) return 0
    const advance = indexOf('abzgl. Abschlagszahlungen', at + 1)
    return advance === at + 1 ? toCents(numberOf(rows[advance][TOTAL_COLUMN])) : 0
  }

  const systems = rowOf('Ticketsystem')
  const sold = rowOf('Verkäufe')
  const price = rowOf('Grundpreis')
  if (!systems || !sold || !price || !rows.some((row) => /konzertabrechnung/i.test(row[0] ?? ''))) {
    return null
  }
  const category = rowOf('Preiskategorie') ?? []
  const wkz = rowOf('Werbekostenzuschuss/Media') ?? rowOf('Werbekostenzuschuss Media') ?? []
  const extras = [
    'Refundierung',
    'Ausgleichsgebühr',
    'Zusatzgebühr 1',
    'Zusatzgebühr 2',
    'Zusatzgebühr 3'
  ].map((label) => rowOf(label) ?? [])

  const lines: SettlementTicketLine[] = TICKET_COLUMNS.map((column) => ({
    system: systems[column] ?? '',
    category: category[column] ?? '',
    priceCents: toCents(numberOf(price[column])),
    extraCents: toCents(extras.reduce((sum, row) => sum + numberOf(row[column]), 0)),
    sold: Math.round(numberOf(sold[column])),
    wkzCents: toCents(numberOf(wkz[column]))
  })).filter((line) => line.system || line.sold > 0)

  // "VS Deal: ja" → versus; "nein" → plus (guarantee plus the split from the break)
  const dealRow = rows.find((row) => row.some((cell) => normalizeKey(cell) === 'vs deal'))
  const versusCell = dealRow
    ? dealRow[dealRow.findIndex((c) => normalizeKey(c) === 'vs deal') + 2]
    : 'ja'
  const tiers = [
    'Einnahmebeteiligung',
    'Einnahmebeteiligung 2',
    'Einnahmebeteiligung 3',
    'Einnahmebeteiligung 4'
  ]
    .map((label) => rowOf(label))
    .filter((row): row is string[] => row !== undefined)
    .map((row) => ({ percent: percentOf(row[3]), fromCents: toCents(numberOf(row[5])) }))

  // Reimbursed costs: the rows between the WKZ gross and the costs' sum
  const costsFrom = indexOf('Werbekostenzuschuss Brutto')
  const costsTo = indexOf('Nebenkosten Summe Netto')
  const costs =
    costsFrom >= 0 && costsTo > costsFrom
      ? rows
          .slice(costsFrom + 1, costsTo)
          .filter((row) => row[0])
          .map((row) => ({ label: row[0], netCents: toCents(numberOf(row[TOTAL_COLUMN])) }))
          .filter((cost) => cost.netCents !== 0)
      : []

  const positions = Math.max(0, indexOf('Rechnungspositionen'))
  const support = rowOf('Supportfee Netto')
  const input: SettlementInput = {
    ...EMPTY_SETTLEMENT,
    lines,
    ticketVatRate: rateAfter('Werbekostenzuschuss Netto', 7),
    guaranteeCents: toCents(numberOf(rowOf('Garantie lt. Vereinbarung')?.[TOTAL_COLUMN])),
    dealMode: normalizeKey(versusCell ?? '') === 'nein' ? 'plus' : 'versus',
    tiers: tiers.length > 0 ? tiers : EMPTY_SETTLEMENT.tiers,
    gageVatRate: rateAfter('Summe Netto', 7),
    costs,
    costsVatRate: rateAfter('Nebenkosten Summe Netto', 19),
    supportFeeCents: toCents(numberOf(support?.[TOTAL_COLUMN])),
    supportVatRate: rateAfter('Supportfee Netto', 7),
    advances: {
      gageCents: advanceAfter('Gage/Beteiligung an den Ticketeinnahmen', positions),
      wkzCents: advanceAfter('Werbekostenzuschuss', positions),
      costsCents: advanceAfter('Nebenkosten', positions),
      supportCents: advanceAfter('Supportfee', positions)
    }
  }

  const field = (label: string, column: number): string => {
    const row = rows.find((r) => r.some((cell) => normalizeKey(cell) === normalizeKey(label)))
    if (!row) return ''
    const at = row.findIndex((cell) => normalizeKey(cell) === normalizeKey(label))
    return row[at + column] ?? ''
  }
  return {
    input,
    // The sheet's own labels, compared normalized (lower case)
    artist: field('künstler/artist:', 1),
    date: parseShowDate(field('Datum:', 1)),
    city: field('Stadt:', 1),
    venue: field('venue:', 1),
    promoter: field('Veranstalter:', 1),
    sheet: {
      gageNetCents: total('Summe Netto'),
      totalNetCents: total('Offener Gesamtbetrag Netto ohne Supportfee'),
      totalGrossCents: total('Offener Gesamtbetrag Brutto ohne Supportfee')
    }
  }
}
