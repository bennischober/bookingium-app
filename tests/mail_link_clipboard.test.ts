// Copying a link out of a mail is a lower-risk action than opening it, but not a safe one: whatever lands on the
// clipboard is going to be pasted somewhere that DOES execute it. So the copy path carries the same scheme allowlist
// as the window-open handler (http, https, mailto), and that rule is pinned here.
//
// The rule lives in its own module (src/main/mail/linkClipboard.ts) precisely so it can be tested: index.ts imports
// electron and cannot be loaded in the node test env.
import { describe, expect, it } from 'vitest'
import { copyableLinkUrl } from '../src/main/mail/linkClipboard'

describe('copying a mail link: what may go on the clipboard', () => {
  it('copies the three schemes the app will open', () => {
    for (const url of [
      'https://example.test/a',
      'http://example.test/a',
      'mailto:jemand@example.test'
    ]) {
      expect(copyableLinkUrl(url), url).toEqual({ ok: true, url })
    }
  })

  it('refuses a scheme that could execute when pasted', () => {
    // javascript: on the clipboard is one paste away from running
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)'
    ]) {
      const out = copyableLinkUrl(url)
      expect(out.ok, url).toBe(false)
      // the reason names the scheme, so a blocked copy is not a mystery
      if (!out.ok) expect(out.error).toMatch(/Schema/i)
    }
  })

  it('refuses a local file path', () => {
    // a mail must not be able to put a path to the user's disk on the clipboard
    for (const url of ['file:///etc/passwd', 'file:///C:/Windows/System32/config/SAM']) {
      expect(copyableLinkUrl(url).ok, url).toBe(false)
    }
  })

  it('refuses something that is not a URL at all', () => {
    for (const url of ['', 'nicht mal eine url', '//example.test/relativ']) {
      const out = copyableLinkUrl(url)
      expect(out.ok, JSON.stringify(url)).toBe(false)
      if (!out.ok) expect(out.error).toBe('Keine gültige Adresse')
    }
  })

  it('returns the address unchanged, so a copy is byte-identical', () => {
    // a normalising copy would silently alter a link with a query or a fragment
    const url = 'https://example.test/a?b=1&c=2#abschnitt'
    const out = copyableLinkUrl(url)
    expect(out.ok && out.url).toBe(url)
  })
})
