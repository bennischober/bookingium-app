// Amounts typed into the management share dialog (German and point decimals)
import { describe, it, expect } from 'vitest'
import { parseAmount } from '../src/renderer/src/lib/invoiceLabels'

describe('parseAmount', () => {
  it('reads German amounts with thousands dots and a decimal comma', () => {
    expect(parseAmount('34.217,60')).toBe(34217.6)
    expect(parseAmount('34217,6')).toBe(34217.6)
    expect(parseAmount('1.000')).toBe(1000)
    expect(parseAmount('1.234.567')).toBe(1234567)
    expect(parseAmount(' 80.000,00 € ')).toBe(80000)
  })

  it('reads point decimals and plain numbers', () => {
    expect(parseAmount('34217.60')).toBe(34217.6)
    expect(parseAmount('12.5')).toBe(12.5)
    expect(parseAmount('500')).toBe(500)
  })

  it('rejects empty and malformed input', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('1,2,3')).toBeNull()
    expect(parseAmount('12,')).toBeNull()
  })
})
