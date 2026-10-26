// The one address guard the core and the UI share.
//
// Two jobs in one check, and the old regex only did the second badly:
//   - SHAPE: exactly one @, text on both sides, a domain with a dot and no empty label.
//     `a@b` and `a@.b.de` were accepted before and the server refused them at send time.
//   - SAFETY: no character that ends a header or starts another one. A newline in an address is
//     header injection.
//
// Deliberately permissive where it must be: IDN addresses are VALID. This is pinned because a
// "cleanup" that switched to zod's z.string().email() would silently break them - measured:
// zod rejects 'user@exämple.test'.
import { describe, expect, it } from 'vitest'
import { addressProblem, isValidEmail } from '../src/main/mailclient/core/address'

describe('address guard: ordinary addresses pass', () => {
  it('accepts what people actually type', () => {
    for (const ok of [
      'a@b.de',
      'max@teich-events.example.test',
      'first.last@example.test',
      'first.last+tag@example.test',
      "o'brien@example.test",
      'user@sub.domain.example.test',
      'no-reply@ionos.example.test'
    ]) {
      expect(isValidEmail(ok), ok).toBe(true)
      expect(addressProblem(ok), ok).toBeNull()
    }
  })

  it('accepts an IDN address, which zod would reject', () => {
    // a user with an umlaut domain must be able to send mail
    expect(isValidEmail('user@exämple.test')).toBe(true)
    expect(isValidEmail('üser@example.test')).toBe(true)
    expect(addressProblem('user@exämple.test')).toBeNull()
  })
})

describe('address guard: header injection is refused', () => {
  it('refuses a newline that would add a recipient', () => {
    // the attack: a@b.de CRLF Bcc: victim@example.test
    for (const bad of [
      'a@b.de\r\nBcc: victim@example.test',
      'a@b.de\nBcc: victim@example.test',
      'a@b.de\r',
      'a@b.de\t'
    ]) {
      expect(isValidEmail(bad), JSON.stringify(bad)).toBe(false)
    }
  })

  it('refuses every character that can end a header or start another', () => {
    for (const bad of [
      'a@b.de<x',
      'a@b.de>',
      'a@b.de"',
      'a@b.de,',
      'a@b.de;',
      'a@b.de(',
      'a@b.de)',
      'a@b.de\\',
      'a b@c.de',
      'a@b.de '
    ]) {
      expect(isValidEmail(bad), JSON.stringify(bad)).toBe(false)
    }
  })

  it('refuses a NUL and other control characters', () => {
    expect(isValidEmail('a@b.de\u0000')).toBe(false)
    expect(isValidEmail('a@b.de\u001f')).toBe(false)
    expect(isValidEmail('a@b.de\u007f')).toBe(false)
  })
})

describe('address guard: the shape', () => {
  it('refuses a domain without a dot', () => {
    // accepted before, then refused by the server at send time
    expect(isValidEmail('a@b')).toBe(false)
    expect(addressProblem('a@b')).toMatch(/Punkt/)
  })

  it('refuses an empty domain label', () => {
    expect(isValidEmail('a@.b.de')).toBe(false)
    expect(isValidEmail('a@b..de')).toBe(false)
    expect(isValidEmail('a@b.de.')).toBe(false)
  })

  it('refuses a label that starts or ends with a hyphen', () => {
    expect(isValidEmail('a@-b.de')).toBe(false)
    expect(isValidEmail('a@b-.de')).toBe(false)
  })

  it('refuses a missing local part or a second @', () => {
    expect(isValidEmail('@b.de')).toBe(false)
    expect(isValidEmail('a@b@c.de')).toBe(false)
    expect(isValidEmail('')).toBe(false)
  })
})

describe('address guard: the reason the UI shows', () => {
  it('names the problem in German, not just "invalid"', () => {
    // the compose field explains the reason while typing
    expect(addressProblem('')).toBe('Keine Adresse angegeben')
    expect(addressProblem('b.de')).toMatch(/@/)
    expect(addressProblem('a@b@c.de')).toMatch(/Mehr als ein/)
    expect(addressProblem('a@b')).toMatch(/Punkt/)
    expect(addressProblem('a@.b.de')).toMatch(/leeres Feld/)
    expect(addressProblem('a@b.de\r\nBcc: x@y.z')).toMatch(/unerlaubtes Zeichen/)
  })
})
