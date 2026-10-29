// The pure half of the thread view: count labels, the row mapping and the mail a
// row opens. No DOM (vitest runs in a node environment here).
import { describe, it, expect } from 'vitest'
import type { ThreadSummary } from '../src/main/mailclient/core/types'
import {
  newestMessageId,
  threadCountLabel,
  threadRows,
  threadSubject
} from '../src/renderer/src/components/mail/threadView'

const thread = (overrides: Partial<ThreadSummary> = {}): ThreadSummary => ({
  threadId: 'thread-1',
  count: 1,
  subject: 'Vertrag Berlin',
  fromName: 'Erika Musterfrau',
  date: '2026-03-02 10:00:00',
  unread: 0,
  hasAttachments: false,
  snippet: 'Anbei der Vertrag',
  messageIds: [12],
  ...overrides
})

describe('the count label', () => {
  it('says nothing for a single mail', () => {
    expect(threadCountLabel(1)).toBeNull()
    expect(threadCountLabel(0)).toBeNull()
  })

  it('counts the mails of a thread the German way', () => {
    expect(threadCountLabel(2)).toBe('2 Nachrichten')
    expect(threadCountLabel(3)).toBe('3 Nachrichten')
    expect(threadCountLabel(1234)).toBe('1.234 Nachrichten')
  })
})

describe('the rows', () => {
  it('adds the label and leaves the summaries as delivered', () => {
    const rows = threadRows([thread({ count: 1 }), thread({ threadId: 'thread-2', count: 3 })])
    expect(rows.map((row) => row.countLabel)).toEqual([null, '3 Nachrichten'])
    // The summary's own fields are not rewritten
    expect(rows[1]).toMatchObject({
      threadId: 'thread-2',
      count: 3,
      subject: 'Vertrag Berlin',
      messageIds: [12]
    })
  })

  it('keeps the order the core delivered', () => {
    // Newest first is the core's order; the list must not re-sort it
    const rows = threadRows([
      thread({ threadId: 'neu', date: '2026-06-11 10:00:00' }),
      thread({ threadId: 'alt', date: '2026-03-02 10:00:00' })
    ])
    expect(rows.map((row) => row.threadId)).toEqual(['neu', 'alt'])
  })
})

describe('the mail a row opens', () => {
  it('is the newest of the thread', () => {
    // The core puts the newest first, so opening the thread opens that mail
    expect(newestMessageId(thread({ messageIds: [42, 41, 40] }))).toBe(42)
  })

  it('is nothing when the newest mail is gone from the store', () => {
    // A thread whose mails are all gone has no row to open; clicking it must not
    // open some other mail
    expect(newestMessageId(thread({ messageIds: [] }))).toBeNull()
  })
})

describe('the subject in the reading pane', () => {
  it('names the thread size only when it has more than one mail', () => {
    expect(threadSubject(thread({ count: 1 }))).toBe('Vertrag Berlin')
    expect(threadSubject(thread({ count: 3 }))).toBe('Vertrag Berlin (3)')
  })

  it('falls back for a mail without a subject', () => {
    expect(threadSubject(thread({ subject: '' }))).toBe('(kein Betreff)')
  })
})
