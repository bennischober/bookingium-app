/**
 * Whether the local mail sandbox (Dovecot + Mailpit) is expected to be running.
 *
 * The unit suite must pass on a machine that has no sandbox - CI has none, and a test that
 * silently skips there is not a pass either. So the sandbox-backed suites are optional in CI and
 * required locally:
 *
 *   - CI (process.env.CI) - skip, and say so once per suite.
 *   - locally (the pre-commit requirement) - FAIL, because a skip looks green in a terminal and the
 *     sandbox is exactly what those suites exist to check.
 *
 * Opt out locally with BOOKINGIUM_NO_SANDBOX=1 when the containers are intentionally down.
 */
export const sandboxRequired = (): boolean => {
  if (process.env.BOOKINGIUM_NO_SANDBOX === '1') return false
  return !process.env.CI
}

/**
 * The skip reason for a suite whose sandbox is not reachable, or null when the suite must run.
 *
 * `reachable` is the probe result. Locally, a missing sandbox throws with the container hint so
 * the failure names the cause instead of looking like a broken feature.
 */
export function sandboxSkipReason(reachable: boolean, what: string, port: number): string | null {
  if (reachable) return null
  if (sandboxRequired()) {
    throw new Error(
      `${what}: the mail sandbox is not reachable on 127.0.0.1:${port}. ` +
        'Start the Dovecot/Mailpit containers, or set BOOKINGIUM_NO_SANDBOX=1 to skip these suites ' +
        'deliberately (they are required locally and skipped in CI).'
    )
  }
  return `${what}: sandbox not running on 127.0.0.1:${port} - suite skipped (CI)`
}
