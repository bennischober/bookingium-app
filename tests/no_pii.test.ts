// E2: no tracked file may contain real personal data. Scans the seed, the tests, the
// scripts and the example seed for e-mail addresses outside the reserved test domains and
// for IBANs other than the official test ones. Prints file:line and the rule, never the
// match itself.
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

type Finding = { file: string; line: number; rule: string }

/** One file's findings. Shared by the repo scan and the planted-address tests, so both prove the same rules. */
function scanText(file: string, content: string): Finding[] {
  const findings: Finding[] = []
  // In code a leading `*` or `//` is a comment that may describe a rule in prose. In markdown a leading
  // `*` is a bullet, i.e. ordinary text, so nothing is skipped there.
  const skipComments = !file.endsWith('.md')
  content.split('\n').forEach((text, index) => {
    if (skipComments && /^\s*(\/\/|\*|\/\*)/.test(text)) return

    for (const match of text.matchAll(EMAIL)) {
      const address = match[0].toLowerCase()
      const domain = match[1].toLowerCase()
      if (ALLOWED_ADDRESSES.has(address)) continue
      if (isAllowedDomain(domain)) continue
      findings.push({ file, line: index + 1, rule: 'email outside the test domains' })
    }

    for (const match of text.matchAll(IBAN)) {
      const iban = match[0].replace(/ /g, '').toUpperCase()
      if (ALLOWED_IBANS.has(iban)) continue
      // A placeholder or a deliberately-invalid fixture is not personal data
      if (!isValidIban(iban)) continue
      findings.push({ file, line: index + 1, rule: 'IBAN other than the test IBANs' })
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
    // in code the same line is a comment and stays skipped
    expect(planted(bullet, 'planted.ts')).toHaveLength(0)
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
