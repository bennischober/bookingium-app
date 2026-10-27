// The small pure helpers around several addresses: the mail account's further own
// addresses (as typed in the dialog, as stored) and "Kontakt anlegen" from a sender.
import { describe, expect, it, vi } from 'vitest'

// accounts.ts reads the data folder through electron; nothing here touches it
vi.mock('electron', () => ({
  app: { getPath: (): string => '' },
  safeStorage: {
    isEncryptionAvailable: (): boolean => false,
    encryptString: (s: string): Buffer => Buffer.from(s),
    decryptString: (b: Buffer): string => b.toString()
  }
}))

import { normalizeAliases } from '../src/main/mailclient/accounts'
import { parseAliases } from '../src/renderer/src/lib/mailConnection'
import { contactPrefillFromSender } from '../src/renderer/src/components/mail/senderContact'

describe('mail account aliases', () => {
  it('reads the typed list split by commas, semicolons and line breaks', () => {
    expect(parseAliases(' Info@Example.test, buero@example.test;\nkasse@example.test ')).toEqual({
      aliases: ['info@example.test', 'buero@example.test', 'kasse@example.test'],
      invalid: null
    })
    expect(parseAliases('')).toEqual({ aliases: [], invalid: null })
  })

  it('names the first entry that is no address', () => {
    expect(parseAliases('info@example.test, info, kasse@').invalid).toBe('info')
  })

  it('stores each alias once, lower-cased, without the account’s own address', () => {
    expect(
      normalizeAliases(' Ich@Example.test', [
        'Info@example.test',
        'info@example.test ',
        'ich@example.test',
        'kein-at',
        'buero@example.test'
      ])
    ).toEqual(['info@example.test', 'buero@example.test'])
    // Nothing left is no list at all
    expect(normalizeAliases('ich@example.test', ['ICH@example.test', ''])).toBeUndefined()
  })
})

describe('contactPrefillFromSender', () => {
  const prefill = (name: string, email = ' Erika@Example.TEST ') =>
    contactPrefillFromSender({ name, email })

  it('splits first and last name and lower-cases the address', () => {
    expect(prefill('Erika Musterfrau')).toEqual({
      firstName: 'Erika',
      lastName: 'Musterfrau',
      email: 'erika@example.test'
    })
    // Several first names stay together
    expect(prefill('Anna  Lena Musterfrau')).toMatchObject({
      firstName: 'Anna Lena',
      lastName: 'Musterfrau'
    })
  })

  it('reads "Last, First" the other way round and drops quotes', () => {
    expect(prefill('"Musterfrau, Erika"')).toMatchObject({
      firstName: 'Erika',
      lastName: 'Musterfrau'
    })
  })

  it('takes a single word as the first name', () => {
    expect(prefill('Erika')).toMatchObject({ firstName: 'Erika', lastName: '' })
  })

  it('guesses no name from an empty name or one that is only the address', () => {
    expect(prefill('')).toEqual({ firstName: '', lastName: '', email: 'erika@example.test' })
    expect(prefill('erika@example.test')).toMatchObject({ firstName: '', lastName: '' })
  })
})
