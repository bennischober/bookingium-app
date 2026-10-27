// How the editor starts a reply or forward from a mail: who it goes to, the subject
// prefix, the quote and the threading headers that keep it in the conversation
import { describe, expect, it } from 'vitest'
import {
  attachmentKey,
  composeTo,
  draftDirtyKey,
  emptyCompose,
  pasteContent,
  forwardCompose,
  parseAddress,
  replyCompose,
  toDraftInput
} from '@/components/mail/composeDraft'
import type { MessageDetail } from '../src/main/mailclient/core/types'

const ME = 'me@example.test'

function message(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    id: 7,
    folderId: 'f',
    uid: 1,
    subject: 'Angebot',
    fromName: 'Anna',
    fromEmail: 'anna@example.test',
    date: '2026-10-20T08:30:00Z',
    internalDate: null,
    hasAttachments: false,
    attachmentNames: [],
    isRead: true,
    isFlagged: false,
    isDraft: false,
    snippet: '',
    threadId: null,
    threadCount: 1,
    to: [
      { name: '', email: ME },
      { name: 'Bob', email: 'bob@example.test' }
    ],
    cc: [
      { name: '', email: 'Anna@example.test' },
      { name: 'Cleo', email: 'cleo@example.test' }
    ],
    messageId: '<m2@example.test>',
    inReplyTo: '<m1@example.test>',
    references: ['<m1@example.test>'],
    sizeBytes: 100,
    bodyKind: 'text',
    html: null,
    text: 'Zeile eins\n> alt\n',
    attachments: [],
    emlPath: '',
    links: [],
    remoteImages: [],
    remoteImageCount: 0,
    ...overrides
  }
}

const emails = (list: { email: string }[]) => list.map((a) => a.email)

describe('replyCompose', () => {
  it('answers the sender, quotes the text and continues the thread', () => {
    const reply = replyCompose(message(), { all: false, ownEmail: ME })
    expect(emails(reply.to)).toEqual(['anna@example.test'])
    expect(reply.cc).toEqual([])
    expect(reply.subject).toBe('AW: Angebot')
    expect(reply.bodyText).toContain('schrieb Anna:\n> Zeile eins\n>> alt\n')
    expect(reply.bodyText.startsWith('\n\nAm ')).toBe(true)
    expect(reply.inReplyTo).toBe('<m2@example.test>')
    expect(reply.references).toEqual(['<m1@example.test>', '<m2@example.test>'])
    expect(toDraftInput(reply).repliesTo).toBe(7)
  })

  it('reply-all copies everyone else once, never yourself', () => {
    const reply = replyCompose(message(), { all: true, ownEmail: 'ME@example.test' })
    expect(emails(reply.to)).toEqual(['anna@example.test'])
    expect(emails(reply.cc)).toEqual(['bob@example.test', 'cleo@example.test'])
  })

  it('a reply to your own mail goes to its recipients', () => {
    const own = message({
      fromEmail: ME,
      fromName: '',
      to: [{ name: 'Bob', email: 'bob@example.test' }],
      cc: []
    })
    expect(emails(replyCompose(own, { all: false, ownEmail: ME }).to)).toEqual(['bob@example.test'])
  })

  it('keeps an existing prefix', () => {
    for (const subject of ['AW: Angebot', 'Re: Angebot', 'RE:Angebot']) {
      expect(replyCompose(message({ subject }), { all: false, ownEmail: ME }).subject).toBe(subject)
    }
  })
})

describe('forwardCompose', () => {
  it('starts empty-addressed with the original below and its attachments along', () => {
    const fwd = forwardCompose(
      message({
        attachments: [
          {
            partId: '2',
            filename: 'a.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1,
            isInline: false,
            contentId: null
          },
          {
            partId: '3',
            filename: 'logo.png',
            contentType: 'image/png',
            sizeBytes: 1,
            isInline: true,
            contentId: 'logo'
          }
        ]
      })
    )
    expect(fwd.to).toEqual([])
    expect(fwd.subject).toBe('WG: Angebot')
    expect(fwd.bodyText).toContain('Weitergeleitete Nachricht')
    expect(fwd.bodyText).toContain('Von: Anna <anna@example.test>')
    expect(fwd.bodyText).toContain('Zeile eins')
    expect(fwd.forwardedNames).toEqual(['a.pdf'])
    expect(toDraftInput(fwd).forwardsFrom).toBe(7)
    expect(fwd.inReplyTo).toBeNull()
  })
})

describe('parseAddress', () => {
  it('reads the usual forms', () => {
    expect(parseAddress('Anna Ärger <anna@example.test>')).toEqual({
      name: 'Anna Ärger',
      email: 'anna@example.test'
    })
    expect(parseAddress('"Bob, B." <bob@example.test>')).toEqual({
      name: 'Bob, B.',
      email: 'bob@example.test'
    })
    expect(parseAddress('  cleo@example.test ')).toEqual({ name: '', email: 'cleo@example.test' })
  })
})

describe('composeTo (F2)', () => {
  it('addresses exactly the one clicked address', () => {
    const state = composeTo({ name: 'Anna Ärger', email: 'anna@example.test' })
    expect(state.to).toEqual([{ name: 'Anna Ärger', email: 'anna@example.test' }])
  })

  it('is a new mail, never a reply: no threading headers and no quote', () => {
    // A mail that silently becomes a reply lands in the old thread, quoted, as if
    // the person had answered something they never wrote
    const state = composeTo({ name: '', email: 'cc@example.test' })
    expect(state.inReplyTo).toBeNull()
    expect(state.references).toEqual([])
    expect(state.subject).toBe('')
    expect(state.bodyText).toBe('')
  })

  it('carries no attachments over: this is not a forward', () => {
    const state = composeTo({ name: '', email: 'a@example.test' })
    expect(state.attachments).toEqual([])
  })

  it('puts the signature above the empty body', () => {
    const state = composeTo({ name: '', email: 'a@example.test' }, 'Viele Grüße\nLive Music')
    expect(state.bodyText).toContain('Viele Grüße')
  })

  it('trims what the header carried over', () => {
    const state = composeTo({ name: '  Anna  ', email: ' a@example.test ' })
    expect(state.to).toEqual([{ name: 'Anna', email: 'a@example.test' }])
  })
})

describe('pasteContent (F4)', () => {
  it('takes a copied file as an attachment', () => {
    expect(pasteContent(['Files'])).toEqual({ kind: 'files' })
  })

  it('takes a screenshot as an image, not as text', () => {
    // A pasted image must become an attachment: as a data: URI in the body it
    // would grow without a visible attachment
    expect(pasteContent(['image/png'])).toEqual({ kind: 'image' })
    expect(pasteContent(['image/jpeg'])).toEqual({ kind: 'image' })
  })

  it('leaves plain text to the normal paste', () => {
    expect(pasteContent(['text/plain'])).toEqual({ kind: 'text' })
    expect(pasteContent([])).toEqual({ kind: 'text' })
  })

  it('prefers a file when the clipboard carries both', () => {
    expect(pasteContent(['text/plain', 'Files'])).toEqual({ kind: 'files' })
  })
})

describe('F13: the caret has room above the quote', () => {
  it('starts the reply with two empty lines', () => {
    // The user should be able to type immediately, above the quoted mail
    const state = replyCompose(message({ text: 'Hallo' }), { all: false, ownEmail: ME })
    expect(state.bodyText.startsWith('\n\n')).toBe(true)
  })

  it('puts the attribution after the empty lines, then the quote', () => {
    const state = replyCompose(message({ text: 'Hallo' }), { all: false, ownEmail: ME })
    const lines = state.bodyText.split('\n')
    expect(lines[0]).toBe('')
    expect(lines[1]).toBe('')
    expect(lines[2]).toMatch(/^Am .* schrieb /)
    expect(lines[3]).toBe('> Hallo')
  })
})

describe('draftDirtyKey (MR-38)', () => {
  const file = (filename: string, base64: string) => ({
    filename,
    contentType: 'application/pdf',
    base64
  })

  it('leaves the base64 out of the key', () => {
    const big = 'QUJD'.repeat(50_000)
    const key = draftDirtyKey({ ...emptyCompose(), attachments: [file('a.pdf', big)] })
    expect(key.length).toBeLessThan(500)
    expect(key).not.toContain('QUJDQUJD')
  })

  it('changes with the text and with every attachment change', () => {
    const a = file('a.pdf', 'QUJD')
    const base = { ...emptyCompose(), attachments: [a] }
    const key = draftDirtyKey(base)
    expect(draftDirtyKey({ ...base, subject: 'x' })).not.toBe(key)
    expect(draftDirtyKey({ ...base, attachments: [] })).not.toBe(key)
    expect(draftDirtyKey({ ...base, attachments: [file('a.pdf', 'QUJE')] })).not.toBe(key)
    expect(draftDirtyKey({ ...base, attachments: [file('b.pdf', 'QUJD')] })).not.toBe(key)
    expect(draftDirtyKey({ ...base, attachments: [a, a] })).not.toBe(key)
  })

  it('is the same for equal content in new objects', () => {
    const one = { ...emptyCompose(), attachments: [file('a.pdf', 'QUJD')] }
    const two = { ...emptyCompose(), attachments: [file('a.pdf', 'QUJD')] }
    expect(draftDirtyKey(one)).toBe(draftDirtyKey(two))
  })

  it('fingerprints an attachment once', () => {
    const a = file('a.pdf', 'QUJD')
    const first = attachmentKey(a)
    // Attachments are never mutated; the cache answers for the object, not its current content
    a.base64 = 'changed'
    expect(attachmentKey(a)).toBe(first)
  })
})
