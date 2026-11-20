import { describe, expect, it } from 'vitest'
import {
  computeSettlement,
  EMPTY_SETTLEMENT,
  gageInEuroCents,
  isForeignCurrency,
  managementFee,
  tierAmount,
  type SettlementInput
} from '../src/main/settlement/settlement'
import { readSettlementSheet } from '../src/main/settlement/readSettlementSheet'
import { SettlementInputSchema } from '../src/main/api/schemas/settlement.schema'
import { SETTLEMENT_RECORDS as records } from './helpers/settlementSheet'

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

  it('reads a sheet in euros as EUR', () => {
    expect(readSettlementSheet(records)!.input).toMatchObject({
      currency: 'EUR',
      eurRate: null,
      eurRateDate: ''
    })
  })

  it('takes the currency a sheet names and reads its amounts with the sign (a tour in England)', () => {
    const pounds = records.map((record) =>
      record[0] === 'Garantie lt. Vereinbarung' ? [...record.slice(0, 9), '£ 2.000,00'] : record
    )
    const sheet = readSettlementSheet(pounds)!
    expect(sheet.input.currency).toBe('GBP')
    expect(sheet.input.guaranteeCents).toBe(200000)
  })
})

describe('a settlement in a foreign currency', () => {
  it('converts the gage to euros at the entered rate, rounded once', () => {
    const gbp = { currency: 'GBP', eurRate: 1.17 }
    expect(gageInEuroCents(422150, gbp)).toBe(493916)
    expect(gageInEuroCents(422150, { currency: 'EUR', eurRate: null })).toBe(422150)
    // A foreign currency without a rate has no euro amount yet
    expect(gageInEuroCents(422150, { currency: 'GBP', eurRate: null })).toBeNull()
    expect(isForeignCurrency(gbp)).toBe(true)
  })

  it('reads a settlement stored before currencies as EUR', () => {
    const stored = JSON.parse(JSON.stringify(show)) as Record<string, unknown>
    delete stored.currency
    delete stored.eurRate
    delete stored.eurRateDate
    expect(SettlementInputSchema.parse(stored)).toMatchObject({
      currency: 'EUR',
      eurRate: null,
      eurRateDate: ''
    })
  })

  it('refuses a currency that is no ISO code and a rate that is not positive', () => {
    expect(SettlementInputSchema.safeParse({ ...show, currency: 'Pfund' }).success).toBe(false)
    expect(SettlementInputSchema.safeParse({ ...show, currency: 'gbp' }).data?.currency).toBe('GBP')
    expect(SettlementInputSchema.safeParse({ ...show, eurRate: 0 }).success).toBe(false)
  })
})
