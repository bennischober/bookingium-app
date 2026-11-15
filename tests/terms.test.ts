import { describe, expect, it } from 'vitest'
import { TERMS, capitalize } from '../src/main/api/terms'

// #105: the domain nouns and their case forms

describe('TERMS', () => {
  it('declines a masculine noun', () => {
    const t = TERMS.club
    expect([t.der, t.den, t.dem, t.des]).toEqual(['der Club', 'den Club', 'dem Club', 'des Clubs'])
    expect([t.ein, t.einen, t.einem, t.eines]).toEqual([
      'ein Club',
      'einen Club',
      'einem Club',
      'eines Clubs'
    ])
    expect([t.kein, t.keinen, t.Neuer, t.Neuen]).toEqual([
      'kein Club',
      'keinen Club',
      'Neuer Club',
      'Neuen Club'
    ])
  })

  it('declines a feminine noun', () => {
    const t = TERMS.company
    expect([t.der, t.den, t.dem, t.des]).toEqual([
      'die Firma',
      'die Firma',
      'der Firma',
      'der Firma'
    ])
    expect([t.ein, t.einen, t.einem, t.eines]).toEqual([
      'eine Firma',
      'eine Firma',
      'einer Firma',
      'einer Firma'
    ])
    expect([t.keinen, t.Neuer, t.Neuen]).toEqual(['keine Firma', 'Neue Firma', 'Neue Firma'])
  })

  it('declines a neuter noun', () => {
    const t = TERMS.festival
    expect([t.der, t.dem, t.des, t.einen]).toEqual([
      'das Festival',
      'dem Festival',
      'des Festivals',
      'ein Festival'
    ])
    expect([t.keinen, t.Neuer, t.Neuen]).toEqual([
      'kein Festival',
      'Neues Festival',
      'Neues Festival'
    ])
  })

  it('builds the dative plural', () => {
    expect(TERMS.band.pluralDative).toBe('Bands')
    expect(TERMS.company.pluralDative).toBe('Firmen')
    expect(TERMS.contactList.pluralDative).toBe('Verteilern')
    expect(TERMS.contract.pluralDative).toBe('Verträgen')
  })

  it('capitalizes an article form to start a sentence', () => {
    expect(capitalize(TERMS.club.der)).toBe('Der Club')
    expect(capitalize(TERMS.festival.der)).toBe('Das Festival')
  })
})
