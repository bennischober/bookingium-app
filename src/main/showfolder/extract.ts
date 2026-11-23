// What the files of a show folder (the booking agency's Dropbox folder per show) say: the kind
// of each file and the facts in it - the day's times, the venue's data, the hotel, ticket prices,
// contacts and the deal. The sheets are never laid out the same way, so everything is found by
// labels (German and English), line by line; whatever is not found is simply not suggested.
// Pure: no Electron, no Node, no database (tests/show_folder_extract.test.ts).

import { toCents } from '../einvoice/amounts'
import { cleanText } from '../import/normalize'
import { t } from '../i18n/translate'
import type { ContractPartyFact } from './contractParty'
import type { OwnInvoiceFact } from './ownInvoice'

export const SHOW_FILE_KINDS = [
  'daysheet',
  'venue_spec',
  'stage_plot',
  'contract',
  'settlement',
  'mail',
  'permit',
  'rider',
  // #262 archive import: an invoice we wrote, and travel papers (never filed, never read)
  'invoice',
  'travel',
  'duplicate',
  'other'
] as const
export type ShowFileKind = (typeof SHOW_FILE_KINDS)[number]

export const SHOW_FILE_KIND_LABELS: Record<ShowFileKind, string> = {
  daysheet: t('Day-/Infosheet'),
  venue_spec: t('Club-/Festival-Infos / Technik'),
  stage_plot: t('Bühnen- / Lichtplan'),
  contract: t('Vertrag'),
  settlement: t('Abrechnung'),
  mail: t('E-Mail'),
  permit: t('Genehmigung'),
  rider: t('Rider'),
  invoice: t('Rechnung'),
  travel: t('Reiseunterlagen (nicht abgelegt)'),
  duplicate: t('Doppelt (gleiche Datei als PDF)'),
  other: t('Sonstiges')
}

/** The itinerary fields a sheet can fill (itinerary table, HH:MM; showLength in minutes) */
export const ITINERARY_KEYS = [
  'getIn',
  'loadIn',
  'soundCheckMainAct',
  'soundCheckSupport',
  'dinner',
  'doors',
  'showTimeSupport',
  'showTimeMainAct',
  'showLength',
  'curfewStage',
  'curfewVenue'
] as const
export type ItineraryKey = (typeof ITINERARY_KEYS)[number]

export type ContactSide = 'venue' | 'band' | 'promoter' | 'unknown'

/** Club ('venue') or festival, as stored in venue.kind (VenueKind) */
export type PlaceKind = 'venue' | 'festival'

export interface ContactFact {
  /** The role as the sheet writes it ("Venue", "Booking / Production", "Local Promoter") */
  role: string
  name: string
  email: string
  phone: string
  side: ContactSide
  /** The venue's person on the day (Kontakt vor Ort) */
  onSite: boolean
}

export interface PlaceFact {
  name: string
  street: string
  zipCode: string
  city: string
}

export interface ShowFacts {
  itinerary: Partial<Record<ItineraryKey, string>>
  /** "Beginn" of a mail: the first act, used when no sheet names the show times */
  start: string
  venue: PlaceFact & {
    capacity: number | null
    merchFeeCents: number | null
    /** Facts for the venue's notes ("Bühne: 11,6 × 8,2 m", "Parken: …") */
    notes: string[]
    /** Club or festival as far as the files tell (festivalKindOf); null when they do not */
    kind: PlaceKind | null
  }
  hotel: PlaceFact & { notes: string[] }
  tickets: {
    /** Final presale price per ticket (Endpreis / VVK) */
    presaleCents: number | null
    baseCents: number | null
    extraCents: number | null
    wkzCents: number | null
  }
  deal: { guaranteeCents: number | null; text: string }
  contacts: ContactFact[]
  /** The promoter of a contract (contractParty.ts); null when no contract names one */
  promoter: ContractPartyFact | null
  /** An invoice we wrote for the show (ownInvoice.ts); null when there is none */
  invoice: OwnInvoiceFact | null
  /** The show's date as a contract names it (ISO), '' when none does */
  contractDate: string
}

export interface ShowFileInput {
  name: string
  /** The file's text; '' for a scan or a file that cannot be read */
  text: string
  /** Link targets in it (PDF link annotations, a mail's links): fix e-mails broken by ligatures */
  links: string[]
  /** The folders it lies in, nearest first ("Cruise Tickets", "70000 Tons US"); for its kind */
  dirs?: readonly string[]
}

export const emptyFacts = (): ShowFacts => ({
  itinerary: {},
  start: '',
  venue: {
    name: '',
    street: '',
    zipCode: '',
    city: '',
    capacity: null,
    merchFeeCents: null,
    notes: [],
    kind: null
  },
  hotel: { name: '', street: '', zipCode: '', city: '', notes: [] },
  tickets: { presaleCents: null, baseCents: null, extraCents: null, wkzCents: null },
  deal: { guaranteeCents: null, text: '' },
  contacts: [],
  promoter: null,
  invoice: null,
  contractDate: ''
})

// ----------------------------------------
// Text helpers
// ----------------------------------------

/** Lower case, umlauts spelled out, anything but letters and digits as one space */
export function keyOf(value: string): string {
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

/** "9 00" → "900", "1 1, 6 m" → "11,6 m": PDF fonts space digits apart */
export function joinDigits(value: string): string {
  return value.replace(/(\d)\s+(?=\d)/g, '$1').replace(/(\d)\s*,\s*(?=\d)/g, '$1,')
}

/** The lines of a text, each split at the column bars of two-column sheets ("… | …") */
export function segmentsOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line) => line.split(/\s\|\s|^\||\|$/))
    .map((segment) => cleanText(segment.replace(/^[|\s]+|[|\s]+$/g, '')))
    .filter((segment) => segment.length > 0 && !/^_+$/.test(segment))
}

const TIME = /(?<![\d,.])([01]?\d|2[0-3])[:.]([0-5]\d)(?![\d])/
const RANGE = new RegExp(
  `${TIME.source}(?:\\s*(?:-|–|—|bis)\\s*${TIME.source.replace('(?<![\\d,.])', '')})?`
)

const pad = (hour: string, minute: string): string => `${hour.padStart(2, '0')}:${minute}`

/** The first time (range) in a segment and the label in front of it */
export function timeOf(
  segment: string
): { label: string; start: string; end: string; minutes: number | null } | null {
  const match = RANGE.exec(segment)
  if (!match) return null
  const start = pad(match[1], match[2])
  const end = match[3] ? pad(match[3], match[4]) : ''
  let minutes: number | null = null
  if (end) {
    const toMin = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
    minutes = (toMin(end) - toMin(start) + 24 * 60) % (24 * 60)
  }
  return { label: keyOf(segment.slice(0, match.index)), start, end, minutes }
}

/** "19 Uhr", "19:30 Uhr" */
function uhrOf(segment: string): string {
  const match = /(?<![\d:])([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*uhr/i.exec(segment)
  return match ? pad(match[1], match[2] ?? '00') : ''
}

/** "30,00 €", "75,00€", "1.500 EUR", "2000 Euro" → cents */
export function moneyOf(value: string): number | null {
  const match = /(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,(\d{1,2}))?\s*(?:€|eur\b|euro\b)/i.exec(
    joinDigits(value).replace(/(\d),\s+(\d)/g, '$1,$2')
  )
  if (!match) return null
  const whole = Number(match[1].replace(/[.\s]/g, ''))
  const cents = match[2] ? Number(match[2].padEnd(2, '0')) : 0
  return toCents(whole + cents / 100)
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
const PHONE = /(?:\+|\b0)\d[\d ./()-]{5,}\d/

/**
 * The e-mail in a segment. PDF ligatures break some ("name@ Y pscorpio.com"): then the link
 * target with the same local part wins.
 */
export function emailOf(segment: string, links: readonly string[]): string {
  const mails = links
    .filter((link) => /^mailto:/i.test(link))
    .map((link) => decodeURIComponent(link.slice(7)).split('?')[0].trim().toLowerCase())
  const local = /([a-z0-9._%+-]+)@/i.exec(segment)?.[1]?.toLowerCase()
  if (local) {
    const linked = mails.find((mail) => mail.startsWith(`${local}@`))
    if (linked) return linked
  }
  return EMAIL.exec(segment)?.[0]?.toLowerCase() ?? ''
}

const phoneOf = (segment: string): string => {
  const match = PHONE.exec(segment.replace(EMAIL, ' '))
  return match ? cleanText(match[0]).replace(/[.]/g, ' ') : ''
}

/** "Venue: Name (new adress!!)" → "Name" */
const stripRemark = (value: string): string =>
  cleanText(value.replace(/\([^)]*\)/g, ' ').replace(/[!]+/g, ''))

/** "12345 Musterstadt" → zip and city */
function zipCity(value: string): { zipCode: string; city: string } | null {
  const match = /\b(\d{4,5})\s+([A-Za-zÄÖÜäöüß][\p{L} .-]+)/u.exec(joinDigits(value))
  return match ? { zipCode: match[1], city: cleanText(match[2]) } : null
}

/** "Label: value" → [label key, value]; null without a colon */
function labelled(segment: string): [string, string] | null {
  const match = /^([^:]{1,40}):\s*(.*)$/.exec(segment)
  return match ? [keyOf(match[1]), cleanText(match[2])] : null
}

/** A festival's own info sheet for the acts ("Artist Info", "Festival Guide", "Künstlerinfo") */
const FESTIVAL_SHEET =
  /festival ?info|festival ?guide|artist ?info|artist ?guide|artist ?handbook|kuenstler ?info|produktionsinfo|production ?info/

/** Words only a festival's papers use: the site, the artists' area, wristbands, camping */
const FESTIVAL_WORDS = [
  'festival',
  'open air',
  'openair',
  'festivalgelaende',
  'gelaende',
  'artist village',
  'artist area',
  'artist care',
  'artist relations',
  'backstage village',
  'wristband',
  'baendchen',
  'akkreditierung',
  'accreditation',
  'camping',
  'line up',
  'lineup',
  'shuttle'
]

/** Words of a club's papers: the house, the hall, the bar */
const CLUB_WORDS = ['club', 'hausinfo', 'haus info', 'halle', 'saal', 'theke', 'tresen']

/** A name that says what it is: "Muster Open Air", "Beispiel Festival", "Club Beispiel" */
export function placeKindOfName(name: string): PlaceKind | null {
  const key = keyOf(name)
  if (!key) return null
  if (/\b(festival|open ?air|openair|fest)\b|festival$|fest$/.test(key)) return 'festival'
  if (/\b(club|klub|halle|saal|bar|kneipe|keller|kantine|cafe|theater)\b/.test(key)) return 'venue'
  return null
}

/**
 * Club or festival from what a file says: a "Festival:" label or a name that says so decides,
 * else the festival words have to clearly outweigh the club words (two more at least)
 */
export function placeKindOfText(text: string): PlaceKind | null {
  const key = ` ${keyOf(text.slice(0, 20000))} `
  const count = (words: readonly string[]) =>
    words.filter((word) => key.includes(` ${word} `)).length
  const festival = count(FESTIVAL_WORDS)
  const club = count(CLUB_WORDS)
  if (festival >= club + 2) return 'festival'
  if (club >= festival + 2) return 'venue'
  return null
}

/** Roles of the venue's person on the day */
const ON_SITE = /vor ort|\bvenue\b|day of show|on site|local contact|\bdos\b/

const startsWithAny = (key: string, words: readonly string[]): boolean =>
  words.some((word) => key === word || key.startsWith(`${word} `))

// ----------------------------------------
// The kind of a file
// ----------------------------------------

const extensionOf = (name: string): string => name.split('.').pop()?.toLowerCase() ?? ''
const baseOf = (name: string): string => name.replace(/\.[^.]+$/, '').toLowerCase()

const TRAVEL_NAME =
  /reisepass|passport|\besta\b|\bvisa\b|visum|boarding|bordkarte|flugticket|\bflight\b|buchungsbestaetigung|booking confirmation|passenger|passagier|cruise ticket|ticket contract|crew daten|\bcbp\b|customs|\bzoll\b/
const TRAVEL_DIR =
  /flugticket|\bflug\b|cruise tickets?|passenger|passport|reisepass|\bvisa\b|\besta\b/

/**
 * What a file is, from its name and text. `siblings` are the other names of the folder: a Pages
 * or Word file next to a PDF of the same name is the same sheet twice.
 */
export function classifyShowFile(file: ShowFileInput, siblings: readonly string[]): ShowFileKind {
  const extension = extensionOf(file.name)
  const name = keyOf(file.name)
  const text = keyOf(file.text.slice(0, 4000))
  // travel papers: passports, visa/ESTA, flight and cruise tickets, passenger lists, customs
  const dirs = (file.dirs ?? []).map(keyOf).join(' ')
  if (TRAVEL_NAME.test(name) || TRAVEL_DIR.test(dirs)) return 'travel'
  if (['eml'].includes(extension)) return 'mail'
  if (['pages', 'numbers', 'key', 'docx', 'doc', 'odt'].includes(extension)) {
    const hasPdf = siblings.some(
      (other) =>
        other !== file.name && extensionOf(other) === 'pdf' && baseOf(other) === baseOf(file.name)
    )
    if (hasPdf) return 'duplicate'
  }
  const has = (pattern: RegExp) => pattern.test(name) || pattern.test(text)
  if (extension === 'xlsx' && /konzertabrechnung|abrechnung|settlement/.test(`${name} ${text}`))
    return 'settlement'
  if (/day ?sheet|info ?sheet|laufzettel|tagesablauf|itinerary|running order/.test(name))
    return 'daysheet'
  if (/venue spec|venue info|technical spec|hausinfo|haus info|specifications|tech spec/.test(name))
    return 'venue_spec'
  if (FESTIVAL_SHEET.test(name)) return 'venue_spec'
  if (/licht|light|stage ?plot|buehnenplan|lichtplot|floor ?plan/.test(name)) return 'stage_plot'
  if (/vertrag|contract|agreement|gastspiel|\boffer\b|angebot/.test(name)) return 'contract'
  if (/\brechnung\b|\binvoice\b/.test(name) || /^rechnung (nr|nummer)/.test(text)) return 'invoice'
  if (/rider/.test(name)) return 'rider'
  if (/abrechnung|settlement/.test(name)) return 'settlement'
  if (has(/haltverbot|verkehrsbehoerdlich|anordnung|genehmigung|permit|ordnungsamt/))
    return 'permit'
  // by content when the name says nothing
  const timeLabels = ['get in', 'soundcheck', 'doors', 'einlass', 'curfew', 'load in', 'dinner']
  if (timeLabels.filter((label) => text.includes(label)).length >= 3) return 'daysheet'
  if (/venue information|technical specs|stage width|main pa/.test(text)) return 'venue_spec'
  if (/festival information|artist information|artist village|kuenstlerinformation/.test(text))
    return 'venue_spec'
  if (/gastspielvertrag|konzertvertrag|vertragspartner|kuenstler|engagement/.test(text))
    return 'contract'
  return 'other'
}

// ----------------------------------------
// Facts
// ----------------------------------------

const IGNORED_TIME_LABELS = [
  'change over',
  'changeover',
  'umbau',
  'load out',
  'abbau',
  'abfahrt',
  'departure',
  'get together',
  'meet greet',
  'meet and greet',
  'check in',
  'check out',
  'checkout',
  'checkin',
  'ankunft',
  'arrival',
  'fahrzeit'
]

/** The band's words in a label, so "Get In Beispielband" is the main act's get in */
function mentions(label: string, bandKey: string): boolean {
  return bandKey.length > 0 && ` ${label} `.includes(` ${bandKey} `)
}

/**
 * One time of a sheet into the itinerary. `bandKey` is the event's band (the main act); another
 * name in the label is the support.
 */
function readTime(facts: ShowFacts, segment: string, bandKey: string): void {
  const time = timeOf(segment)
  if (!time) return
  const label = time.label
  if (!label || IGNORED_TIME_LABELS.some((word) => label.includes(word))) return
  const main = mentions(label, bandKey)
  const rest = cleanText(` ${label} `.replace(` ${bandKey} `, ' '))
  const set = (key: ItineraryKey, value: string) => {
    if (value && !facts.itinerary[key]) facts.itinerary[key] = value
  }
  const other = !main && /[a-z]{3,}/.test(rest)

  if (/\bget ?in\b|\bget-in\b|\baufbau\b/.test(label)) {
    if (main || !/[a-z]{3,}/.test(rest.replace(/get ?in|aufbau/g, ''))) set('getIn', time.start)
    return
  }
  if (/\bload ?in\b|\bladen\b/.test(label)) return set('loadIn', time.start)
  if (/sound ?check|line ?check/.test(label)) {
    const named = /[a-z]{3,}/.test(rest.replace(/sound ?check|line ?check/g, ''))
    if (main || !named) set('soundCheckMainAct', time.start)
    else set('soundCheckSupport', time.start)
    return
  }
  if (/\bdinner\b|\babendessen\b|\bcatering\b|\bessen\b/.test(label))
    return set('dinner', time.start)
  if (/\bdoors\b|\beinlass\b|\bdoor\b/.test(label)) return set('doors', time.start)
  if (/curfew|sperrstunde|sperrzeit/.test(label)) {
    if (/\bstage\b|\bbuehne\b/.test(label)) set('curfewStage', time.start)
    else set('curfewVenue', time.start)
    return
  }
  if (/\bbeginn\b|\bstart\b/.test(label) && !main) {
    if (!facts.start) facts.start = time.start
    return
  }
  // a show line: "Show Beispielband 21:15 - 22:45", "Beispielband 21:15 - 22:45"
  const showWords = rest.replace(/\b(show|konzert|auftritt|set|live)\b/g, '').trim()
  if (main && showWords === '') {
    set('showTimeMainAct', time.start)
    if (time.minutes) set('showLength', String(time.minutes))
    return
  }
  if (other && time.end && /^[a-z0-9 ]+$/.test(showWords) && showWords.split(' ').length <= 4) {
    set('showTimeSupport', time.start)
  }
}

const STAGE_LABELS: Record<string, string> = {
  width: 'Breite',
  depth: 'Tiefe',
  height: 'Höhe',
  'stage clearance': 'lichte Höhe',
  breite: 'Breite',
  tiefe: 'Tiefe',
  hoehe: 'Höhe'
}

/** Side of a contact from its role (and the kind of file it is in) */
function sideOf(role: string, kind: ShowFileKind, bandKey: string): ContactSide {
  const key = keyOf(role)
  if (/promoter|veranstalter|lopro|local promoter|ticketing/.test(key)) return 'promoter'
  if (
    /tour ?manager|\btm\b|advancing|management|crew|foh|licht|merch|backline/.test(key) ||
    mentions(key, bandKey)
  )
    return 'band'
  if (
    /venue|club|festival|artist care|artist relations|artist liaison|gelaende|\bsite\b|stage manager|vor ort|production|produktion|booking|haus|halle|technik|executive|director|event/.test(
      key
    )
  )
    return 'venue'
  return kind === 'venue_spec' ? 'venue' : 'unknown'
}

/** "Elisa Beispiel", the words before a phone or an e-mail */
function nameOf(raw: string): string {
  const value = raw.replace(/[<>"]/g, ' ')
  const cut = value.split(/\s[-–]\s|(?=\+?\d[\d ]{5,})|[\w.%+-]+@/)[0] ?? ''
  const words = cleanText(cut.replace(/[,;]/g, ' ')).split(' ')
  const name = words.filter((word) => /^[\p{Lu}][\p{L}'.-]*$/u.test(word))
  return name.length >= 2 && name.length === words.length ? name.join(' ') : ''
}

function addContact(facts: ShowFacts, contact: ContactFact): void {
  if (!contact.name || (!contact.email && !contact.phone)) return
  const same = facts.contacts.find(
    (other) =>
      keyOf(other.name) === keyOf(contact.name) ||
      (contact.email !== '' && other.email === contact.email)
  )
  if (same) {
    same.email ||= contact.email
    same.phone ||= contact.phone
    if (same.side === 'unknown') same.side = contact.side
    same.onSite ||= contact.onSite
    return
  }
  facts.contacts.push(contact)
}

/** The value in the next lines after a label line (mail tables: label, then value) */
function moneyAfter(segments: string[], labels: string[]): number | null {
  for (let index = 0; index < segments.length; index++) {
    const key = keyOf(segments[index])
    if (!labels.some((label) => key === label || key.startsWith(`${label} `))) continue
    const own = moneyOf(segments[index])
    if (own !== null) return own
    for (let next = index + 1; next < Math.min(segments.length, index + 4); next++) {
      const value = moneyOf(segments[next])
      if (value !== null) return value
      if (/^[\p{L}]/u.test(segments[next]) && !/^\d/.test(segments[next])) {
        // another label ("VVK (10%)") may come first; percent lines are skipped
        if (!/%/.test(segments[next])) continue
      }
    }
  }
  return null
}

/** The facts of one file; `bandName` is the event's band (the main act) */
export function extractShowFacts(
  file: ShowFileInput,
  kind: ShowFileKind,
  bandName: string
): ShowFacts {
  const facts = emptyFacts()
  if (!file.text.trim()) return facts
  const bandKey = keyOf(bandName)
  const segments = segmentsOf(file.text)
  let section: 'main' | 'hotel' | 'contacts' | 'stage' = 'main'
  let pendingRole = ''

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    const key = keyOf(segment)
    const pair = labelled(segment)

    // sections
    if (/^hotel\s*:/i.test(segment)) {
      section = 'hotel'
      facts.hotel.name = stripRemark(segment.replace(/^hotel\s*:/i, ''))
      continue
    }
    if (/^(contacts?|kontakte?|ansprechpartner)\s*:?$/i.test(segment)) {
      section = 'contacts'
      continue
    }
    if (/^(additional information|sonstiges|weitere infos?|notes?)\s*:?/i.test(segment)) {
      section = 'main'
    }
    if (kind === 'venue_spec' && key === 'stage') {
      section = 'stage'
      continue
    }

    // times (sheets and mails)
    if (kind === 'daysheet' || kind === 'mail' || kind === 'other') {
      if (section !== 'hotel' && TIME.test(segment)) readTime(facts, segment, bandKey)
      if (kind === 'mail') {
        const uhr = uhrOf(segment)
        if (uhr && /einlass|doors/.test(key) && !facts.itinerary.doors) facts.itinerary.doors = uhr
        if (uhr && /beginn|start/.test(key) && !facts.start) facts.start = uhr
      }
    }

    // places
    const target = section === 'hotel' ? facts.hotel : facts.venue
    if (pair) {
      const [label, value] = pair
      if (
        section !== 'hotel' &&
        startsWithAny(label, [
          'venue',
          'club',
          'location',
          'spielstaette',
          'festival',
          'festivalgelaende',
          'veranstaltungsort',
          'spielort',
          'auffuehrungsort'
        ]) &&
        value &&
        !/http/.test(value)
      ) {
        facts.venue.name ||= stripRemark(value)
        if (startsWithAny(label, ['festival', 'festivalgelaende'])) facts.venue.kind ??= 'festival'
        else if (startsWithAny(label, ['club'])) facts.venue.kind ??= 'venue'
      } else if (startsWithAny(label, ['street', 'strasse', 'str', 'adresse', 'address'])) {
        target.street ||= stripRemark(value)
      } else if (
        startsWithAny(label, ['town', 'stadt', 'ort', 'city', 'plz ort', 'zip code city'])
      ) {
        const place = zipCity(value)
        if (place && !target.zipCode) Object.assign(target, place)
      } else if (
        section === 'hotel' &&
        /zimmer|rooms|check in|frueh|breakfast|entfernung|distance/.test(label)
      ) {
        facts.hotel.notes.push(`${segment.split(':')[0].trim()}: ${value}`)
      }
    }
    if (kind === 'venue_spec') {
      const spec = /^(name|address|zip ?code\s*\/?\s*city|plz\s*\/?\s*ort|capacity)\s+(.+)$/i.exec(
        segment
      )
      if (spec) {
        const label = keyOf(spec[1])
        if (label === 'name') facts.venue.name ||= stripRemark(spec[2])
        if (label === 'address') facts.venue.street ||= stripRemark(spec[2])
        if (/^(zip ?code city|plz ort)$/.test(label)) {
          const place = zipCity(spec[2])
          if (place && !facts.venue.zipCode) Object.assign(facts.venue, place)
        }
      }
    }

    // capacity, merch fee
    const capacity = /(kapazit(?:ae|ä)t|capacity)\D{0,40}?(\d[\d .]*\d|\d)/i.exec(segment)
    if (
      capacity &&
      facts.venue.capacity === null &&
      !/seat/i.test(segment.slice(0, capacity.index + 12))
    ) {
      const value = Number(capacity[2].replace(/[ .]/g, ''))
      if (value >= 20 && value <= 200000) facts.venue.capacity = value
    }
    if (/merch\w*\s*fee|merchfee|merchandise fee|merchandising/i.test(segment)) {
      const fee = moneyOf(segment)
      if (fee !== null && facts.venue.merchFeeCents === null) facts.venue.merchFeeCents = fee
    }

    // venue notes from a spec sheet
    if (kind === 'venue_spec') {
      if (section === 'stage') {
        const dim = /^(width|depth|height|stage clearance|breite|tiefe|hoehe)\s+(.+)$/i.exec(
          joinDigits(segment)
        )
        if (dim) {
          const label = STAGE_LABELS[keyOf(dim[1])] ?? dim[1]
          facts.venue.notes.push(`Bühne, ${label}: ${cleanText(dim[2])}`)
        } else if (/^(rigging|backdrop)/i.test(segment)) facts.venue.notes.push(cleanText(segment))
        else section = 'main'
      }
      if (/permit required|genehmigung erforderlich|parkgenehmigung/i.test(segment))
        facts.venue.notes.push(`Parken: ${cleanText(segment)}`)
      if (/^soundlimits?\s|^lautst/i.test(segment)) facts.venue.notes.push(cleanText(segment))
      if (/^curfew\s+/i.test(segment)) facts.venue.notes.push(cleanText(segment))
    }

    // contacts
    const email = emailOf(segment, file.links)
    const phone = phoneOf(segment)
    if (pair && (email || phone)) {
      const [label, value] = pair
      if (!/^(mail|e mail|email|phone|tel|telefon|fon|mobil|ph|fax)$/.test(label)) {
        const name = nameOf(value)
        const role = segment.split(':')[0].trim()
        const side = label === 'von' || label === 'from' ? 'unknown' : sideOf(role, kind, bandKey)
        if (name)
          addContact(facts, {
            role,
            name,
            email,
            phone,
            side,
            onSite: side === 'venue' && ON_SITE.test(keyOf(role))
          })
      }
    }
    // spec sheets: "Booking / Production :" then the name, then mail and phone lines
    if (pair && pair[1] === '' && !email && !phone) {
      pendingRole = segment.replace(/:\s*$/, '').trim()
      continue
    }
    if (pendingRole) {
      const name = nameOf(segment)
      if (name) {
        let mail = ''
        let tel = ''
        // the mail and phone lines right below, up to the next role or name
        for (let next = index + 1; next < Math.min(segments.length, index + 4); next++) {
          const line = segments[next]
          if (/^(mail|e-?mail)\s*:/i.test(line)) mail ||= emailOf(line, file.links)
          else if (/^(phone|tel|telefon|fon|mobil)\s*:/i.test(line)) tel ||= phoneOf(line)
          else break
        }
        const side = sideOf(pendingRole, kind, bandKey)
        addContact(facts, {
          role: pendingRole,
          name,
          email: mail,
          phone: tel,
          side,
          onSite: side === 'venue' && ON_SITE.test(keyOf(pendingRole))
        })
      }
      pendingRole = ''
    }
  }

  // a mail's sender: the signature says the role ("Local Promoter") and the phone
  if (kind === 'mail') {
    const sender = facts.contacts.find((contact) => contact.role.toLowerCase() === 'von')
    if (sender) {
      // the name again below the header line: the start of the signature
      const at = file.text.indexOf(sender.name, file.text.indexOf('\n'))
      const signature = at >= 0 ? file.text.slice(at, at + 600) : ''
      const role = /local promoter|promoter|veranstalter|booking|agentur|agency|management/i.exec(
        signature
      )
      if (role) {
        sender.role = cleanText(role[0])
        sender.side = sideOf(role[0], kind, bandKey)
      }
      const tel = /(?:ph|tel|phone|fon|telefon)\.?\s*:?\s*(\+?[\d][\d ./-]{6,}\d)/i.exec(signature)
      if (tel && !sender.phone) sender.phone = cleanText(tel[1]).replace(/\./g, ' ')
    }
  }

  // ticket prices (agency mails: label line, value line)
  if (kind === 'mail' || kind === 'other' || kind === 'contract') {
    facts.tickets.presaleCents = moneyAfter(segments, ['endpreis', 'vvk preis', 'ticketpreis'])
    facts.tickets.baseCents = moneyAfter(segments, ['grundpreis'])
    facts.tickets.extraCents = moneyAfter(segments, ['ausgleichsgebuehr'])
    facts.tickets.wkzCents = moneyAfter(segments, ['wkz', 'wkz an band'])
  }

  // the deal of a contract
  if (kind === 'contract') {
    const text = joinDigits(file.text)
    const guarantee =
      /(garantie\w*|festgage|mindestgage|guarantee|gage|fee)[^\n€]{0,40}?(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+)\s*(?:€|eur)/i.exec(
        text
      )
    if (guarantee) facts.deal.guaranteeCents = moneyOf(`${guarantee[2]} €`)
    const split =
      /(\d{1,3})\s*%\s*(?:der|des|vom|of the|of)?\s*([\p{L} -]{0,40}?(?:einnahmen|netto\w*|door|box ?office|ueberschuss|überschuss|gross|net))/iu.exec(
        text
      )
    const parts: string[] = []
    if (facts.deal.guaranteeCents !== null)
      parts.push(`Garantie ${(facts.deal.guaranteeCents / 100).toLocaleString('de-DE')} €`)
    if (split) parts.push(`${split[1]} % ${cleanText(split[2])}`)
    facts.deal.text = parts.join(' vs. ')
  }
  facts.venue.kind ??= placeKindOfName(facts.venue.name) ?? placeKindOfText(file.text)
  return facts
}

/**
 * The facts of all files into one: each value from the first file that has it, in the order
 * day sheets, venue sheets, mails, the rest - the agency's own sheet is the most current.
 */
export function mergeShowFacts(
  items: ReadonlyArray<{ kind: ShowFileKind; facts: ShowFacts }>
): ShowFacts {
  const order: ShowFileKind[] = ['daysheet', 'venue_spec', 'mail', 'contract', 'other', 'rider']
  const sorted = [...items].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
  const merged = emptyFacts()
  for (const { kind, facts } of sorted) {
    for (const key of ITINERARY_KEYS)
      if (!merged.itinerary[key] && facts.itinerary[key])
        merged.itinerary[key] = facts.itinerary[key]
    merged.start ||= facts.start
    // the address of a venue sheet beats the day sheet's (it is the venue's own)
    const placeKeys = ['name', 'street', 'zipCode', 'city'] as const
    for (const key of placeKeys) {
      if (kind === 'venue_spec' && facts.venue[key] && key !== 'name')
        merged.venue[key] = facts.venue[key]
      else merged.venue[key] ||= facts.venue[key]
      merged.hotel[key] ||= facts.hotel[key]
    }
    merged.venue.kind ??= facts.venue.kind
    merged.venue.capacity ??= facts.venue.capacity
    merged.venue.merchFeeCents ??= facts.venue.merchFeeCents
    for (const note of facts.venue.notes)
      if (!merged.venue.notes.includes(note)) merged.venue.notes.push(note)
    for (const note of facts.hotel.notes)
      if (!merged.hotel.notes.includes(note)) merged.hotel.notes.push(note)
    merged.tickets.presaleCents ??= facts.tickets.presaleCents
    merged.tickets.baseCents ??= facts.tickets.baseCents
    merged.tickets.extraCents ??= facts.tickets.extraCents
    merged.tickets.wkzCents ??= facts.tickets.wkzCents
    merged.deal.guaranteeCents ??= facts.deal.guaranteeCents
    merged.deal.text ||= facts.deal.text
    merged.promoter ??= facts.promoter
    merged.invoice ??= facts.invoice
    merged.contractDate ||= facts.contractDate
    for (const contact of facts.contacts) addContact(merged, { ...contact })
  }
  // a name that says festival ("… Open Air") decides; a club-like name ("Halle …") only fills in,
  // since festivals take place in halls too
  const byName = placeKindOfName(merged.venue.name)
  merged.venue.kind = byName === 'festival' ? byName : (merged.venue.kind ?? byName)
  return merged
}
