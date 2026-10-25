import { describe, expect, it } from 'vitest'
import { composeBody } from '@/components/mail/composeBody'

describe('bare URLs become links on the way out (F11)', () => {
  it('links a typed URL', () => {
    const { bodyHtml } = composeBody('<p>siehe https://www.google.com dort</p>')
    expect(bodyHtml).toContain('<a href="https://www.google.com">https://www.google.com</a>')
  })

  it('keeps the trailing punctuation out of the link', () => {
    const { bodyHtml } = composeBody('<p>Siehe https://example.test/a.</p>')
    expect(bodyHtml).toContain('href="https://example.test/a"')
    expect(bodyHtml).toContain('</a>.</p>')
  })

  it('does not nest a link inside a link', () => {
    // Text inside an existing <a> is already a link; linkifying it again would nest
    const { bodyHtml } = composeBody('<a href="https://example.test">https://example.test</a>')
    expect(bodyHtml.match(/<a /g)).toHaveLength(1)
  })

  it('leaves a bare mailto alone: only an explicit link becomes one', () => {
    const { bodyHtml } = composeBody('<p>a@example.test</p>')
    expect(bodyHtml).not.toContain('<a')
  })

  it('links several URLs in one paragraph', () => {
    const { bodyHtml } = composeBody('<p>a https://a.test b https://b.test</p>')
    expect(bodyHtml.match(/<a /g)).toHaveLength(2)
  })

  it('leaves the plain text readable, URL included', () => {
    const { bodyText } = composeBody('<p>siehe https://www.google.com dort</p>')
    expect(bodyText).toBe('siehe https://www.google.com dort')
  })
})

describe('the outgoing HTML stays bare (F3)', () => {
  it('carries dir="auto" so an RTL body reads correctly', () => {
    const { bodyHtml } = composeBody('<p>مرحبا</p>')
    expect(bodyHtml).toContain('dir="auto"')
  })

  it('carries no font, colour or width: the receiving client decides', () => {
    // Inline styling is what makes a mail look ugly in someone else's client
    const { bodyHtml } = composeBody('<p><b>fett</b></p>')
    expect(bodyHtml).not.toMatch(/font-family|font-size|color:|width:/)
  })
})
