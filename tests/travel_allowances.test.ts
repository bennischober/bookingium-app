import { describe, expect, it } from 'vitest'
import {
  DOMESTIC_RATES,
  mileageCents,
  tripAllowances,
  tripDays,
  tripTimesError,
  type TripInput
} from '../src/main/travel/allowances'

const trip = (overrides: Partial<TripInput> = {}): TripInput => ({
  startAt: '2026-11-03T07:00',
  endAt: '2026-11-03T18:00',
  overnight: true,
  rates: DOMESTIC_RATES,
  meals: {},
  kilometres: 0,
  vehicle: 'car',
  ...overrides
})

describe('travel allowances (§ 9 Abs. 4a EStG)', () => {
  it('pays 14 € for a day trip of more than 8 hours, nothing for 8 hours or less', () => {
    expect(tripAllowances(trip()).allowancesCents).toBe(1400)
    expect(tripAllowances(trip({ endAt: '2026-11-03T15:00' })).allowancesCents).toBe(0)
    expect(tripAllowances(trip({ endAt: '2026-11-03T15:01' })).allowancesCents).toBe(1400)
  })

  it('pays 14 € on arrival and departure day and 28 € for each full day in between', () => {
    const result = tripAllowances(trip({ endAt: '2026-11-06T10:00' }))
    expect(result.days.map((d) => [d.kind, d.allowanceCents])).toEqual([
      ['arrival', 1400],
      ['full', 2800],
      ['full', 2800],
      ['departure', 1400]
    ])
    expect(result.allowancesCents).toBe(8400)
  })

  it('pays arrival and departure day of an overnight trip regardless of hours', () => {
    const result = tripAllowances(trip({ startAt: '2026-11-03T22:00', endAt: '2026-11-04T06:00' }))
    expect(result.allowancesCents).toBe(2800)
  })

  it('pays one allowance for a trip over midnight without an overnight stay', () => {
    const over8 = tripAllowances(
      trip({ startAt: '2026-11-03T17:00', endAt: '2026-11-04T03:00', overnight: false })
    )
    expect(over8.days.map((d) => d.allowanceCents)).toEqual([1400, 0])
    const short = tripAllowances(
      trip({ startAt: '2026-11-03T20:00', endAt: '2026-11-04T03:30', overnight: false })
    )
    expect(short.allowancesCents).toBe(0)
  })

  it('deducts provided meals from the full-day rate, never below zero', () => {
    const result = tripAllowances(
      trip({
        endAt: '2026-11-05T12:00',
        meals: {
          '2026-11-04': { breakfast: true, lunch: false, dinner: true },
          '2026-11-05': { breakfast: true, lunch: true, dinner: false }
        }
      })
    )
    // 28 - 5,60 - 11,20 = 11,20; 14 - 5,60 - 11,20 → 0
    expect(result.days.map((d) => d.netCents)).toEqual([1400, 1120, 0])
    expect(result.days[2].deductionCents).toBe(1400)
  })

  it('uses the rates of a country abroad as entered', () => {
    const result = tripAllowances(
      trip({
        endAt: '2026-11-04T20:00',
        rates: { partialCents: 3200, fullCents: 4800 },
        meals: { '2026-11-04': { breakfast: true, lunch: false, dinner: false } }
      })
    )
    // 32 + (32 - 20 % of 48 = 9,60)
    expect(result.allowancesCents).toBe(3200 + 3200 - 960)
  })

  it('pays 0,30 € per km by car and 0,20 € by other motor vehicle', () => {
    expect(mileageCents(250, 'car')).toBe(7500)
    expect(mileageCents(250, 'other')).toBe(5000)
    expect(mileageCents(-5, 'car')).toBe(0)
    expect(tripAllowances(trip({ kilometres: 100 })).mileageCents).toBe(3000)
  })

  it('splits the hours by calendar day and refuses impossible times', () => {
    expect(tripDays('2026-11-03T20:00', '2026-11-04T06:30')).toEqual([
      { date: '2026-11-03', hours: 4 },
      { date: '2026-11-04', hours: 6.5 }
    ])
    expect(tripTimesError('2026-11-03T10:00', '2026-11-03T09:00')).toMatch(/nach dem Beginn/)
    expect(tripTimesError('', '2026-11-03T09:00')).toMatch(/Beginn und Ende/)
    expect(tripAllowances(trip({ endAt: '2026-11-02T10:00' })).days).toEqual([])
  })
})
