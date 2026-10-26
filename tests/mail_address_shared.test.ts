// One implementation, two callers - pinned so they cannot drift apart again.
//
// The renderer used to keep its own COPY of the core's address regex, with a comment claiming it was
// "the same check the core makes". Nothing enforced that. A copy drifts silently: the field says the address
// is fine, the send then fails with the core's own error, and nobody knows why.
//
// These tests read the source rather than the behaviour, because the property is structural: the UI must not
// contain its own copy.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8')
const core = read('src/main/mailclient/core/address.ts')
const ui = read('src/renderer/src/components/mail/composeDraft.ts')
const compose = read('src/main/mailclient/core/compose.ts')

describe('one address guard, shared by the core and the UI', () => {
  it('the UI re-exports the core guard instead of defining its own', () => {
    // the drift risk: a second regex literal here means two implementations
    expect(ui).toContain("from '../../../../main/mailclient/core/address'")
    expect(ui).not.toMatch(/const EMAIL = \//)
  })

  it('the core imports it too, rather than keeping a private copy', () => {
    expect(compose).toContain("from './address.js'")
    expect(compose).not.toMatch(/const EMAIL = \//)
  })

  it('there is exactly one definition of the guard in the codebase', () => {
    // two definitions would be the drift this change exists to prevent
    expect(core).toContain('export function isValidEmail')
    expect(ui).not.toContain('export function isValidEmail')
    expect(compose).not.toContain('function isValidEmail')
  })

  it('keeps the core dependency-free', () => {
    // the reason the guard lives in core/: the mail core imports nothing outside itself
    expect(core).not.toMatch(/from '(?!\.)/)
  })
})
