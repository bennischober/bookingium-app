// #213: a folder per forwarded address - its name, whether a rule already moves its mail, and the
// rule "Ordner und Regel anlegen" saves. Fictitious addresses only.
import { describe, it, expect } from 'vitest'
import {
  aliasFolderName,
  aliasRule,
  aliasRuleOf
} from '../src/renderer/src/components/settings/aliasFolderRules'
import { SaveMailRuleInput, type MailRuleDto } from '../src/main/api/schemas/mailRule.schema'

const rule = (over: Partial<MailRuleDto>): MailRuleDto => ({
  id: 1,
  accountId: 'acc-1',
  name: 'Regel',
  enabled: true,
  position: 1,
  matchFrom: '',
  matchTo: '',
  matchSubject: '',
  moveToFolderPath: null,
  markRead: false,
  markFlagged: false,
  link: null,
  hitCount: 0,
  lastAppliedAt: null,
  lastError: null,
  ...over
})

describe('alias folders', () => {
  it('names the folder after the address, without the hierarchy delimiter', () => {
    expect(aliasFolderName(' Info@Example.org ', '/')).toBe('info@example.org')
    // a server that nests folders with "." would make the address a folder path
    expect(aliasFolderName('info@example.org', '.')).toBe('info@example-org')
  })

  it('finds a rule that already moves mail sent to the alias', () => {
    const moving = rule({
      id: 2,
      matchTo: 'booking@example.org, Info@Example.org',
      moveToFolderPath: 'Info'
    })
    const linkOnly = rule({ id: 3, matchTo: 'info@example.org', moveToFolderPath: null })
    const otherAccount = rule({
      id: 4,
      accountId: 'acc-2',
      matchTo: 'info@example.org',
      moveToFolderPath: 'X'
    })
    expect(aliasRuleOf([linkOnly, otherAccount, moving], 'acc-1', 'info@example.org')).toBe(moving)
    expect(aliasRuleOf([linkOnly, otherAccount], 'acc-1', 'info@example.org')).toBeUndefined()
    // a part of another address is not the alias
    expect(
      aliasRuleOf(
        [rule({ matchTo: 'shop-info@example.org', moveToFolderPath: 'S' })],
        'acc-1',
        'info@example.org'
      )
    ).toBeUndefined()
  })

  it('saves a valid rule that moves new mail to the alias into its folder', () => {
    const saved = aliasRule('acc-1', 'Info@Example.org', 'info@example.org')
    expect(saved).toMatchObject({
      name: 'Weiterleitung: info@example.org',
      matchFrom: '',
      matchTo: 'info@example.org',
      moveToFolderPath: 'info@example.org',
      markRead: false,
      enabled: true
    })
    expect(SaveMailRuleInput.safeParse(saved).success).toBe(true)
  })
})
