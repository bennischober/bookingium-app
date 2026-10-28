// E2: no tracked file may contain real personal data. Scans the seed, the tests, the
// scripts and the example seed for e-mail addresses outside the reserved test domains and
// for IBANs other than the official test ones. Prints file:line and the rule, never the
// match itself.
//
// I17 (README tests 5): comment lines are scanned too, and phone numbers, BICs and street
// addresses are detected. Names are not: no pattern tells a real name from an invented one.
import { execSync } from 'child_process'
import fs from 'fs'
import { describe, expect, it } from 'vitest'

/** A reserved test domain, or any subdomain of one (jana@nachtfalter.example.test).
 *  The whole `.test` TLD is reserved by RFC 2606, so any name under it is safe. */
const isAllowedDomain = (domain: string): boolean =>
  domain === 'test' ||
  domain.endsWith('.test') ||
  [...ALLOWED_DOMAINS].some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))

/** Domains reserved for documentation/tests, plus the ones this repo invented */
const ALLOWED_DOMAINS = new Set([
  'example.test',
  'example.com',
  'example.org',
  'localhost',
  // Invented, never registered: the synthetic seed's own domains
  'bookingum.test',
  'bookingum.example'
])

/** Explicit, non-personal addresses that may appear in tracked files */
const ALLOWED_ADDRESSES = new Set(['noreply@anthropic.com'])

/** The only IBANs a tracked file may contain: the public test IBANs */
const ALLOWED_IBANS = new Set([
  'DE02120300000000202051',
  'DE89370400440532013000',
  // Published example IBANs from the ISO 13616 documentation (AT61 ... is the
  // Austrian sample, DE89 ... the German one)
  'AT611904300234573201'
])

const EMAIL = /[a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g

/**
 * I17: a German, Austrian or Swiss phone number, international (+49 ..., 0049 ...) or national
 * with a separator after the area code (030 1234567, 0171-...). A bare digit run is left alone:
 * ids, timestamps and sizes look the same.
 */
const PHONE =
  /(?<![\w+])(?:\+|00)(?:49|43|41)[ \-/]?\(?0?\)?[1-9]\d{1,4}(?:[ \-/]?\d{2,}){1,4}(?!\w)|(?<![\w.\-/])0[1-9]\d{1,4}[ /-]\d{3,}(?:[ -]\d{2,})*(?![\w.])/g

/**
 * I17: a BIC (ISO 9362) of a DACH or neighbouring bank. Many SQL keywords have the same shape,
 * so only a line that says BIC or SWIFT is checked.
 */
const BIC = /\b[A-Z]{4}(?:DE|AT|CH|LI|LU|NL|BE|FR|IT|ES)[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g
const BIC_CONTEXT = /bic|swift/i

/** I17: a street and house number, written out or with `str.`, a letter after the number allowed */
const STREET =
  /\b[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]*(?:straße|strasse|str\.|weg|gasse|platz|allee|ring|damm|ufer)\s+\d{1,4}\s?[a-z]?\b/g

/**
 * I17: an invented number shows it: a run of zeros, a counting run, one digit four times, or
 * an ending of at most two different digits (+49 30 1234567, 0171 0000000).
 */
function isPlaceholderPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '')
  if (/0000|1234|2345|3456|4567|5678|6789|9876|(\d)\1\1\1/.test(digits)) return true
  return new Set(digits.slice(-6)).size <= 2
}

/** I17: a '0' as the second character of the location code marks a test BIC (ISO 9362) */
const isTestBic = (bic: string): boolean => bic[7] === '0'

/** I17: an obviously invented street (Musterstraße 1, Beispielweg 2) */
const isPlaceholderStreet = (street: string): boolean => /muster|beispiel/i.test(street)

/**
 * I17: the phone numbers, BICs and street addresses the fixtures held when these rules came in,
 * counted per file. They were not printed to tell invented from real (that is the rule), so a
 * person checks them by file and line; until then a file may hold this many and no more. A
 * count, not the values: a hash of a phone number is easy to reverse.
 */
const KNOWN_FIXTURES: Record<string, Partial<Record<Rule, number>>> = {
  'src/main/db/seed.ts': { phone: 4, bic: 1 },
  'tests/import.test.ts': { phone: 1, street: 1 },
  'tests/payment_qr.test.ts': { phone: 2, bic: 2 },
  'tests/helpers/einvoiceFixtures.ts': { bic: 1 },
  'tests/calendar.test.ts': { street: 2 },
  'tests/einvoice.test.ts': { street: 1 },
  'tests/import_targets.test.ts': { street: 3 }
}
/** 2 letters + 2 check digits + 11..30 alphanumerics (ISO 13616) */
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}[ ]?[A-Z0-9]{1,4}\b/g

/**
 * The ISO 13616 mod-97 check. A real IBAN always passes it; placeholders
 * (all zeros) and the deliberately-invalid test IBANs do not - which is exactly
 * the line between "real personal data" and "a fixture".
 */
function isValidIban(raw: string): boolean {
  const iban = raw.replace(/ /g, '').toUpperCase()
  if (iban.length < 15 || iban.length > 34) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const char of rearranged) {
    const value = /[0-9]/.test(char) ? char : String(char.charCodeAt(0) - 55)
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

/** Tracked files in scope for the check.
 *
 * I14 widened this: the docs and every markdown file are scanned too, and so are the mail sources. The
 * original scope (seed, tests, scripts) missed the one place a real address had actually leaked into - the
 * task list - and the sources the mail client ships.
 */
function trackedFiles(): string[] {
  const out = execSync(
    [
      'git ls-files',
      'src/main/db/seed.ts',
      '"tests/**"',
      '"scripts/**"',
      '"sample_data/*.example.json"',
      '"docs/**"',
      '"*.md"',
      '"src/main/mailclient/**"',
      '"src/main/mail/**"'
    ].join(' '),
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  )
  return (
    out
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
      // markdown is prose, but a real address in prose is still real data
      .filter((f) => /\.(ts|tsx|mjs|js|json|md)$/.test(f))
      // generated e2e artifacts are not source
      .filter((f) => !f.includes('__screenshots__'))
  )
}

type Rule = 'email' | 'iban' | 'phone' | 'bic' | 'street'

const RULE_TEXT: Record<Rule, string> = {
  email: 'email outside the test domains',
  iban: 'IBAN other than the test IBANs',
  phone: 'phone number that is no placeholder',
  bic: 'BIC other than a test BIC',
  street: 'street address'
}

type Finding = { file: string; line: number; rule: string; kind: Rule }

/** One file's findings. Shared by the repo scan and the planted-address tests, so both prove the same rules. */
function scanText(file: string, content: string): Finding[] {
  const findings: Finding[] = []
  // I17 (README tests 5): comment lines are read as well. A real address in a comment is as
  // public as one in code, and the comments used to be skipped.
  content.split('\n').forEach((text, index) => {
    const found = (kind: Rule) =>
      findings.push({ file, line: index + 1, rule: RULE_TEXT[kind], kind })

    for (const match of text.matchAll(EMAIL)) {
      const address = match[0].toLowerCase()
      const domain = match[1].toLowerCase()
      if (ALLOWED_ADDRESSES.has(address)) continue
      if (isAllowedDomain(domain)) continue
      found('email')
    }

    for (const match of text.matchAll(IBAN)) {
      const iban = match[0].replace(/ /g, '').toUpperCase()
      if (ALLOWED_IBANS.has(iban)) continue
      // A placeholder or a deliberately-invalid fixture is not personal data
      if (!isValidIban(iban)) continue
      found('iban')
    }

    for (const match of text.matchAll(PHONE)) {
      if (!isPlaceholderPhone(match[0])) found('phone')
    }

    if (BIC_CONTEXT.test(text)) {
      for (const match of text.matchAll(BIC)) {
        if (!isTestBic(match[0])) found('bic')
      }
    }

    for (const match of text.matchAll(STREET)) {
      if (!isPlaceholderStreet(match[0])) found('street')
    }
  })
  return findings
}

function scan(): Finding[] {
  return trackedFiles()
    .filter((file) => fs.existsSync(file))
    .flatMap((file) => scanText(file, fs.readFileSync(file, 'utf8')))
}

describe('no real personal data in tracked files (E2)', () => {
  it('finds no e-mail address outside the reserved test domains', () => {
    const findings = scan().filter((f) => f.rule.startsWith('email'))
    // Report file:line and rule only - never the match itself
    const report = findings.map((f) => `${f.file}:${f.line} ${f.rule}`)
    expect(report).toEqual([])
  })

  it('finds no IBAN other than the public test IBANs', () => {
    const findings = scan().filter((f) => f.rule.startsWith('IBAN'))
    const report = findings.map((f) => `${f.file}:${f.line} ${f.rule}`)
    expect(report).toEqual([])
  })

  it('finds no phone number, BIC or street address beyond the counted fixtures (I17)', () => {
    const counts = new Map<string, number>()
    for (const f of scan()) {
      if (f.kind === 'email' || f.kind === 'iban') continue
      const key = `${f.file}\t${f.kind}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const expected = new Map<string, number>()
    for (const [file, rules] of Object.entries(KNOWN_FIXTURES)) {
      for (const [kind, n] of Object.entries(rules)) expected.set(`${file}\t${kind}`, n)
    }
    // both ways: a new one fails, and so does a removed one, whose count would hide the next
    const report: string[] = []
    for (const key of new Set([...counts.keys(), ...expected.keys()])) {
      const [file, kind] = key.split('\t')
      const n = counts.get(key) ?? 0
      const known = expected.get(key) ?? 0
      if (n !== known) report.push(`${file} ${RULE_TEXT[kind as Rule]}: ${n}, counted ${known}`)
    }
    expect(report).toEqual([])
  })

  it('the scan itself sees a real file list', () => {
    const files = trackedFiles()
    expect(files.length).toBeGreaterThan(10)
    expect(files).toContain('src/main/db/seed.ts')
  })

  it('scans the docs and markdown, not only the code', () => {
    // I14: the one place a real address HAD leaked into was the task list, which the old scope did not
    // read at all. These assertions are what makes that widening real rather than claimed.
    const files = trackedFiles()
    expect(files.some((f) => f.startsWith('docs/') && f.endsWith('.md'))).toBe(true)
    expect(files.some((f) => f.endsWith('AGENTS.md'))).toBe(true)
    expect(files.some((f) => f.startsWith('src/main/mailclient/'))).toBe(true)
  })
})

describe('the PII scan catches a planted address in each scope (I14)', () => {
  const planted = (text: string, file = 'planted.md'): Finding[] => scanText(file, text)

  it('catches a planted address in a markdown line', () => {
    // the exact shape that leaked: an address in prose, not in code
    const reserved = 'see jemand@club-zentral.example.org for the details'
    expect(planted(reserved)).toHaveLength(0)
    const real = 'see jemand@' + 'club-zentral.de' + ' for the details'
    expect(planted(real)).toHaveLength(1)
  })

  it('reads a markdown bullet that starts with *', () => {
    // Review of I14: the comment skip of the code files swallowed `* name@domain` bullets in markdown
    const bullet = '* jemand@' + 'club-zentral.de'
    expect(planted(bullet)).toHaveLength(1)
  })

  it('reads comment lines in code (I17)', () => {
    // README tests 5: comments used to be skipped, so an address in a doc comment passed
    expect(planted(' * jemand@' + 'club-zentral.de', 'planted.ts')).toHaveLength(1)
    expect(planted('// jemand@' + 'club-zentral.de', 'planted.ts')).toHaveLength(1)
  })

  it('catches a phone number and lets a placeholder through (I17)', () => {
    expect(planted('Tel. +49 ' + '30 ' + '8152 9437')).toHaveLength(1)
    expect(planted('mobil: 0171-' + '5829 361')).toHaveLength(1)
    expect(planted('Tel. +49 30 1234567')).toHaveLength(0)
    expect(planted('Tel. 0171 0000000')).toHaveLength(0)
    // ids and timestamps are bare digit runs
    expect(planted('uidValidity 1700000000, uid 4711, size 052315')).toHaveLength(0)
  })

  it('catches a BIC only where the line says BIC, and lets a test BIC through (I17)', () => {
    expect(planted('BIC: ' + 'MARK' + 'DEF1100')).toHaveLength(1)
    expect(planted('BIC: ABCDDE00')).toHaveLength(0)
    // eight capitals in SQL are no BIC
    expect(planted('SELECT COALESCE(a, b) ON CONFLICT DO NOTHING')).toHaveLength(0)
  })

  it('catches a street address and lets an invented one through (I17)', () => {
    expect(planted('Kastanien' + 'weg 17, Hinterhof')).toHaveLength(1)
    expect(planted('Haupt' + 'str. 3a')).toHaveLength(1)
    expect(planted('Musterstraße 1')).toHaveLength(0)
  })

  it('still allows the reserved test domains and the explicit exceptions', () => {
    // the negative half: a scan that flags the fixtures is useless
    expect(planted('a@b.example.test')).toHaveLength(0)
    expect(planted('noreply@anthropic.com')).toHaveLength(0)
  })

  it('prints file and line only, never the match', () => {
    const findings = planted('x@' + 'real-domain.de', 'planted')
    const report = findings.map((f) => `${f.file}:${f.line} ${f.rule}`)
    expect(report.join('\n')).not.toContain('real-domain')
    expect(report[0]).toMatch(/^planted:\d+ email outside the test domains$/)
  })
})
