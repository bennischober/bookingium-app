// The worker's start-up failures reach the user in German (initErrorText)
import { describe, expect, it } from 'vitest'
import { initErrorText } from '../src/main/mailclient/hostErrors'

describe('initErrorText', () => {
  it('says in German that the account is not ready yet, and where to look', () => {
    const text = initErrorText('createMailCore: no mail account could be opened')
    expect(text).toMatch(/^Das E-Mail-Konto ist noch nicht bereit/)
    expect(text).toContain('Einstellungen › E-Mail')
  })

  it('passes other messages on as they are', () => {
    expect(initErrorText('Kein E-Mail-Konto eingerichtet')).toBe('Kein E-Mail-Konto eingerichtet')
  })
})
