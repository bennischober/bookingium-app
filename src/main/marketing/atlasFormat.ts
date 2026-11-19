// Marketing-Atlas files: what the import understands. Pure (no Node, no Electron), unit tested.
//
// Accepted, all as data only (nothing in a file is ever run):
// 1. Bookingium's own format: { "format": "bookingium-marketing-atlas", "version": 1, ... }
// 2. An atlas object with `items` (and optionally meta, tabs, facts, refs, runs, excluded)
// 3. A bare array of items (an atlas page's data/atlas.json)
// 4. An atlas page (HTML) that holds 1–3 as JSON: `<script type="application/json"
//    id="bookingium-atlas">`, or a `DATA=` / `ATLAS_JSON=` assignment followed by JSON

import {
  MarketingCategory,
  type MarketingPriority,
  type MarketingQuality
} from '../api/schemas/marketing.schema'

export const ATLAS_FORMAT = 'bookingium-marketing-atlas'

export type AtlasItem = {
  category: MarketingCategory
  group: string
  name: string
  country: string
  type: string
  priority: MarketingPriority
  reason: string
  approach: string
  timing: string
  quality: MarketingQuality
  url: string
  contact: { email: string; url: string; note: string }
  activeNote: string
}

export type Atlas = {
  band: string
  stand: string
  run: number | null
  lead: string
  facts: Array<[string, string]>
  refs: string[]
  tabs: Array<{ id: string; label: string; lead: string }>
  runs: Array<{ run: number | null; date: string; text: string }>
  excluded: Array<{ name: string; category: string; reason: string }>
  items: AtlasItem[]
}

type Json = Record<string, unknown>

const str = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''

const first = (object: Json, ...keys: string[]): string => {
  for (const key of keys) {
    const value = str(object[key])
    if (value) return value
  }
  return ''
}

/** Tab ids and labels of the atlas pages → the categories */
const CATEGORY_ALIASES: Record<string, MarketingCategory> = {
  radio: 'radios',
  radios: 'radios',
  podcast: 'podcasts',
  podcasts: 'podcasts',
  presse: 'presse',
  press: 'presse',
  'presse und blogs': 'presse',
  social: 'social',
  'social und creator': 'social',
  festival: 'festivals',
  festivals: 'festivals',
  clubs: 'clubs',
  club: 'clubs',
  venues: 'clubs',
  'clubs und venues': 'clubs',
  kanaele: 'kanaele',
  mehr: 'kanaele',
  'weitere kanäle': 'kanaele',
  sync: 'sync',
  'sync, film, gaming': 'sync',
  inspiration: 'inspiration',
  ideen: 'inspiration',
  ausland: 'ausland',
  auslandsmärkte: 'ausland'
}

export function categoryOf(value: string): MarketingCategory | null {
  const key = value.trim().toLowerCase()
  if ((MarketingCategory.options as readonly string[]).includes(key))
    return key as MarketingCategory
  return CATEGORY_ALIASES[key] ?? null
}

const PRIORITIES = new Set(['A', 'B', 'C'])
const QUALITIES = new Set(['b', 'w', 'i'])

/** One item in any of the accepted spellings; null when it has no name or no known tab */
export function normalizeItem(raw: unknown, fallbackCategory = ''): AtlasItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Json
  const name = first(o, 'name', 'n')
  const category = categoryOf(first(o, 'category', 'tab') || fallbackCategory)
  if (!name || !category) return null
  const priority = first(o, 'priority', 'prio').toUpperCase()
  const quality = first(o, 'quality', 'q').toLowerCase()
  const contact = (o.contact && typeof o.contact === 'object' ? o.contact : {}) as Json
  return {
    category,
    group: first(o, 'group', 'grp', 'kat'),
    name,
    country: first(o, 'country', 'land'),
    type: first(o, 'type', 'typ'),
    priority: (PRIORITIES.has(priority) ? priority : 'C') as MarketingPriority,
    reason: first(o, 'reason', 'why'),
    approach: first(o, 'approach', 'weg'),
    timing: first(o, 'timing', 'zeit', 'when'),
    quality: (QUALITIES.has(quality) ? quality : 'w') as MarketingQuality,
    url: safeUrl(first(o, 'url', 'sourceUrl', 'u')),
    contact: {
      email: first(contact, 'email'),
      url: safeUrl(first(contact, 'url')),
      note: first(contact, 'note')
    },
    activeNote: first(o, 'activeNote', 'aktiv')
  }
}

/** Only web links; anything else (javascript:, file:) is dropped */
function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : ''
}

function pairs(value: unknown): Array<[string, string]> {
  if (!Array.isArray(value)) return []
  return value
    .filter((p): p is unknown[] => Array.isArray(p) && p.length >= 2)
    .map((p) => [str(p[0]), str(p[1])] as [string, string])
    .filter(([k, v]) => k && v)
}

/** An atlas from the JSON value of a file (formats 1–3) */
export function atlasFromJson(value: unknown): Atlas {
  if (Array.isArray(value)) value = { items: value }
  if (!value || typeof value !== 'object')
    throw new Error('Die Datei enthält keinen Marketing-Atlas.')
  const o = value as Json
  const meta = (o.meta && typeof o.meta === 'object' ? o.meta : o) as Json
  const items = (Array.isArray(o.items) ? o.items : [])
    .map((item) => normalizeItem(item))
    .filter((item): item is AtlasItem => item !== null)
  if (items.length === 0) throw new Error('Im Marketing-Atlas stehen keine Einträge.')
  const runNumber = Number(meta.run ?? meta.lauf)
  return {
    band: first(o, 'band') || first(meta, 'band'),
    stand: first(meta, 'stand'),
    run: Number.isFinite(runNumber) && runNumber > 0 ? runNumber : null,
    lead: first(meta, 'lead'),
    facts: pairs(o.facts),
    refs: (Array.isArray(o.refs) ? o.refs : []).map(str).filter(Boolean),
    tabs: (Array.isArray(o.tabs) ? o.tabs : [])
      .filter((t): t is Json => !!t && typeof t === 'object')
      .map((t) => ({ id: first(t, 'id'), label: first(t, 'label'), lead: first(t, 'lead') }))
      .filter((t) => t.id && t.id !== 'uebersicht'),
    runs: (Array.isArray(o.runs) ? o.runs : [])
      .filter((r): r is Json => !!r && typeof r === 'object')
      .map((r) => {
        const n = Number(r.run ?? r.lauf)
        return {
          run: Number.isFinite(n) && n > 0 ? n : null,
          date: first(r, 'date', 'datum'),
          text: first(r, 'text', 'note')
        }
      })
      .filter((r) => r.text),
    excluded: (Array.isArray(o.excluded) ? o.excluded : [])
      .filter((x): x is Json => !!x && typeof x === 'object')
      .map((x) => ({
        name: first(x, 'name', 'n'),
        category: first(x, 'category', 'tab'),
        reason: first(x, 'reason', 'grund', 'why')
      }))
      .filter((x) => x.name),
    items
  }
}

/** The JSON text that starts at `start` ("{" or "["), with strings and nesting respected */
export function balancedJson(text: string, start: number): string | null {
  const open = text[start]
  if (open !== '{' && open !== '[') return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** The atlas in a file's text: JSON, or an atlas page that carries it as JSON */
export function parseAtlasText(text: string): Atlas {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return atlasFromJson(JSON.parse(trimmed))

  const tag = /<script[^>]*id=["']bookingium-atlas["'][^>]*>([\s\S]*?)<\/script>/i.exec(trimmed)
  if (tag) return atlasFromJson(JSON.parse(tag[1]))
  for (const match of trimmed.matchAll(/\b(?:DATA|ATLAS_JSON)\s*=\s*/g)) {
    const json = balancedJson(trimmed, (match.index ?? 0) + match[0].length)
    if (!json) continue
    try {
      return atlasFromJson(JSON.parse(json))
    } catch {
      // not JSON (a script variable of another kind); try the next one
    }
  }
  throw new Error(
    'In dieser Datei steht kein lesbarer Marketing-Atlas. Bitte die Bookingium-Datei des Atlas (.json) wählen.'
  )
}

/** The same entry in the next atlas: category + name without case and punctuation */
export function itemKey(item: Pick<AtlasItem, 'category' | 'name'>): string {
  const name = item.name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  return `${item.category}:${name}`
}

/** Which kind of address-book record an entry of the category becomes, if any */
export function contactKindOf(category: MarketingCategory): 'media' | 'venue' | 'festival' | null {
  if (category === 'radios' || category === 'podcasts' || category === 'presse') return 'media'
  if (category === 'clubs') return 'venue'
  if (category === 'festivals') return 'festival'
  return null
}
