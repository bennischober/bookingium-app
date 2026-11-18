// #214: which mails "Spam" and "Kein Spam" move, and the mail rule behind
// "Absender immer als Spam". Fictitious addresses only.
import { describe, it, expect } from 'vitest'
import {
  blockPattern,
  blockRule,
  inboxOf,
  junkFolderOf,
  spamTargets
} from '../src/renderer/src/components/mail/spamActions'
import { SaveMailRuleInput } from '../src/main/api/schemas/mailRule.schema'
import type { FolderNode } from '../src/main/mailclient/core/types'

const folder = (id: string, path: string, specialUse: string | null = null): FolderNode =>
  ({
    id,
    path,
    name: path,
    delimiter: '/',
    specialUse,
    unreadCount: 0,
    totalCount: 0,
    syncMode: 'always',
    subscribed: true
  }) as FolderNode

const INBOX = folder('f-in', 'INBOX')
const JUNK = folder('f-junk', 'Spam', '\\Junk')
const OTHER = folder('f-other', 'Projekte')

describe('spam actions', () => {
  it('finds the Junk folder and the inbox', () => {
    expect(junkFolderOf([INBOX, OTHER, JUNK])).toBe(JUNK)
    expect(inboxOf([OTHER, INBOX])).toBe(INBOX)
    expect(junkFolderOf([INBOX, OTHER])).toBeUndefined()
  })

  it('offers Spam outside Junk and Kein Spam inside it, nothing without a Junk folder', () => {
    const items = [
      { id: 1, folderId: INBOX.id },
      { id: 2, folderId: JUNK.id },
      { id: 3, folderId: OTHER.id }
    ]
    expect(spamTargets(items, [INBOX, JUNK, OTHER])).toEqual({ toSpam: [1, 3], notSpam: [2] })
    expect(spamTargets(items, [INBOX, OTHER])).toEqual({ toSpam: [], notSpam: [] })
  })

  it('blocks the address or the whole domain, never an address without one', () => {
    expect(blockPattern(' Werbung@Example.ORG ', 'sender')).toBe('werbung@example.org')
    expect(blockPattern('werbung@example.org', 'domain')).toBe('@example.org')
    expect(blockPattern('kein-at', 'sender')).toBeNull()
    expect(blockPattern('@example.org', 'sender')).toBeNull()
    expect(blockPattern('werbung@', 'domain')).toBeNull()
  })

  it('builds a valid rule that moves new mail of the sender to Junk, read', () => {
    const rule = blockRule('acc-1', 'werbung@example.org', 'domain', JUNK)
    expect(rule).toMatchObject({
      accountId: 'acc-1',
      name: 'Spam: @example.org',
      matchFrom: '@example.org',
      matchTo: '',
      matchSubject: '',
      moveToFolderPath: 'Spam',
      markRead: true,
      enabled: true,
      link: null
    })
    expect(SaveMailRuleInput.safeParse(rule).success).toBe(true)
    expect(blockRule('acc-1', 'kein-at', 'sender', JUNK)).toBeNull()
  })
})
