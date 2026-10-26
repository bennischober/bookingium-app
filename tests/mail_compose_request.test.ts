// I7: how the compose window reads what main opened it with (MR-11, MR-21).
import { describe, expect, it } from 'vitest'
import {
  decodeDraftParam,
  parseComposeRequest
} from '../src/renderer/src/components/mail/composeRequest'

/** What main puts into the URL: base64 of the draft's UTF-8 JSON */
const encode = (draft: object): string =>
  Buffer.from(JSON.stringify(draft), 'utf-8').toString('base64')

describe('decodeDraftParam (MR-11)', () => {
  it('keeps umlauts and ß, which atob alone turned into two Latin-1 characters each', () => {
    const text = 'Mit freundlichen Grüßen – über 2.675,00 €'
    expect(decodeDraftParam(Buffer.from(text, 'utf-8').toString('base64'))).toBe(text)
  })

  it('refuses bytes that are not UTF-8 instead of showing replacement characters', () => {
    expect(() => decodeDraftParam(Buffer.from([0x47, 0xfc, 0x65]).toString('base64'))).toThrow()
  })
})

describe('parseComposeRequest', () => {
  const draft = { to: 'a@example.test', subject: 'Rechnung 7 – Zürich', body: 'Grüße' }

  it('reads the draft, the token and the attachment name', () => {
    expect(
      parseComposeRequest({
        mode: 'compose',
        token: 'tok-1',
        draft: encode(draft),
        attachment: 'Rechnung-7.pdf'
      })
    ).toEqual({ token: 'tok-1', attachmentName: 'Rechnung-7.pdf', ...draft })
  })

  it('carries no file path: the window only ever learns the attachment name (MR-21)', () => {
    const request = parseComposeRequest({
      mode: 'compose',
      token: 'tok-1',
      draft: encode(draft),
      attachment: 'Rechnung-7.pdf',
      pdfPath: 'C:/Users/x/secret.pdf'
    })
    expect(Object.keys(request ?? {}).sort()).toEqual([
      'attachmentName',
      'body',
      'subject',
      'to',
      'token'
    ])
    expect(JSON.stringify(request)).not.toContain('secret')
  })

  it('takes values the router parsed as JSON (a numeric name) as text', () => {
    expect(parseComposeRequest({ mode: 'compose', token: 123, attachment: 2026 })).toMatchObject({
      token: '123',
      attachmentName: '2026'
    })
  })

  it('is no compose request without the compose mode or a token', () => {
    expect(parseComposeRequest({ mode: 'read', token: 'tok-1' })).toBeNull()
    expect(parseComposeRequest({ mode: 'compose' })).toBeNull()
  })

  it('is no compose request when the draft cannot be read', () => {
    expect(parseComposeRequest({ mode: 'compose', token: 't', draft: '%%%' })).toBeNull()
  })
})
