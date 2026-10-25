// F3: lightweight formatting in the compose editor.
//
// The editor is a contenteditable, so what it holds is HTML - but the HTML is never
// trusted and never the source of truth: the plain text is derived from it and stays
// what search and snippets read. Both are produced here, purely, so the rules are
// testable without a DOM.

/** The formatting the editor offers: four commands, nothing that carries a URL or CSS */
export const COMPOSE_FORMATS = ['bold', 'italic', 'underline', 'insertUnorderedList'] as const
export type ComposeFormat = (typeof COMPOSE_FORMATS)[number]

/**
 * F3: the HTML the editor produces for a mail. Only the tags the four commands can
 * create are kept, so a paste of foreign markup cannot smuggle anything into the
 * body that the sanitizer would later have to strip again.
 */
const ALLOWED = new Set([
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'UL',
  'OL',
  'LI',
  'P',
  'DIV',
  'BR',
  'SPAN',
  'A'
])

/**
 * F11: a link survives the editor, but only http/https/mailto - the same rule the
 * incoming sanitizer applies. A link whose scheme is unsafe keeps its text and loses
 * its href, so nothing clickable and dangerous can leave in a sent mail.
 */
const LINK_SCHEMES = new Set(['http', 'https', 'mailto'])

function schemeOf(raw: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately strips C0 controls and DEL: browsers ignore them inside a URL scheme, which is the smuggling vector this guard must model
  const cleaned = raw.replace(/[\x00-\x20\x7f]/g, '')
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned)
  return match ? match[1].toLowerCase() : ''
}

/**
 * F3: reduce the editor's HTML to the formatting it offers, and derive the plain
 * text from it. The text is the source of truth for search and snippets, so it is
 * produced here rather than read back from the editor.
 */
export function composeBody(html: string): { bodyHtml: string | null; bodyText: string } {
  const blocks = html
    .split(/<\/(?:p|div|li|ul|ol)>|<br\s*\/?>/i)
    .map((block) => textOf(block))
    .map((text) => text.trim())
  // A trailing empty block after the last close tag is not a paragraph
  while (blocks.length > 0 && blocks[blocks.length - 1] === '') blocks.pop()
  const bodyText = blocks.filter((block) => block.length > 0).join('\n')
  const bodyHtml = bodyText.trim() === '' ? null : sanitizeComposeHtml(html)
  return { bodyHtml, bodyText }
}

/** Text of one block, with the allowed tags removed and entities decoded */
function textOf(block: string): string {
  return block
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
}

/**
 * F3: keep only the tags the four commands can create, drop every attribute
 * (they carry no formatting this editor offers), and drop anything else.
 */
function sanitizeComposeHtml(html: string): string {
  const kept: string[] = []
  const tag = /<\s*(\/?)\s*([a-zA-Z0-9]+)[^>]*>/g
  let last = 0
  // Inside <a>...</a> the text is already a link: linkifying it again would nest anchors
  let inAnchor = false
  let match: RegExpExecArray | null
  while ((match = tag.exec(html)) !== null) {
    const between = html.slice(last, match.index)
    kept.push(inAnchor ? escapeHtml(between) : linkifyText(between))
    const closing = match[1] === '/'
    const name = match[2].toUpperCase()
    if (ALLOWED.has(name)) {
      if (!closing && name === 'A') {
        // F11: keep the href, drop every other attribute, and only for a safe scheme
        const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(match[0])
        const url = (href?.[2] ?? href?.[3] ?? '').trim()
        const scheme = schemeOf(url)
        if (url && (scheme === '' || LINK_SCHEMES.has(scheme))) {
          kept.push(`<a href="${escapeAttr(url)}">`)
          // the text until </a> is already a link: linkifying it again would nest anchors
          inAnchor = true
          last = tag.lastIndex
          continue
        }
      }
      // A list item is only meaningful inside a list; the editor always nests it
      if (name === 'A') inAnchor = !closing
      kept.push(closing ? `</${name.toLowerCase()}>` : `<${name.toLowerCase()}>`)
    }
    last = tag.lastIndex
  }
  const tail = html.slice(last)
  kept.push(inAnchor ? escapeHtml(tail) : linkifyText(tail))
  const body = kept.join('').trim()
  return body === '' ? '' : wrapForMail(body)
}

/**
 * F3: the mail's own document. A receiving client applies its own defaults, so this stays
 * deliberately bare - no fonts, no colours, no width. The one thing it adds is
 * `dir="auto"`, so an RTL body reads correctly instead of being forced left to right.
 */
function wrapForMail(body: string): string {
  return `<div dir="auto">${body}</div>`
}

/**
 * F11: a bare URL in the typed text becomes a link on the way out.
 *
 * Done here, at send time, rather than while typing: the editor stays simple, and the
 * plain-text part keeps the URL readable. Only http/https are auto-linked - a mailto or
 * an arbitrary scheme has to be an explicit link, so nothing surprising becomes clickable.
 */
const BARE_URL = /\bhttps?:\/\/[^\s<>"']+/gi

function linkifyText(text: string): string {
  let out = ''
  let last = 0
  for (const match of text.matchAll(BARE_URL)) {
    const start = match.index ?? 0
    out += escapeHtml(text.slice(last, start))
    // Trailing punctuation belongs to the sentence, not the URL
    const trimmed = match[0].replace(/[.,;:!?)\]]+$/, '')
    out += `<a href="${escapeAttr(trimmed)}">${escapeHtml(trimmed)}</a>`
    out += escapeHtml(match[0].slice(trimmed.length))
    last = start + match[0].length
  }
  return out + escapeHtml(text.slice(last))
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * F3: what the editor starts with. A stored HTML body is used as it is; a plain
 * text becomes paragraphs, so a quote's line breaks and an empty line survive the
 * first render instead of collapsing into one paragraph.
 *
 * H3: a reply's body starts with two newlines, and those are the room the user writes
 * in. Splitting on blank lines and dropping empty blocks threw them away, so the caret
 * landed on the first character of the quote. A leading blank block is therefore kept as
 * an empty paragraph - the caret effect then has somewhere to go.
 */
export function toEditorHtml(body: string): string {
  if (/<[a-zA-Z/][^>]*>/.test(body)) return body
  const leadingBlank = /^\s*\n/.test(body)
  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.split('\n').map(escapeHtml).join('<br>')}</p>`)
  // The empty paragraph is the writing room above the quote; without it the editor
  // opens with the caret inside the quoted text (H3)
  return (leadingBlank ? '<p><br></p>' : '') + paragraphs.join('')
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
