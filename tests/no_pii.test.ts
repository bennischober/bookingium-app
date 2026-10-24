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

/** Tracked files in scope for the check */
function trackedFiles(): string[] {
  const out = execSync(
    'git ls-files src/main/db/seed.ts "tests/**" "scripts/**" "sample_data/*.example.json"',
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  )
  return out
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|mjs|js|json)$/.test(f))
    // generated e2e artifacts are not source
    .filter((f) => !f.includes('__screenshots__'))
}

type Finding = { file: string; line: number; rule: string }

function scan(): Finding[] {
  const findings: Finding[] = []
  for (const file of trackedFiles()) {
    if (!fs.existsSync(file)) continue
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines.forEach((text, index) => {
      // Skip comment lines: a rule may be described in prose
      if (/^\s*(\/\/|\*|\/\*)/.test(text)) return

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
  }
  return findings
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
})
