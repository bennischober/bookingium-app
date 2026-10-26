// F3: lightweight formatting. The editor holds HTML, but the plain text stays the
// source of truth for search and snippets, so both are produced by one pure function.
import { describe, expect, it } from 'vitest'
import { composeBody, toEditorHtml, COMPOSE_FORMATS } from '@/components/mail/composeBody'

describe('composeBody (F3)', () => {
  it('keeps the formatting the editor offers', () => {
    const { bodyHtml } = composeBody(
      '<p><b>fett</b> und <i>kursiv</i> und <u>unterstrichen</u></p>'
    )
    expect(bodyHtml).toContain('<b>fett</b>')
    expect(bodyHtml).toContain('<i>kursiv</i>')
    expect(bodyHtml).toContain('<u>unterstrichen</u>')
  })

  it('keeps a bulleted list', () => {
    const { bodyHtml, bodyText } = composeBody('<ul><li>eins</li><li>zwei</li></ul>')
    expect(bodyHtml).toContain('<ul>')
    expect(bodyHtml).toContain('<li>')
    // The text keeps one item per line, so the mail reads the same without HTML
    expect(bodyText).toBe('eins\nzwei')
  })

  it('derives the plain text from the HTML, one line per block', () => {
    const { bodyText } = composeBody('<p>erste</p><p>zweite</p>')
    expect(bodyText).toBe('erste\nzweite')
  })

  it('keeps no empty lines from empty blocks', () => {
    const { bodyText } = composeBody('<p>erste</p><p></p><p>zweite</p>')
    expect(bodyText).toBe('erste\nzweite')
  })

  it('drops the attributes, which carry no formatting the editor offers', () => {
    // A style attribute would only add what the sanitizer has to strip again
    const { bodyHtml } = composeBody('<p style="color:red" class="x" onclick="alert(1)">rot</p>')
    expect(bodyHtml).toContain('<p>rot</p>')
    expect(bodyHtml).not.toMatch(/style=|class=|onclick=/)
  })

  it('drops markup the four commands cannot create', () => {
    // A paste of foreign markup must not smuggle anything into the body
    const { bodyHtml } = composeBody(
      '<p>ok</p><script>alert(1)</script><iframe src="https://x"></iframe><img src="https://x">'
    )
    expect(bodyHtml).not.toContain('script')
    expect(bodyHtml).not.toContain('iframe')
    expect(bodyHtml).not.toContain('img')
    expect(bodyHtml).toContain('ok')
  })

  it('is null for an empty body, so the mail stays plain text', () => {
    // No HTML part at all is what the core already expects for a plain mail
    expect(composeBody('')).toEqual({ bodyHtml: null, bodyText: '' })
    expect(composeBody('<p></p>')).toEqual({ bodyHtml: null, bodyText: '' })
    expect(composeBody('<p>   </p>')).toEqual({ bodyHtml: null, bodyText: '' })
  })

  it('keeps the text of a mail without any formatting', () => {
    const { bodyHtml, bodyText } = composeBody('<p>nur Text</p>')
    expect(bodyText).toBe('nur Text')
    expect(bodyHtml).toContain('<p>nur Text</p>')
  })

  it('escapes a < that is text, so it stays text', () => {
    // Otherwise "a < b" would open a tag when the HTML is rendered
    const { bodyText } = composeBody('<p>a &lt; b</p>')
    expect(bodyText).toBe('a < b')
  })

  it('offers exactly the four commands', () => {
    expect([...COMPOSE_FORMATS]).toEqual(['bold', 'italic', 'underline', 'insertUnorderedList'])
  })
})

describe('toEditorHtml (F3)', () => {
  it('keeps a stored HTML body, through the compose allowlist', () => {
    expect(toEditorHtml('fett', '<p><b>fett</b></p>')).toBe('<p><b>fett</b></p>')
  })

  it('turns a plain text into paragraphs, so its lines survive', () => {
    // A quote is plain text with line breaks; one paragraph would lose them
    expect(toEditorHtml('erste\nzweite')).toBe('<p>erste<br>zweite</p>')
    expect(toEditorHtml('erste\n\nzweite')).toBe('<p>erste</p><p>zweite</p>')
  })

  it('keeps the writing room above a reply quote (H3)', () => {
    // A reply body starts with two newlines; that blank block IS the room the user
    // writes in. Dropping it put the caret on the first character of the quote.
    const reply = '\n\nAm 23.10.2026 schrieb Malte Hohmann:\n> Text\n'
    const html = toEditorHtml(reply)
    expect(html.startsWith('<p><br></p>')).toBe(true)
    // The quote is still there, after that empty paragraph
    expect(html).toContain('schrieb Malte Hohmann')
  })

  it('does not add writing room to a body that has none (H3)', () => {
    // A draft typed from scratch starts at the first paragraph, not below an empty one
    expect(toEditorHtml('Yo das ist ein Test')).toBe('<p>Yo das ist ein Test</p>')
    expect(toEditorHtml('')).toBe('')
  })

  it('escapes text that looks like markup', () => {
    expect(toEditorHtml('a < b')).toBe('<p>a &lt; b</p>')
  })
})

// I5 (MR-08): a plain text that contained anything tag-like was handed to the editor as HTML.
// Every forward header has "Name <a@example.test>", so the quote lost its line breaks and its
// addresses, and a subject like "<style>..." restyled the app window.
describe('toEditorHtml never sniffs a plain text (MR-08)', () => {
  it('keeps a forward header, its address and its line breaks', () => {
    const forward = 'Von: Erika Muster <erika@example.test>\nAn: b@example.test\nBetreff: Termin'
    expect(toEditorHtml(forward)).toBe(
      '<p>Von: Erika Muster &lt;erika@example.test&gt;<br>An: b@example.test<br>Betreff: Termin</p>'
    )
  })

  it('keeps a URL in angle brackets as text', () => {
    expect(toEditorHtml('siehe <https://example.test/a>')).toBe(
      '<p>siehe &lt;https://example.test/a&gt;</p>'
    )
  })

  it('shows a literal <b> instead of making the text bold', () => {
    expect(toEditorHtml('<b>nicht fett</b>')).toBe('<p>&lt;b&gt;nicht fett&lt;/b&gt;</p>')
  })

  it('cannot put a style or an image into the editor through the text', () => {
    const html = toEditorHtml('<style>body{display:none}</style><img src=x onerror=alert(1)>')
    expect(html).not.toMatch(/<style|<img/i)
  })

  it('reduces a stored HTML body to the formatting the editor offers', () => {
    const html = toEditorHtml(
      'x',
      '<p style="color:red" onclick="x()"><b>fett</b></p><style>p{}</style><img src="x">'
    )
    expect(html).toBe('<p><b>fett</b></p>p{}')
    expect(html).not.toMatch(/<style|<img|onclick|style=/i)
  })

  it('round-trips a forward header through the editor unchanged', () => {
    const forward = 'Von: Erika Muster <erika@example.test>\nBetreff: Termin'
    expect(composeBody(toEditorHtml(forward)).bodyText).toBe(forward)
  })
})

describe('links in the editor (F11)', () => {
  it('keeps an http link, href and text', () => {
    const { bodyHtml, bodyText } = composeBody(
      '<p>siehe <a href="https://example.test/a">hier</a></p>'
    )
    expect(bodyHtml).toContain('<a href="https://example.test/a">hier</a>')
    expect(bodyText).toBe('siehe hier')
  })

  it('keeps a mailto link', () => {
    const { bodyHtml } = composeBody('<a href="mailto:a@example.test">schreiben</a>')
    expect(bodyHtml).toContain('href="mailto:a@example.test"')
  })

  it('keeps a relative link, which cannot leave the document', () => {
    const { bodyHtml } = composeBody('<a href="#abschnitt">weiter</a>')
    expect(bodyHtml).toContain('href="#abschnitt"')
  })

  it('drops the href of an unsafe scheme but keeps the text', () => {
    // A sent mail must never carry a clickable javascript: link
    const { bodyHtml, bodyText } = composeBody('<a href="javascript:alert(1)">klick</a>')
    expect(bodyHtml).not.toContain('javascript')
    expect(bodyText).toBe('klick')
  })

  it('drops every other attribute of a link', () => {
    const { bodyHtml } = composeBody('<a href="https://a.test" onclick="alert(1)" class="x">a</a>')
    expect(bodyHtml).toContain('<a href="https://a.test">a</a>')
  })
})
