// The MIME source the client sends or stores as a draft: what goes in comes back out of a
// parser unchanged, a Bcc only ever reaches a draft, and user text never becomes a header
import { simpleParser, type AddressObject } from 'mailparser'
import { describe, expect, it } from 'vitest'
import { ComposeError, composeMime } from '../src/main/mailclient/core/compose'
import type { DraftInput } from '../src/main/mailclient/core/types'

const FROM = { name: '', email: 'me@example.test' }
const DATE = new Date('2026-10-24T10:00:00Z')

function mail(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    to: [{ name: 'Anna Ärger', email: 'anna@example.test' }],
    cc: [],
    bcc: [],
    subject: 'Grüße',
    bodyText: 'Hallo Anna,\nBcc: steht hier im Text und bleibt.\n',
    bodyHtml: null,
    inReplyTo: null,
    references: [],
    attachments: [],
    ...overrides
  }
}

function emails(field: AddressObject | AddressObject[] | undefined): string[] {
  return (Array.isArray(field) ? field : field ? [field] : []).flatMap((a) =>
    a.value.map((v) => v.address ?? '')
  )
}

describe('composeMime', () => {
  it('round-trips addresses, subject, body and threading headers', async () => {
    const { raw, messageId } = await composeMime(
      mail({
        cc: [{ name: '', email: 'cc@example.test' }],
        inReplyTo: '<a@x>',
        references: ['<r@x>', '<a@x>']
      }),
      { from: FROM, date: DATE, draft: false }
    )
    const parsed = await simpleParser(raw)
    expect(messageId).toMatch(/@example\.test$/)
    expect(parsed.messageId).toBe(`<${messageId}>`)
    expect(emails(parsed.to)).toEqual(['anna@example.test'])
    expect((parsed.to as AddressObject).value[0].name).toBe('Anna Ärger')
    expect(emails(parsed.cc)).toEqual(['cc@example.test'])
    expect(parsed.subject).toBe('Grüße')
    expect(parsed.text).toContain('Bcc: steht hier im Text und bleibt.')
    expect(parsed.inReplyTo).toBe('<a@x>')
    expect(parsed.references).toEqual(['<r@x>', '<a@x>'])
  })

  it('keeps Bcc in a draft and leaves it out of a mail to send', async () => {
    const withBcc = mail({ bcc: [{ name: '', email: 'secret@example.test' }] })
    const draft = await simpleParser(
      (await composeMime(withBcc, { from: FROM, date: DATE, draft: true })).raw
    )
    expect(emails(draft.bcc)).toEqual(['secret@example.test'])
    expect(draft.headers.get('x-mail-client-draft')).toBe('yes')
    const sent = (
      await composeMime(withBcc, { from: FROM, date: DATE, draft: false })
    ).raw.toString('latin1')
    const head = sent.slice(0, sent.indexOf('\r\n\r\n'))
    expect(head).not.toMatch(/^Bcc:/im)
    expect(head).not.toMatch(/^X-Mail-Client-Draft:/im)
    expect(sent).not.toContain('secret@example.test')
    // the body line that only looks like a header stays
    expect(sent).toContain('Bcc: steht hier im Text und bleibt.')
  })

  it('never lets a line break in a name or subject start a header', async () => {
    const { raw } = await composeMime(
      mail({
        to: [{ name: 'Eve\r\nBcc: x@evil.test', email: 'eve@example.test' }],
        subject: 'Hi\r\nX-Injected: 1'
      }),
      { from: FROM, date: DATE, draft: false }
    )
    const head = raw.subarray(0, raw.indexOf('\r\n\r\n')).toString('latin1')
    expect(head).not.toMatch(/^X-Injected:/im)
    expect(head).not.toMatch(/^Bcc:/im)
  })

  it('sends text and HTML as alternatives, with attachments', async () => {
    const { raw } = await composeMime(
      mail({
        bodyHtml: '<p>Hallo</p>',
        attachments: [
          {
            filename: 'a.txt',
            contentType: 'text/plain',
            base64: Buffer.from('eins').toString('base64')
          }
        ]
      }),
      {
        from: FROM,
        date: DATE,
        draft: false,
        extraAttachments: [
          { filename: 'b.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') }
        ]
      }
    )
    const parsed = await simpleParser(raw)
    expect(parsed.html).toContain('<p>Hallo</p>')
    expect(parsed.text).toContain('Hallo Anna')
    expect(parsed.attachments.map((a) => [a.filename, a.content.toString()])).toEqual([
      ['a.txt', 'eins'],
      ['b.pdf', '%PDF']
    ])
  })

  it('refuses an address that is not one', async () => {
    for (const email of [
      'anna',
      'a b@example.test',
      'a@b@example.test',
      'x@example.test, y@example.test'
    ]) {
      await expect(
        composeMime(mail({ to: [{ name: '', email }] }), { from: FROM, date: DATE, draft: false })
      ).rejects.toThrow(ComposeError)
    }
  })
})
