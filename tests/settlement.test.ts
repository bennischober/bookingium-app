import { describe, expect, it } from 'vitest'
import {
  computeSettlement,
  EMPTY_SETTLEMENT,
  managementFee,
  tierAmount,
  type SettlementInput
} from '../src/main/settlement/settlement'
import { readSettlementSheet } from '../src/main/settlement/readSettlementSheet'

// The numbers of a real settlement (#228), with made-up names
const show: SettlementInput = {
  ...EMPTY_SETTLEMENT,
  lines: [
    {
      system: 'Ticketsystem A',
      category: 'Online',
      priceCents: 3000,
      extraCents: 0,
      sold: 210,
      wkzCents: 100
    },
    {
      system: 'Ticketsystem B',
      category: 'Regulär',
      priceCents: 3300,
      extraCents: 0,
      sold: 58,
      wkzCents: 100
    },
    {
      system: 'Zusatzgebühr',
      category: '',
      priceCents: 300,
      extraCents: 0,
      sold: 210,
      wkzCents: 0
    },
    {
      system: 'Abendkasse',
      category: 'Regulär',
      priceCents: 3800,
      extraCents: 0,
      sold: 5,
      wkzCents: 0
    }
  ],
  guaranteeCents: 200000,
  dealMode: 'versus',
  tiers: [{ percent: 50, fromCents: 0 }],
  costs: [{ label: 'Übernachtungspauschale', netCents: 70000 }]
}

describe('concert settlement', () => {
  it('computes tickets, the versus deal, WKZ and costs like the promoter sheet', () => {
    const result = computeSettlement(show)
    expect(result.sold).toBe(483)
    expect(result.ticketGrossCents).toBe(903400)
    expect(result.ticketNetCents).toBe(844299)
    expect(result.gageCents).toBe(422150)
    expect(result.gageFrom).toBe('split')
    expect(result.gage).toMatchObject({ vatCents: 29550, openGrossCents: 451700 })
    expect(result.wkzGrossCents).toBe(26800)
    expect(result.wkz).toMatchObject({ netCents: 25047, openGrossCents: 26800 })
    expect(result.costs).toMatchObject({ netCents: 70000, vatCents: 13300, openGrossCents: 83300 })
    expect(result.totalOpenNetCents).toBe(517196)
    expect(result.totalOpenGrossCents).toBe(561800)
  })

  it('takes the guarantee when the split stays below it, or both for a plus deal', () => {
    const small = { ...show, lines: show.lines.slice(3) } // 190 € at the door
    expect(computeSettlement(small)).toMatchObject({ gageCents: 200000, gageFrom: 'guarantee' })
    expect(computeSettlement({ ...small, dealMode: 'plus' }).gageCents).toBe(200000 + 8879)
  })

  it('splits tiers at the next threshold, as the sheet does', () => {
    expect(tierAmount(1_000_000, { percent: 50, fromCents: 0 }, 400_000)).toBe(200_000)
    expect(tierAmount(1_000_000, { percent: 70, fromCents: 400_000 }, 0)).toBe(420_000)
    expect(tierAmount(300_000, { percent: 70, fromCents: 400_000 }, 0)).toBe(0)
    // A next threshold not reached: the whole rest
    expect(tierAmount(300_000, { percent: 50, fromCents: 0 }, 400_000)).toBe(150_000)
  })

  it('subtracts advances per position before the VAT', () => {
    const result = computeSettlement({ ...show, advances: { ...show.advances, gageCents: 100000 } })
    expect(result.gage.openNetCents).toBe(322150)
    expect(result.gage.vatCents).toBe(22550)
  })
})

describe('management fee', () => {
  it('is taken on the gage only: 640,51 € for this show', () => {
    expect(managementFee(422150, 15, 15, 19)).toEqual({
      baseCents: 422150,
      agencyCents: 63322,
      afterAgencyCents: 358828,
      netCents: 53824,
      vatCents: 10227,
      grossCents: 64051
    })
  })
})

describe('the promoter settlement sheet', () => {
  // The template's rows as the import reads them (made-up show)
  const row = (label: string, ...cells: string[]): string[] => [label, ...cells]
  const at = (label: string, j: string): string[] => [label, '', '', '', '', '', '', '', '', j]
  const records: string[][] = [
    [],
    ['KONZERTABRECHNUNG', '', '', '', '', 'Stand', '16.11.2026'],
    row('Künstler/Artist:', 'Beispielband', '', '', '', 'Veranstalter:', 'Beispiel Konzerte GmbH'),
    row('Datum:', '13.11.2026'),
    row('Stadt:', 'Musterstadt'),
    row('Venue:', 'Halle Probe'),
    row('Ticketsystem', 'System A', 'System B', '', '', '', 'Zusatzgebühr', 'Abendkasse'),
    row('Preiskategorie', 'Online', 'Regulär', '', '', '', '', 'Regulär'),
    row('Grundpreis', '30', '33', '', '', '', '3', '38'),
    row('Refundierung'),
    row('Verkäufe', '210', '58', '', '', '', '210', '5', '', '483'),
    row('Werbekostenzuschuss/Media', '1', '1', '0', '0', '0', '0', '0', '0'),
    ['', '', '', 'VS Deal:', '', 'ja', '', 'plus % ab Break:', '', 'nein'],
    at('Garantie lt. Vereinbarung', '2000'),
    row(
      'Einnahmebeteiligung',
      '',
      '',
      '0,5',
      'ab',
      '0',
      '',
      'Nettoeinnahmen',
      '',
      '4221,495327103'
    ),
    row('Einnahmebeteiligung 2', '', '', '0', 'ab', '0'),
    at('Summe Netto', '4221,495327103'),
    row('zzgl. MwSt.', '0,07'),
    at('Werbekostenzuschuss Netto', '250,46728972'),
    row('zzgl. MwSt.', '0,07'),
    at('Werbekostenzuschuss Brutto', '268'),
    at('Übernachtungspauschale', '700'),
    at('Technikpauschale', '0'),
    at('Nebenkosten Summe Netto', '700'),
    row('zzgl. MwSt.', '0,19'),
    at('Supportfee Netto', '0'),
    row('Rechnungspositionen'),
    at('Gage/Beteiligung an den Ticketeinnahmen', '4221,495327103'),
    at('abzgl. Abschlagszahlungen', '500'),
    at('Offener Gesamtbetrag Netto ohne Supportfee', '4671,96'),
    at('Offener Gesamtbetrag Brutto ohne Supportfee', '5083')
  ]

  it('reads lines, deal, costs, rates and advances by their labels', () => {
    const sheet = readSettlementSheet(records)!
    expect(sheet).toMatchObject({
      artist: 'Beispielband',
      date: '2026-11-13',
      city: 'Musterstadt',
      venue: 'Halle Probe',
      promoter: 'Beispiel Konzerte GmbH'
    })
    expect(sheet.input).toMatchObject({
      guaranteeCents: 200000,
      dealMode: 'versus',
      gageVatRate: 7,
      costsVatRate: 19,
      costs: [{ label: 'Übernachtungspauschale', netCents: 70000 }],
      advances: { gageCents: 50000, wkzCents: 0, costsCents: 0, supportCents: 0 }
    })
    expect(sheet.input.tiers[0]).toEqual({ percent: 50, fromCents: 0 })
    expect(sheet.input.lines.map((l) => [l.system, l.sold, l.wkzCents])).toEqual([
      ['System A', 210, 100],
      ['System B', 58, 100],
      ['Zusatzgebühr', 210, 0],
      ['Abendkasse', 5, 0]
    ])
    const result = computeSettlement(sheet.input)
    expect(result.gageCents).toBe(sheet.sheet.gageNetCents)
    expect(result.totalOpenNetCents).toBe(sheet.sheet.totalNetCents)
  })

  it('is null for any other sheet', () => {
    expect(
      readSettlementSheet([
        ['Datum', 'Band'],
        ['01.05.2027', 'X']
      ])
    ).toBeNull()
  })
})
