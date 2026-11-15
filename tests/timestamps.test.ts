import { describe, expect, it } from 'vitest'
import { parseSqlTimestamp, sqlTimestamp } from '../src/main/db/timestamps'
import { formatLooseDate, formatShortDate, parseTimestamp } from '../src/renderer/src/lib/utils'

describe('database timestamps (#153)', () => {
  it('writes UTC without zone and milliseconds, like datetime("now")', () => {
    expect(sqlTimestamp(new Date('2026-10-01T23:30:05.678Z'))).toBe('2026-10-01 23:30:05')
  })

  it('reads a time without a zone as UTC, an ISO time as it says', () => {
    const at = Date.UTC(2026, 9, 1, 23, 30, 5)
    expect(parseSqlTimestamp('2026-10-01 23:30:05')).toBe(at)
    expect(parseSqlTimestamp('2026-10-01 23:30:05.000')).toBe(at)
    expect(parseSqlTimestamp('2026-10-01T23:30:05.000Z')).toBe(at)
    expect(parseSqlTimestamp('')).toBeNaN()
    expect(parseTimestamp('2026-10-01 23:30:05').getTime()).toBe(at)
  })

  it('keeps a plain date a date', () => {
    expect(formatShortDate('2026-06-11')).toBe('11.06.2026')
  })

  it('formats a free-text date only when it is a full date', () => {
    expect(formatLooseDate('2018-09-15')).toBe('15.09.2018')
    expect(formatLooseDate('1965')).toBe('1965')
    expect(formatLooseDate('')).toBe('')
  })
})
