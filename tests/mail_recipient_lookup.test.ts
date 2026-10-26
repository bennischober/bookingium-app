// Recipient lookup when composing: the app's own records must be findable by name.
//
// The mail store only knows addresses from message headers, so a person you have on file but never
// mailed is invisible to the old lookup - the exact case this feature is for. The merge, the name matching
// and the ranking are pure, so they are tested here without Electron or a database.
import { describe, expect, it } from 'vitest'
import {
  fold,
  isUsableAddress,
  matchesQuery,
  mergeRecipients,
  type RecipientCandidate
} from '../src/main/mail/recipientLookup'

const person = (name: string, email: string): RecipientCandidate => ({
  name,
  email,
  source: 'person'
})
const company = (name: string, email: string): RecipientCandidate => ({
  name,
  email,
  source: 'company'
})
const fromMail = (name: string, email: string): RecipientCandidate => ({
  name,
  email,
  source: 'mail'
})

describe('recipient lookup: finding a person by name', () => {
  it('finds a person by last name only', () => {
    // the reported case: you know the name, not the address
    const found = mergeRecipients([person('Benjamin Schober', 'benjamin@bmm-ag.de')], 'schober')
    expect(found.map((r) => r.email)).toEqual(['benjamin@bmm-ag.de'])
  })

  it('finds a person by first name only', () => {
    const found = mergeRecipients([person('Benjamin Schober', 'benjamin@bmm-ag.de')], 'benjamin')
    expect(found).toHaveLength(1)
  })

  it('does not care about the word order', () => {
    // "Schober Benjamin" must find "Benjamin Schober"
    const found = mergeRecipients(
      [person('Benjamin Schober', 'benjamin@bmm-ag.de')],
      'schober benjamin'
    )
    expect(found).toHaveLength(1)
  })

  it('finds an accented name typed without the accent', () => {
    // nobody types the umlaut when searching
    const found = mergeRecipients([person('Jörg Müller', 'joerg@example.test')], 'jorg muller')
    expect(found).toHaveLength(1)
  })

  it('finds a name typed WITH the accent', () => {
    const found = mergeRecipients([person('Jörg Müller', 'joerg@example.test')], 'jörg')
    expect(found).toHaveLength(1)
  })

  it('finds a partial address', () => {
    // "part of the receiver's email" from the request
    const found = mergeRecipients([person('Benjamin Schober', 'benjamin@bmm-ag.de')], 'bmm-ag')
    expect(found).toHaveLength(1)
  })

  it('rejects a query whose tokens do not all match', () => {
    // "schober zzz" must not return Schober just because one token matched
    const found = mergeRecipients([person('Benjamin Schober', 'benjamin@bmm-ag.de')], 'schober zzz')
    expect(found).toEqual([])
  })
})

describe('recipient lookup: companies and venues', () => {
  it('finds a company by name, which is how people address an agency', () => {
    const found = mergeRecipients(
      [company('Brainstorm Music Marketing AG', 'info@bmm-ag.de')],
      'brainstorm'
    )
    expect(found.map((r) => r.email)).toEqual(['info@bmm-ag.de'])
    expect(found[0].source).toBe('company')
  })

  it('finds a company by a short form in its address', () => {
    // "bmm" is what someone types; it only appears in the domain
    const found = mergeRecipients(
      [company('Brainstorm Music Marketing AG', 'info@bmm-ag.de')],
      'bmm'
    )
    expect(found).toHaveLength(1)
  })
})

describe('recipient lookup: ranking and deduplication', () => {
  it('prefers an address-book record over the same address seen in mail', () => {
    const found = mergeRecipients(
      [
        fromMail('B. Schober', 'benjamin@bmm-ag.de'),
        person('Benjamin Schober', 'benjamin@bmm-ag.de')
      ],
      'schober'
    )
    expect(found).toHaveLength(1)
    // the label must not say "from mail" for somebody who is in the address book
    expect(found[0].source).toBe('person')
    expect(found[0].name).toBe('Benjamin Schober')
  })

  it('deduplicates addresses case-insensitively', () => {
    const found = mergeRecipients(
      [person('A', 'Benjamin@BMM-AG.de'), fromMail('A', 'benjamin@bmm-ag.de')],
      'benjamin'
    )
    expect(found).toHaveLength(1)
  })

  it('puts a name-prefix match above a mere email match', () => {
    const found = mergeRecipients(
      [fromMail('X', 'schober@example.test'), person('Schober GmbH', 'info@example.test')],
      'schober'
    )
    expect(found[0].name).toBe('Schober GmbH')
  })

  it('respects the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => person(`Person ${i}`, `p${i}@example.test`))
    expect(mergeRecipients(many, 'person', 8)).toHaveLength(8)
  })
})

describe('recipient lookup: never suggest something unusable', () => {
  it('drops records without an address', () => {
    // plenty of records have an empty email column; they must not appear as blank rows
    const found = mergeRecipients(
      [person('Ohne Adresse', ''), person('Mit Adresse', 'a@b.de')],
      'adresse'
    )
    expect(found.map((r) => r.email)).toEqual(['a@b.de'])
  })

  it('drops a malformed address', () => {
    for (const bad of ['kein-at', 'a@b', '@b.de', 'a@.de', 'a b@c.de']) {
      expect(mergeRecipients([person('X', bad)], 'x')).toEqual([])
    }
  })

  it('returns nothing for an empty query', () => {
    // the dropdown only opens from two characters, and an empty query must not dump the address book
    expect(mergeRecipients([person('Benjamin Schober', 'b@example.test')], '')).toEqual([])
  })
})

describe('recipient lookup: the helpers', () => {
  it('folds accents and case', () => {
    expect(fold('Jörg')).toBe('jorg')
    expect(fold('  SCHOBER  ')).toBe('schober')
  })

  it('accepts real addresses and rejects broken ones', () => {
    expect(isUsableAddress('a@b.de')).toBe(true)
    expect(isUsableAddress('')).toBe(false)
    expect(isUsableAddress('   ')).toBe(false)
  })

  it('matches on a token that appears in the name or the address', () => {
    const c = person('Benjamin Schober', 'benjamin@bmm-ag.de')
    expect(matchesQuery(c, 'bmm')).toBe(true)
    expect(matchesQuery(c, 'schober')).toBe(true)
    expect(matchesQuery(c, 'nothing')).toBe(false)
  })
})
