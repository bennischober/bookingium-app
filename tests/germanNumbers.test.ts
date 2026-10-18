// German number words used in contract wording ("drei (3) Jahren")
import { describe, it, expect } from 'vitest'
import { germanNumberWord, germanQuantity } from '../src/renderer/src/lib/germanNumbers'

describe('germanNumberWord', () => {
  it('spells 0-99, with "ein" in compounds', () => {
    expect(germanNumberWord(0)).toBe('null')
    expect(germanNumberWord(3)).toBe('drei')
    expect(germanNumberWord(12)).toBe('zwölf')
    expect(germanNumberWord(14)).toBe('vierzehn')
    expect(germanNumberWord(21)).toBe('einundzwanzig')
    expect(germanNumberWord(30)).toBe('dreißig')
    expect(germanNumberWord(99)).toBe('neunundneunzig')
  })

  it('falls back to digits outside 0-99', () => {
    expect(germanNumberWord(100)).toBe('100')
    expect(germanNumberWord(2.5)).toBe('2.5')
  })
})

describe('germanQuantity', () => {
  it('uses the given singular phrase for one, "word (n) unit" otherwise', () => {
    expect(germanQuantity(1, 'einem (1) Jahr', 'Jahren')).toBe('einem (1) Jahr')
    expect(germanQuantity(3, 'einem (1) Jahr', 'Jahren')).toBe('drei (3) Jahren')
    expect(germanQuantity(6, 'einen (1) Monat', 'Monate')).toBe('sechs (6) Monate')
  })
})
