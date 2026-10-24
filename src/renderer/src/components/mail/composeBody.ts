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
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'P', 'DIV', 'BR', 'SPAN'])

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
  let match: RegExpExecArray | null
  while ((match = tag.exec(html)) !== null) {
    kept.push(escapeText(html.slice(last, match.index)))
    const closing = match[1] === '/'
    const name = match[2].toUpperCase()
    if (ALLOWED.has(name)) {
      // A list item is only meaningful inside a list; the editor always nests it
      kept.push(closing ? `</${name.toLowerCase()}>` : `<${name.toLowerCase()}>`)
    }
    last = tag.lastIndex
  }
  kept.push(escapeText(html.slice(last)))
  const body = kept.join('').trim()
  return body === '' ? '' : body
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * F3: what the editor starts with. A stored HTML body is used as it is; a plain
 * text becomes paragraphs, so a quote's line breaks and an empty line survive the
 * first render instead of collapsing into one paragraph.
 */
export function toEditorHtml(body: string): string {
  if (/<[a-zA-Z/][^>]*>/.test(body)) return body
  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.split('\n').map(escapeText).join('<br>')}</p>`)
  return paragraphs.join('')
}
