// A small XML reader for received e-invoices (#222). E-invoice XML is machine-written and
// well-formed, so this reads elements, attributes and text and nothing more: no DTDs, no
// entities beyond the predefined and numeric ones. Namespace prefixes are dropped, so
// `ram:Name` and `cbc:Name` are both `Name`. Pure (no Node, no DOM).

export interface XmlElement {
  /** Local name, without the namespace prefix */
  name: string
  attributes: Record<string, string>
  children: XmlElement[]
  /** The element's own text (not its children's), trimmed */
  text: string
}

const PREDEFINED: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'"
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match
    }
    return PREDEFINED[entity] ?? match
  })
}

const localName = (qualified: string): string => qualified.slice(qualified.indexOf(':') + 1)

const ATTRIBUTE = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** The document element, or null if the text is not XML this reader understands */
export function parseXml(xml: string): XmlElement | null {
  const stack: XmlElement[] = []
  const texts: string[][] = []
  let root: XmlElement | null = null
  let index = 0

  const close = (): void => {
    const element = stack.pop()
    const text = texts.pop()
    if (!element || !text) return
    element.text = text.join('').trim()
    if (stack.length === 0) root = element
  }

  while (index < xml.length) {
    const open = xml.indexOf('<', index)
    const textEnd = open === -1 ? xml.length : open
    if (textEnd > index && texts.length > 0) {
      texts[texts.length - 1].push(decodeEntities(xml.slice(index, textEnd)))
    }
    if (open === -1) break

    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open + 4)
      if (end === -1) return null
      index = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', open)) {
      const end = xml.indexOf(']]>', open + 9)
      if (end === -1) return null
      if (texts.length > 0) texts[texts.length - 1].push(xml.slice(open + 9, end))
      index = end + 3
      continue
    }
    if (xml.startsWith('<?', open)) {
      const end = xml.indexOf('?>', open + 2)
      if (end === -1) return null
      index = end + 2
      continue
    }
    if (xml.startsWith('<!', open)) {
      // DOCTYPE: e-invoices have none; refuse rather than guess at internal subsets
      return null
    }

    const end = xml.indexOf('>', open + 1)
    if (end === -1) return null
    const tag = xml.slice(open + 1, end)
    index = end + 1

    if (tag.startsWith('/')) {
      const name = localName(tag.slice(1).trim())
      if (stack.length === 0 || stack[stack.length - 1].name !== name) return null
      close()
      continue
    }

    const selfClosing = tag.endsWith('/')
    const body = selfClosing ? tag.slice(0, -1) : tag
    const nameMatch = /^[^\s/>]+/.exec(body)
    if (!nameMatch) return null
    const attributes: Record<string, string> = {}
    for (const match of body.slice(nameMatch[0].length).matchAll(ATTRIBUTE)) {
      attributes[localName(match[1])] = decodeEntities(match[2] ?? match[3] ?? '')
    }
    const element: XmlElement = {
      name: localName(nameMatch[0]),
      attributes,
      children: [],
      text: ''
    }
    if (stack.length > 0) stack[stack.length - 1].children.push(element)
    else if (root) return null // a second document element
    stack.push(element)
    texts.push([])
    if (selfClosing) close()
  }

  return stack.length === 0 ? root : null
}

/** The first child element with this local name */
export function child(element: XmlElement | null | undefined, name: string): XmlElement | null {
  return element?.children.find((candidate) => candidate.name === name) ?? null
}

/** All child elements with this local name */
export function childrenNamed(element: XmlElement | null | undefined, name: string): XmlElement[] {
  return element?.children.filter((candidate) => candidate.name === name) ?? []
}

/** Follows a path of local names, first match at each step */
export function at(element: XmlElement | null | undefined, ...path: string[]): XmlElement | null {
  let current: XmlElement | null = element ?? null
  for (const name of path) current = child(current, name)
  return current
}

/** Text at a path, '' if there is none */
export function textAt(element: XmlElement | null | undefined, ...path: string[]): string {
  return at(element, ...path)?.text ?? ''
}
