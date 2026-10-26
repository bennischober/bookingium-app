// The split that keeps the unit suite runnable on CI and honest locally.
//
// CI has no Dovecot/Mailpit, so a sandbox-backed suite must skip there instead of failing - but
// locally a skip looks green in a terminal, and those suites exist precisely to check the sandbox. So a
// missing sandbox FAILS locally (the pre-commit requirement) and skips only on CI.
import { afterEach, describe, expect, it } from 'vitest'
import { sandboxRequired, sandboxSkipReason } from './helpers/sandboxGate'

const env = { ...process.env }
afterEach(() => {
  process.env = { ...env }
})

describe('the sandbox gate: required locally, optional on CI', () => {
  it('runs the sandbox suites locally', () => {
    delete process.env.CI
    delete process.env.BOOKINGIUM_NO_SANDBOX
    expect(sandboxRequired()).toBe(true)
    // a reachable sandbox never skips
    expect(sandboxSkipReason(true, 'x', 1)).toBeNull()
  })

  it('fails loudly when the sandbox is missing locally', () => {
    // The regression this prevents: a silent skip in a terminal reads as green
    delete process.env.CI
    delete process.env.BOOKINGIUM_NO_SANDBOX
    expect(() => sandboxSkipReason(false, 'mail crash-points', 10143)).toThrow(
      /sandbox is not reachable/
    )
    // and the message names the container and the opt-out, not just "failed"
    expect(() => sandboxSkipReason(false, 'mail crash-points', 10143)).toThrow(/Dovecot/)
  })

  it('skips with a visible reason on CI', () => {
    process.env.CI = 'true'
    delete process.env.BOOKINGIUM_NO_SANDBOX
    expect(sandboxRequired()).toBe(false)
    const reason = sandboxSkipReason(false, 'mail crash-points', 10143)
    expect(reason).toContain('skipped (CI)')
  })

  it('can be opted out locally', () => {
    delete process.env.CI
    process.env.BOOKINGIUM_NO_SANDBOX = '1'
    expect(sandboxRequired()).toBe(false)
    expect(sandboxSkipReason(false, 'x', 1)).toContain('skipped (CI)')
  })
})
