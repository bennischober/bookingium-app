// ========================================
// Reading single values of a label copy (#289)
// ========================================
// Pure. Label copies are typed by hand in many hands: dates in three notations, durations as
// times of day, names in one cell separated by commas, "-" or "…" for "nothing".
import { excelSerialToDate } from '../../import/xlsx'
import type { ContributorInput, WorkRole, WorkShareInput } from '../../api/schemas/release.schema'
import { normalizeCode, parseDuration } from '../codes'

/** A placeholder means nothing: "", "-", "–", "…", "....", "n/a", "tbc" */
export function clean(value: string | undefined | null): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (/^[-–—.…?]*$/.test(text) || /^(n\/?a|tbc|tba|tbd|none|keine?)$/i.test(text)) return ''
  return text
}

/** Lower case, accents and punctuation removed: to match names and titles */
export function keyText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Legal forms and trade words that a label's name carries in one place and not in another */
const COMPANY_NOISE =
  /\b(gmbh|mbh|ag|kg|ohg|ug|e ?k|gbr|co|ltd|limited|llc|inc|corp|corporation|sa|sarl|srl|bv|nv|ab|as|oy|handels(gesellschaft)?|haftungsbeschraenkt)\b/g

/** "Napalm Records Handels GmbH" and "Napalm Records" -> the same key */
export function companyNameKey(name: string): string {
  return keyText(name).replace(COMPANY_NOISE, ' ').replace(/\s+/g, ' ').trim()
}

/** How tracks are matched: by ISRC, else by title */
export function trackKey(isrc: string, title: string): string {
  const code = normalizeCode(isrc)
  return code ? `isrc:${code}` : `title:${keyText(title)}`
}

/**
 * A date as ISO "YYYY-MM-DD": "02.10.2026", "2.10.26", "2026-10-02", "10/02/2026" (US, as
 * the English reports write it) or an Excel serial ("46297"). null when it is none.
 */
export function parseLooseDate(value: string): string | null {
  const text = clean(value)
  if (!text) return null
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text)
  if (match) return iso(Number(match[1]), Number(match[2]), Number(match[3]))
  match = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(text)
  if (match) return iso(year(match[3]), Number(match[2]), Number(match[1]))
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text)
  if (match) return iso(year(match[3]), Number(match[1]), Number(match[2]))
  if (/^\d{5}$/.test(text)) {
    const german = excelSerialToDate(Number(text))
    return parseLooseDate(german)
  }
  return null
}

function year(text: string): number {
  return text.length === 2 ? 2000 + Number(text) : Number(text)
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Longest plausible track: 20 minutes */
const LONGEST_TRACK = 20 * 60

/**
 * A track's duration in seconds. A cell may hold "3:22", "0:03:22", a fraction of a day
 * ("0,1159…" or a time "2:47" meant as minutes:seconds but stored as hours:minutes). A value
 * longer than any track that reads well one unit down is taken as that, and `shifted` says so.
 */
export function parseTrackDuration(value: string): { seconds: number | null; shifted: boolean } {
  const text = clean(value)
  if (!text) return { seconds: null, shifted: false }
  let seconds: number | null | undefined
  const fraction = /^0?[.,]\d+$/.test(text) ? Number(text.replace(',', '.')) : null
  if (fraction !== null) seconds = Math.round(fraction * 86_400)
  else seconds = parseDuration(text)
  if (seconds === undefined || seconds === null) return { seconds: null, shifted: false }
  if (seconds > LONGEST_TRACK && seconds % 60 === 0 && seconds / 60 <= LONGEST_TRACK)
    return { seconds: seconds / 60, shifted: true }
  if (fraction !== null && seconds > LONGEST_TRACK) {
    // hours:minutes with leftover seconds from float noise
    const asMinutes = Math.round(fraction * 1440)
    if (asMinutes <= LONGEST_TRACK) return { seconds: asMinutes, shifted: true }
  }
  return { seconds, shifted: false }
}

/** "A, B; C & D" -> ["A", "B", "C", "D"]; empty parts and placeholders are dropped */
export function splitNames(value: string): string[] {
  return value
    .split(/\s*[,;\n]\s*|\s+&\s+|\s+und\s+|\s+and\s+/i)
    .map(clean)
    .filter(Boolean)
}

/**
 * Writers in one cell, with their share if it is named: "A/B", "A (50%); B (50%)", "A, B & C"
 * -> [{ name: "A", percent: 50 }, …]
 */
export function splitWriters(value: string): Array<{ name: string; percent: number | null }> {
  return value
    .split(/\s*[,;/\n]\s*|\s+&\s+|\s+und\s+|\s+and\s+/i)
    .map((part) => {
      const share = /\(\s*(\d{1,3}(?:[.,]\d+)?)\s*%\s*\)/.exec(part)
      return {
        name: clean(part.replace(/\(\s*\d{1,3}(?:[.,]\d+)?\s*%\s*\)/, '')),
        percent: share ? parsePercent(share[1]) : null
      }
    })
    .filter((writer) => writer.name)
}

/** A share as "25.0%", "25,5 %" or "25" -> number; null when there is none */
export function parsePercent(value: string): number | null {
  const text = clean(value).replace('%', '').trim()
  if (!text) return null
  const number = Number(text.replace(',', '.'))
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null
}

/** A count ("25", "1") or null */
export function parseCount(value: string): number | null {
  const text = clean(value)
  return /^\d+$/.test(text) && Number(text) > 0 ? Number(text) : null
}

/** An amount ("1.500 €", "1500,50", "€ 300") in cents, or null */
export function parseAmountCents(value: string): number | null {
  const compact = clean(value).replace(/[\s€$£]|EUR|USD/gi, '')
  if (!compact) return null
  const normalized = compact.includes(',')
    ? compact.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+$/.test(compact)
      ? compact.replace(/\./g, '')
      : compact
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  return Math.round(Number(normalized) * 100)
}

/** A yes/no cell: x, yes, ja, true, ✓ … true; no, nein, clean … false; anything else null */
export function parseFlag(value: string): boolean | null {
  const text = clean(value).toLowerCase()
  if (!text) return null
  if (/^(x|y|yes|ja|j|true|wahr|1|✓|✔|explicit|done|erledigt)$/.test(text)) return true
  if (/^(n|no|nein|false|falsch|0|clean|offen|open)$/.test(text)) return false
  return null
}

/** The part someone has in a work, from a label copy's word for it */
export function workRoles(value: string): WorkRole[] {
  const text = value.toLowerCase()
  const roles: WorkRole[] = []
  if (/lyric|writer|text|author|autor|words/.test(text)) roles.push('lyricist')
  if (/compos|komponi|music|musik/.test(text)) roles.push('composer')
  if (/arrang|bearbeit/.test(text)) roles.push('arranger')
  return roles.length > 0 ? roles : ['other']
}

/** "Primary" -> "Primary Artist", "Featuring" -> "Featured Artist"; other roles as written */
export function contributorRole(value: string): string {
  const text = clean(value)
  if (/^primary( artist)?$/i.test(text) || /^main( artist)?$/i.test(text)) return 'Primary Artist'
  if (/^feat(uring|ured)?( artist)?$/i.test(text)) return 'Featured Artist'
  return text
}

export function contributor(name: string, role: string, instrument = ''): ContributorInput {
  return { name, role, instrument, personId: null }
}

export function workShare(
  name: string,
  role: WorkRole,
  over: Partial<WorkShareInput> = {}
): WorkShareInput {
  return {
    name,
    role,
    sharePercent: null,
    society: '',
    ipi: '',
    publisher: '',
    country: '',
    personId: null,
    ...over
  }
}

/** The release type a product's or configuration's name points to */
export function releaseTypeOf(text: string): 'album' | 'ep' | 'single' | 'compilation' | null {
  const value = text.toLowerCase()
  if (/single|igt|instant grat/.test(value)) return 'single'
  if (/\bep\b/.test(value)) return 'ep'
  if (/compil|sampler/.test(value)) return 'compilation'
  if (/album|\blp\b/.test(value)) return 'album'
  return null
}

/** The product format a sheet's or configuration's name points to */
export function formatOf(text: string): 'digital' | 'cd' | 'vinyl' | 'cassette' | 'other' {
  const value = text.toLowerCase()
  if (/vinyl|\blp\b|7"|7 inch|10"|12"/.test(value)) return 'vinyl'
  if (/digital|download|stream/.test(value)) return 'digital'
  if (/cassette|kassette|\bmc\b|tape/.test(value)) return 'cassette'
  if (/\bcd\b|digipa[ck]|jewel|physical|mediabook|ecopak/.test(value)) return 'cd'
  return 'other'
}
