// Sanitizing is the security boundary of the whole mail client: untrusted mail
// content becomes HTML that the reading pane renders. Every rule in the module's
// contract is pinned here, because a regression in this file is a vulnerability,
// not a rendering bug.
import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  MAIL_CSP,
  MAIL_SANDBOX,
  isUnsafeLinkScheme,
  sanitizeEmailHtml
} from '../src/main/mailclient/core/sanitize'

/** The document the reading pane receives, parsed back for assertions */
const docOf = (html: string): Document => new JSDOM(html).window.document

/** The mail's own style blocks - the document also carries the app's CSP style */
const mailStyles = (html: string): string[] =>
  [...docOf(html).querySelectorAll('style')]
    .map((el) => el.textContent ?? '')
    .filter((css) => !css.includes('mail content styles live in the app'))

describe('sanitize: what never survives', () => {
  it('removes scripts entirely, keeping no code behind', () => {
    const { html } = sanitizeEmailHtml('<p>vor</p><script>alert(1)</script><p>nach</p>')
    expect(html).not.toContain('script')
    expect(html).not.toContain('alert')
    expect(docOf(html).body.textContent).toContain('vor')
    expect(docOf(html).body.textContent).toContain('nach')
  })

  it('removes iframes, objects, embeds and forms', () => {
    const raw = [
      '<iframe src="https://example.test"></iframe>',
      '<object data="x"></object>',
      '<embed src="x">',
      '<form action="https://example.test"><input name="a"></form>'
    ].join('')
    const doc = docOf(sanitizeEmailHtml(raw).html)
    for (const tag of ['iframe', 'object', 'embed', 'form']) {
      expect(doc.querySelector(tag)).toBeNull()
    }
  })

  it('removes every on* handler', () => {
    const { html } = sanitizeEmailHtml(
      '<p onclick="alert(1)" onmouseover="alert(2)" onerror="alert(3)">Text</p>'
    )
    expect(html).not.toMatch(/onclick|onmouseover|onerror/i)
  })

  it('removes svg and math, which can carry script', () => {
    const doc = docOf(
      sanitizeEmailHtml('<svg><script>alert(1)</script></svg><math><mi>x</mi></math>').html
    )
    expect(doc.querySelector('svg')).toBeNull()
    expect(doc.querySelector('math')).toBeNull()
  })

  it('removes meta, link and base, so they cannot override the document', () => {
    const doc = docOf(
      sanitizeEmailHtml(
        '<meta http-equiv="refresh" content="0"><link rel="stylesheet" href="https://x"><base href="https://x">'
      ).html
    )
    expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull()
    expect(doc.querySelector('link')).toBeNull()
    expect(doc.querySelector('base')).toBeNull()
  })
})

describe('sanitize: link schemes', () => {
  it('treats http, https and mailto as openable', () => {
    for (const url of [
      'http://example.test/a',
      'https://example.test/a',
      'mailto:a@example.test'
    ]) {
      expect(isUnsafeLinkScheme(url)).toBe(false)
    }
  })

  it('refuses javascript, data, file and vbscript', () => {
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)'
    ]) {
      expect(isUnsafeLinkScheme(url)).toBe(true)
    }
  })

  it('sees through control characters in the scheme', () => {
    // Browsers ignore tab/newline/CR anywhere in a URL, so a filter must too
    expect(isUnsafeLinkScheme('jav\tascript:alert(1)')).toBe(true)
    expect(isUnsafeLinkScheme('java\nscript:alert(1)')).toBe(true)
    expect(isUnsafeLinkScheme('java\rscript:alert(1)')).toBe(true)
    expect(isUnsafeLinkScheme('\x01javascript:alert(1)')).toBe(true)
    // and the same trick must not make a safe scheme look unsafe
    expect(isUnsafeLinkScheme('ht\ttps://example.test')).toBe(false)
  })

  it('gives an http link its real URL and opens it in a new window', () => {
    const { links } = sanitizeEmailHtml('<p><a href="https://example.test/a">Beispiel</a></p>')
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      index: 0,
      text: 'Beispiel',
      url: 'https://example.test/a',
      scheme: 'https',
      openable: true
    })
  })

  it('gives a blocked link no real href, but still reports its URL', () => {
    const { html, links } = sanitizeEmailHtml(
      '<p><a href="javascript:alert(1)">Bitte klicken</a></p>'
    )
    const anchor = docOf(html).querySelector('a')
    // The UI shows the original URL, so the manifest keeps it even when blocked
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      url: 'javascript:alert(1)',
      scheme: 'javascript',
      openable: false
    })
    // Nothing clickable remains
    expect(anchor?.getAttribute('href')).not.toMatch(/^javascript:/i)
    expect(anchor?.getAttribute('class')).toContain('mail-link-blocked')
  })

  it('numbers the links in document order, matching data-link-idx', () => {
    const { html, links } = sanitizeEmailHtml(
      '<a href="https://a.test">erst</a><a href="mailto:b@test">zweit</a><a href="https://c.test">dritt</a>'
    )
    expect(links.map((l) => l.index)).toEqual([0, 1, 2])
    expect(links.map((l) => l.text)).toEqual(['erst', 'zweit', 'dritt'])
    const anchors = [...docOf(html).querySelectorAll('a')]
    expect(anchors.map((a) => a.getAttribute('data-link-idx'))).toEqual(['0', '1', '2'])
  })

  it('cuts a link text down to a readable length', () => {
    const long = 'x'.repeat(300)
    const { links } = sanitizeEmailHtml(`<a href="https://a.test">${long}</a>`)
    expect(links[0].text).toHaveLength(120)
  })

  it('collapses whitespace in a link text', () => {
    const { links } = sanitizeEmailHtml('<a href="https://a.test">  viel \n  Platz  </a>')
    expect(links[0].text).toBe('viel Platz')
  })
})

describe('sanitize: images', () => {
  it('replaces a remote image and reports it for an opt-in load', () => {
    const { html, remoteImages } = sanitizeEmailHtml(
      '<p><img src="https://tracker.test/pixel.gif" alt="Logo"></p>'
    )
    const img = docOf(html).querySelector('img')!
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(img.getAttribute('data-remote-src')).toBe('https://tracker.test/pixel.gif')
    expect(remoteImages).toEqual([
      { url: 'https://tracker.test/pixel.gif', placeholder: expect.stringMatching(/^data:/) }
    ])
  })

  it('replaces a protocol-relative remote image too', () => {
    const { remoteImages } = sanitizeEmailHtml('<img src="//tracker.test/p.gif">')
    expect(remoteImages[0].url).toBe('//tracker.test/p.gif')
  })

  it('keeps data and blob images, which the CSP allows', () => {
    const { html, remoteImages } = sanitizeEmailHtml(
      '<img src="data:image/png;base64,AAAA"><img src="blob:https://a.test/x">'
    )
    const imgs = [...docOf(html).querySelectorAll('img')]
    expect(imgs[0].getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(imgs[1].getAttribute('src')).toBe('blob:https://a.test/x')
    expect(remoteImages).toEqual([])
  })

  it('keeps a cid image as a reference the UI resolves locally', () => {
    const { html, remoteImages } = sanitizeEmailHtml('<img src="cid:bild-1">')
    const img = docOf(html).querySelector('img')!
    expect(img.getAttribute('data-cid')).toBe('bild-1')
    expect(img.getAttribute('src')).toMatch(/^data:/)
    // Never reported as remote: it comes from the mail itself
    expect(remoteImages).toEqual([])
  })

  it('drops the src of an image with no usable source', () => {
    const { html } = sanitizeEmailHtml('<img alt="leer">')
    expect(docOf(html).querySelector('img')?.hasAttribute('src')).toBe(false)
  })
})

describe('sanitize: css', () => {
  it('neutralizes remote url() in a style block and removes @import', () => {
    const { html } = sanitizeEmailHtml(
      '<style>@import url("https://x.test/a.css"); p { background: url(https://x.test/b.png) }</style>'
    )
    const css = mailStyles(html).join('\n')
    // The comment the neutralizer leaves behind names the rule it removed
    expect(css).not.toMatch(/@import\s+url/)
    expect(css).not.toContain('x.test')
    expect(css).toContain('about:blank')
  })

  it('keeps data and blob url() in a style block', () => {
    const { html } = sanitizeEmailHtml(
      '<style>p { background: url(data:image/png;base64,AAAA) }</style>'
    )
    expect(mailStyles(html).join('\n')).toContain('data:image/png')
  })

  it('neutralizes a remote url() in a style attribute', () => {
    const { html } = sanitizeEmailHtml('<p style="background: url(https://x.test/a.png)">Text</p>')
    const style = docOf(html).querySelector('p')?.getAttribute('style') ?? ''
    expect(style).not.toContain('x.test')
    expect(style).toContain('about:blank')
  })

  it('keeps inline formatting, which the mail needs to look like itself', () => {
    const { html } = sanitizeEmailHtml('<p style="color: red">rot</p>')
    expect(docOf(html).querySelector('p')?.getAttribute('style')).toContain('color')
  })
})

describe('sanitize: the document the reading pane renders', () => {
  it('carries the CSP and no scripting capability', () => {
    const { html } = sanitizeEmailHtml('<p>Text</p>')
    expect(html).toContain(`content="${MAIL_CSP}"`)
    expect(MAIL_CSP).toContain("default-src 'none'")
    // The iframe attributes are the second half of the same guarantee
    expect(MAIL_SANDBOX).not.toContain('allow-scripts')
    expect(MAIL_SANDBOX).not.toContain('allow-same-origin')
  })

  it('keeps ordinary formatting, tables and quotes', () => {
    const raw =
      '<h2>Titel</h2><p><strong>fett</strong> und <em>kursiv</em></p>' +
      '<table><tr><td>Zelle</td></tr></table><blockquote>Zitat</blockquote>'
    const doc = docOf(sanitizeEmailHtml(raw).html)
    expect(doc.querySelector('h2')?.textContent).toBe('Titel')
    expect(doc.querySelector('strong')?.textContent).toBe('fett')
    expect(doc.querySelector('em')?.textContent).toBe('kursiv')
    expect(doc.querySelector('td')?.textContent).toBe('Zelle')
    expect(doc.querySelector('blockquote')?.textContent).toBe('Zitat')
  })

  it('survives empty and plain text input', () => {
    expect(sanitizeEmailHtml('')).toMatchObject({ links: [], remoteImages: [] })
    const plain = sanitizeEmailHtml('nur Text')
    expect(docOf(plain.html).body.textContent).toContain('nur Text')
  })
})
