// B8: the signature goes in once, above the quote, and survives a reopened draft.
import { describe, expect, it } from 'vitest'
import {
  emptyCompose,
  forwardCompose,
  fromSavedDraft,
  replyCompose,
  withSignature
} from '../src/renderer/src/components/mail/composeDraft'
import type { MessageDetail } from '../src/main/mailclient/core/types'

const SIGNATURE = 'Viele Grüße\nBenjamin Schober\nTel. 030 123456'

function message(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    id: 1,
    accountId: 'acc',
    folderId: 'inbox',
    uid: 7,
    subject: 'Angebot',
    fromName: 'Erika Musterfrau',
    fromEmail: 'erika@example.test',
    to: [{ name: '', email: 'ich@example.test' }],
    cc: [],
    date: '2026-10-24T09:00:00.000Z',
    internalDate: '2026-10-24T09:00:00.000Z',
    text: 'Hallo, anbei das Angebot.',
    html: null,
    snippet: 'Hallo',
    isRead: true,
    isFlagged: false,
    isDraft: false,
    hasAttachments: false,
    attachments: [],
    links: [],
    references: [],
    messageId: '<a@example.test>',
    inReplyTo: null,
    remoteImages: [],
    remoteImageCount: 0,
    ...overrides
  } as MessageDetail
}

describe('signature insertion (B8)', () => {
  it('appends the signature to a new mail', () => {
    const withSig = withSignature(emptyCompose(), SIGNATURE)
    expect(withSig.bodyText).toContain('Benjamin Schober')
    expect(withSig.bodyText.trimEnd().endsWith('030 123456')).toBe(true)
  })

  it('leaves the mail alone without a signature', () => {
    const state = emptyCompose()
    expect(withSignature(state, undefined)).toBe(state)
    expect(withSignature(state, '')).toBe(state)
    expect(withSignature(state, '   ')).toBe(state)
  })

  it('puts the signature above the quote in a reply', () => {
    const reply = replyCompose(message(), { all: false, ownEmail: 'ich@example.test' })
    const withSig = withSignature(reply, SIGNATURE)
    const sigAt = withSig.bodyText.indexOf('Benjamin Schober')
    const quoteAt = withSig.bodyText.indexOf('> ')
    expect(sigAt).toBeGreaterThan(-1)
    expect(quoteAt).toBeGreaterThan(-1)
    // The signature comes before the quoted mail, not after it
    expect(sigAt).toBeLessThan(quoteAt)
  })

  it('never inserts the same signature twice when a draft is reopened', () => {
    const once = withSignature(emptyCompose(), SIGNATURE)
    const twice = withSignature(once, SIGNATURE)
    expect(twice.bodyText).toBe(once.bodyText)
    expect(once.bodyText.split('Benjamin Schober')).toHaveLength(2)
  })

  it('does not insert it twice after saving and reopening the draft', () => {
    const saved = fromSavedDraft({
      uid: 3,
      to: [],
      cc: [],
      bcc: [],
      subject: 'Angebot',
      bodyText: withSignature(emptyCompose(), SIGNATURE).bodyText,
      inReplyTo: null,
      references: [],
      attachments: []
    })
    // The editor runs the insertion again when it opens the saved draft
    const reopened = withSignature(saved, SIGNATURE)
    expect(reopened.bodyText.split('Benjamin Schober')).toHaveLength(2)
  })

  it('adds the signature to a forward as well', () => {
    const forwarded = withSignature(forwardCompose(message()), SIGNATURE)
    expect(forwarded.bodyText).toContain('Benjamin Schober')
    expect(forwarded.bodyText.indexOf('Benjamin Schober')).toBeLessThan(
      forwarded.bodyText.indexOf('Weitergeleitete Nachricht')
    )
  })
})
