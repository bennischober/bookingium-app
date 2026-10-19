// Cleaning helpers for hand-maintained contact spreadsheets: several names or
// emails in one cell, URLs without scheme, VAT ids with spaces, ...

/** Lower-case comparison key: punctuation and repeated spaces dropped */
export function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Trims and collapses whitespace (incl. line breaks) */
export function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

// ----------------------------------------
// Persons
// ----------------------------------------

export interface ParsedPerson {
  firstName: string
  lastName: string
  role: string
  notes: string
}

const NAME_PREFIXES: Record<string, string> = {
  gf: 'Geschäftsführer',
  herr: '',
  hr: '',
  frau: '',
  fr: '',
  mr: '',
  mrs: '',
  ms: ''
}

/**
 * "Steven Pönicke / Richard Schröder", "Elke und Johannes",
 * "GF Andreas Schmidt", "Oliver Pech\nVorsitzender",
 * "John Rockstar (Gesang, Gitarre), Gesang: Sarah Keys" → one entry per
 * person. Roles come from parentheses, a "Role:" prefix or the text after
 * the first line break.
 */
export function parsePersons(raw: string): ParsedPerson[] {
  const [firstLine, ...rest] = raw.split(/\r?\n/)
  const lineRole = cleanText(rest.join(' '))

  // Separators inside parentheses belong to the role, not between persons
  const groups: string[] = []
  // (placeholder: a private-use character that never occurs in names)
  const masked = firstLine.replace(/\(([^)]*)\)/g, (_match, inner: string) => {
    groups.push(inner)
    return `${groups.length - 1}`
  })

  return masked
    .split(/\s*(?:[/,;&+]|\bund\b|\boder\b|\band\b)\s*/i)
    .map((part) => part.replace(/(\d+)/g, (_match, index) => `(${groups[index]})`))
    .map((part) => parsePerson(part, lineRole))
    .filter((person): person is ParsedPerson => person !== null)
}

function parsePerson(part: string, lineRole: string): ParsedPerson | null {
  let text = part.replace(/[:]+$/, '').trim()
  let ownRole = ''
  // "John Rockstar (Gesang)"
  text = text.replace(/\(([^)]*)\)/g, (_match, inner: string) => {
    ownRole = cleanText(inner)
    return ' '
  })
  // "Gesang: John Rockstar"
  const prefixed = text.match(/^([^:]{2,40}):\s*(.+)$/)
  if (prefixed && !ownRole) {
    ownRole = cleanText(prefixed[1])
    text = prefixed[2]
  }
  // Nicknames in quotes go to the notes: Carsten "Strubbel" Schack
  const notes: string[] = []
  text = text.replace(/["„“”']([^"„“”']+)["„“”']/g, (_match, nick: string) => {
    notes.push(`Spitzname: ${nick.trim()}`)
    return ' '
  })
  const words = cleanText(text).split(' ').filter(Boolean)
  let role = ownRole || lineRole
  const prefix = words[0]?.toLowerCase().replace(/\.$/, '')
  if (words.length > 1 && prefix !== undefined && prefix in NAME_PREFIXES) {
    words.shift()
    role = NAME_PREFIXES[prefix] || role
  }
  if (words.length === 0) return null
  // Phone numbers, emails and the like are not names
  if (words.some((word) => /[\d@]/.test(word))) return null

  return {
    firstName: words.length > 1 ? words.slice(0, -1).join(' ') : words[0],
    lastName: words.length > 1 ? words[words.length - 1] : '',
    role,
    notes: notes.join('\n')
  }
}

/** "12.03.1985", "1985-03-12" → "1985-03-12"; '' if it is no full date */
export function parseBirthday(raw: string): string {
  const text = cleanText(raw)
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const german = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  const parts = iso ? [iso[1], iso[2], iso[3]] : german ? [german[3], german[2], german[1]] : null
  if (!parts) return ''
  const [year, month, day] = parts
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return ''
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

// ----------------------------------------
// Contact data
// ----------------------------------------

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

/** All email addresses in a cell ("a@x.de; b@x.de", "Name <a@x.de>") */
export function parseEmails(raw: string): string[] {
  // Spam-protected spellings: info(@)x.de, info [at] x.de
  const text = raw.replace(/\s*(?:\(@\)|\[@\]|\(at\)|\[at\])\s*/gi, '@')
  return [...new Set(text.match(EMAIL_PATTERN) ?? [])]
}

/**
 * A usable homepage URL, or '' — "www.x.de" gets https://, the first of
 * several addresses wins, emails are not URLs.
 */
export function normalizeUrl(raw: string): string {
  for (const token of raw.split(/[\s;,]+/)) {
    const candidate = token.replace(/^\/+/, '').replace(/[)>\]]+$/, '')
    if (!candidate || candidate.includes('@')) continue
    const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`
    try {
      const url = new URL(withScheme)
      if (url.hostname.includes('.')) return url.href.replace(/\/$/, '')
    } catch {
      // not a URL, try the next token
    }
  }
  return ''
}

/** Website-looking cells in an email column ("www.goldrush.com") */
export function looksLikeDomain(raw: string): boolean {
  return !raw.includes('@') && normalizeUrl(raw) !== ''
}

/** First number in the cell: "500", "1.800", "500-1000" → 500 */
export function parseCapacity(raw: string): number | null {
  const match = raw.match(/\d[\d.]*/)
  if (!match) return null
  const value = Number(match[0].replace(/\./g, ''))
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * "DE 20 033 044 16" → VAT id DE2003304416; "22/200/80883" or
 * "StNr 25133/30314" → tax number
 */
export function parseTaxId(raw: string): { vatNumber: string; taxNumber: string } {
  const text = cleanText(raw)
  if (!text) return { vatNumber: '', taxNumber: '' }
  const compact = text.replace(/\s+/g, '')
  if (/^[A-Z]{2}[0-9A-Z]{2,}$/i.test(compact)) {
    return { vatNumber: compact.toUpperCase(), taxNumber: '' }
  }
  return { vatNumber: '', taxNumber: text.replace(/^St\.?-?\s*Nr\.?\s*/i, '') }
}

// ----------------------------------------
// Regions
// ----------------------------------------

export interface Country {
  name: string
  code: string
}

const GERMANY: Country = { name: 'Germany', code: 'DE' }

// Abbreviations used in German booking lists → Bundesland. Codes without a
// clear meaning (e.g. "SA") are kept as written.
const GERMAN_STATES: Record<string, string> = {
  bw: 'Baden-Württemberg',
  by: 'Bayern',
  be: 'Berlin',
  bb: 'Brandenburg',
  bra: 'Brandenburg',
  hb: 'Bremen',
  hh: 'Hamburg',
  he: 'Hessen',
  mv: 'Mecklenburg-Vorpommern',
  ni: 'Niedersachsen',
  nds: 'Niedersachsen',
  nw: 'Nordrhein-Westfalen',
  nrw: 'Nordrhein-Westfalen',
  rp: 'Rheinland-Pfalz',
  rlp: 'Rheinland-Pfalz',
  sl: 'Saarland',
  sr: 'Saarland',
  sn: 'Sachsen',
  sa: '',
  st: 'Sachsen-Anhalt',
  sh: 'Schleswig-Holstein',
  th: 'Thüringen',
  thü: 'Thüringen'
}

const COUNTRIES: Array<[string[], Country]> = [
  [['de', 'deu', 'ger', 'germany', 'deutschland', 'd'], GERMANY],
  [['at', 'aut', 'a', 'austria', 'österreich'], { name: 'Austria', code: 'AT' }],
  [['ch', 'che', 'switzerland', 'schweiz'], { name: 'Switzerland', code: 'CH' }],
  [
    ['uk', 'gb', 'gbr', 'england', 'scotland', 'wales', 'united kingdom', 'großbritannien'],
    { name: 'United Kingdom', code: 'GB' }
  ],
  [['ie', 'irl', 'ireland', 'irland'], { name: 'Ireland', code: 'IE' }],
  [['nl', 'nld', 'netherlands', 'niederlande', 'holland'], { name: 'Netherlands', code: 'NL' }],
  [['be', 'bel', 'belgium', 'belgien'], { name: 'Belgium', code: 'BE' }],
  [['lu', 'lux', 'luxembourg', 'luxemburg'], { name: 'Luxembourg', code: 'LU' }],
  [['fr', 'fra', 'france', 'frankreich'], { name: 'France', code: 'FR' }],
  [['it', 'ita', 'italy', 'italien'], { name: 'Italy', code: 'IT' }],
  [['es', 'esp', 'spain', 'spanien'], { name: 'Spain', code: 'ES' }],
  [['pt', 'prt', 'portugal'], { name: 'Portugal', code: 'PT' }],
  [['dk', 'dnk', 'denmark', 'dänemark'], { name: 'Denmark', code: 'DK' }],
  [['se', 'swe', 'sweden', 'schweden'], { name: 'Sweden', code: 'SE' }],
  [['no', 'nor', 'norway', 'norwegen'], { name: 'Norway', code: 'NO' }],
  [['fi', 'fin', 'finland', 'finnland'], { name: 'Finland', code: 'FI' }],
  [['pl', 'pol', 'poland', 'polen'], { name: 'Poland', code: 'PL' }],
  [['cz', 'cze', 'czechia', 'czech republic', 'tschechien'], { name: 'Czechia', code: 'CZ' }],
  [['sk', 'svk', 'slovakia', 'slowakei'], { name: 'Slovakia', code: 'SK' }],
  [['hu', 'hun', 'hungary', 'ungarn'], { name: 'Hungary', code: 'HU' }],
  [['si', 'svn', 'slovenia', 'slowenien'], { name: 'Slovenia', code: 'SI' }],
  [['hr', 'hrv', 'croatia', 'kroatien'], { name: 'Croatia', code: 'HR' }],
  [['ro', 'rou', 'romania', 'rumänien'], { name: 'Romania', code: 'RO' }],
  [['bg', 'bgr', 'bulgaria', 'bulgarien'], { name: 'Bulgaria', code: 'BG' }],
  [['gr', 'grc', 'greece', 'griechenland'], { name: 'Greece', code: 'GR' }],
  [['us', 'usa', 'united states', 'vereinigte staaten'], { name: 'United States', code: 'US' }]
]

const COUNTRY_LOOKUP = new Map<string, Country>(
  COUNTRIES.flatMap(([aliases, country]) => aliases.map((alias) => [alias, country]))
)

export function isGermanStateCode(raw: string): boolean {
  return normalizeKey(raw) in GERMAN_STATES
}

/** Country by name or code ("UK", "Österreich", "AUT"), null if unknown */
export function findCountry(raw: string): Country | null {
  return COUNTRY_LOOKUP.get(normalizeKey(raw)) ?? null
}

export function countryByCode(code: string): Country | null {
  if (!code) return null
  return COUNTRIES.find(([, country]) => country.code === code)?.[1] ?? null
}

export interface Region {
  state: string
  country: Country | null
}

/**
 * A Land cell: German state code ("NRW" → Nordrhein-Westfalen, Germany) when
 * the column holds states, otherwise a country ("UK" → United Kingdom). An
 * unknown country is kept as written, without code.
 */
export function parseRegion(raw: string, stateColumn: boolean): Region {
  const text = cleanText(raw)
  if (!text) return { state: '', country: null }
  if (stateColumn && isGermanStateCode(text)) {
    return { state: GERMAN_STATES[normalizeKey(text)] || text, country: GERMANY }
  }
  return { state: '', country: findCountry(text) ?? { name: text, code: '' } }
}

/** German ZIP codes stored as numbers lose their leading zero ("1099") */
export function normalizeZip(raw: string, countryCode: string): string {
  const zip = cleanText(raw)
  return countryCode === 'DE' && /^\d{4}$/.test(zip) ? `0${zip}` : zip
}
