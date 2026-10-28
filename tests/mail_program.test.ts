// C1: bookingum's own editor is a mail program choice like any other, but it needs a
// writable mail account - and it is the only one that knows a mail was really sent.
import { describe, expect, it } from 'vitest'
import {
  isMailProgramAvailable,
  mailProgramUnavailableReason,
  OWN_EDITOR
} from '../src/main/mail/mailProgram'

describe('mail program choice (C1)', () => {
  it('offers the own editor only with a writable account', () => {
    expect(isMailProgramAvailable(OWN_EDITOR, true)).toBe(true)
    expect(isMailProgramAvailable(OWN_EDITOR, false)).toBe(false)
  })

  it('offers every external program regardless of the account', () => {
    // Outlook, Thunderbird, mailto and files never send from bookingum
    for (const setting of ['outlook', 'thunderbird', 'mailto', 'files'] as const) {
      expect(isMailProgramAvailable(setting, false), setting).toBe(true)
      expect(isMailProgramAvailable(setting, true), setting).toBe(true)
    }
  })

  it('says why the own editor is unavailable, in German', () => {
    const reason = mailProgramUnavailableReason(OWN_EDITOR, false)
    expect(reason).toContain('Schreibrecht')
    // Nothing to explain when it is available
    expect(mailProgramUnavailableReason(OWN_EDITOR, true)).toBeNull()
    // An external program never needs an explanation
    expect(mailProgramUnavailableReason('outlook', false)).toBeNull()
  })
})
