// The service is the one place that sees BOTH address sources, so this pins the seam the router uses.
//
// The mail core is dependency-free and cannot read the app database; the repository cannot reach the
// mail store. The service takes the mail store's answer as an argument and merges it with the app's own
// records - which is what makes a person you have never mailed appear in the compose dropdown.
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { RecipientLookupService } from '../src/main/services/RecipientLookupService'
import type { RecipientCandidate } from '../src/main/mail/recipientLookup'

/** A repository stand-in: the real one reads the app DB, which this test does not need */
function service(appRecords: RecipientCandidate[]): RecipientLookupService {
  const repo = { loadCandidates: () => appRecords }
  return new RecipientLookupService(repo as never)
}

describe('recipient lookup service: both sources, one list', () => {
  it('finds an app record that was never mailed', () => {
    // the reported case: in the address book, no mail history at all
    const lookup = service([{ name: 'Benjamin Schober', email: 'b@bmm-ag.de', source: 'person' }])
    const found = lookup.lookup('schober', [])
    expect(found.map((r) => r.email)).toEqual(['b@bmm-ag.de'])
  })

  it('keeps the mail-store hits when the app has none', () => {
    const lookup = service([])
    const found = lookup.lookup('alt', [{ name: 'Alt Kunde', email: 'alt@example.test' }])
    expect(found.map((r) => r.email)).toEqual(['alt@example.test'])
    expect(found[0].source).toBe('mail')
  })

  it('merges both and prefers the app record for the same address', () => {
    const lookup = service([{ name: 'Benjamin Schober', email: 'b@bmm-ag.de', source: 'person' }])
    const found = lookup.lookup('schober', [{ name: 'B. Schober', email: 'b@bmm-ag.de' }])
    expect(found).toHaveLength(1)
    expect(found[0].source).toBe('person')
  })

  it('answers nothing below two characters', () => {
    // the dropdown only opens from two characters; one must not dump the address book
    const lookup = service([{ name: 'Benjamin', email: 'b@example.test', source: 'person' }])
    expect(lookup.lookup('b', [])).toEqual([])
    expect(lookup.lookup('  ', [])).toEqual([])
  })
})
