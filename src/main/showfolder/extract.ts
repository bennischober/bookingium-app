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
import { countryCodeOfName, isPlaceholder, isStreetLine, parseAddress, zipCityOf } from './address'

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
  /** ISO code ("DE"); a five-digit zip without a country is German */
  countryCode: string
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
  /** The promoter of a contract or an info sheet (contractParty.ts); null when none names one */
  promoter: ContractPartyFact | null
  /** The kind of file the promoter came from (a contract wins over a sheet) */
  promoterKind?: ShowFileKind
  /** An invoice we wrote for the show (ownInvoice.ts); null when there is none */
  invoice: OwnInvoiceFact | null
  /** The show's date as a contract names it (ISO), '' when none does */
  contractDate: string
  /** The event as a contract names it ("Event/Veranstaltung: …"), '' when none does */
  eventName?: string
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
    countryCode: '',
    capacity: null,
    merchFeeCents: null,
    notes: [],
    kind: null
  },
  hotel: { name: '', street: '', zipCode: '', city: '', countryCode: '', notes: [] },
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
    .flatMap(splitPairs)
    .map((segment) => cleanText(segment.replace(/^[|\s]+|[|\s]+$/g, '')))
    .filter((segment) => segment.length > 0 && !/^_+$/.test(segment))
}

/**
 * "Datum:   25.08.2023   Stadt: Musterstadt" → two segments: a form's columns lie on one line,
 * set apart by spaces only. Only a line that starts with a label is split, before each further
 * label behind two spaces or more ("Kapazität:   500   Duschen:   ja").
 */
function splitPairs(line: string): string[] {
  if (!/^\s*[\p{L}][^:]{0,39}:(\s|$)/u.test(line)) return [line]
  const pieces = line.split(/\s{2,}(?=[\p{L}](?:[\p{L}./()&-]|\s(?!\s)){0,30}?:(?:\s|$))/u)
  const out: string[] = []
  for (const piece of pieces) {
    const last = out.length - 1
    if (last >= 0 && !out[last].includes(':')) out[last] = `${out[last]} ${piece}`
    else out.push(piece)
  }
  return out
}

/**
 * Words a PDF tore apart, in a name: "Eventmanagemen t" → "Eventmanagement", "Sp inler" →
 * "Spinler", "Op en Air" → "Open Air". Only a lone small letter at a word's end and a capital
 * with at most one letter before a small word are joined; short words of their own ("Am", "In")
 * stay.
 */
export function mendWords(value: string): string {
  return cleanText(value)
    .replace(/(\p{L}{2,}) (\p{Ll})(?=[\s,]|$)/gu, '$1$2')
    .replace(
      /(^|\s)(\p{Lu}\p{Ll}?) (\p{Ll}{2,})/gu,
      (match, lead: string, head: string, tail: string) =>
        /^(am|an|im|in|zu|um|ab|ob|so|da|wo|es|er|de|la|le|el|of|on|at|to|by|vs)$/i.test(head)
          ? match
          : `${lead}${head}${tail}`
    )
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
  return EMAIL.exec(joinSpacedDomain(segment))?.[0]?.toLowerCase() ?? ''
}

/** "info@muster - openair.example" → "info@muster-openair.example": PDFs space out hyphens */
export function joinSpacedDomain(value: string): string {
  return value.replace(/(@|https?:\/\/|www\.)\S*(?:\s+[-.]\s+\S+)+/gi, (match) =>
    match.replace(/\s+/g, '')
  )
}

const phoneOf = (segment: string): string => {
  const match = PHONE.exec(segment.replace(EMAIL, ' '))
  return match ? cleanText(match[0]).replace(/[.]/g, ' ') : ''
}

/** "Venue: Name (new adress!!)" → "Name" */
const stripRemark = (value: string): string =>
  cleanText(value.replace(/\([^)]*\)/g, ' ').replace(/[!]+/g, ''))

/** "12345 Musterstadt" → zip and city */
function zipCity(value: string): { zipCode: string; city: string; countryCode: string } | null {
  const match = /(?:\b([A-Z]{1,2})-)?\b(\d{4,5})\s+([A-Za-zÄÖÜäöüß][\p{L} .-]+)/u.exec(
    joinDigits(value)
  )
  return match ? zipCityOf(`${match[1] ? `${match[1]}-` : ''}${match[2]} ${match[3]}`) : null
}

/**
 * A place's address in order: "Musterweg 11, 12345 Musterstadt" written into the street is split,
 * the country taken from the zip (five digits: Germany) when no line names one
 */
function settleAddress(place: PlaceFact): void {
  if (!place.street && !place.zipCode) return
  const parsed = parseAddress(
    [place.street, `${place.zipCode} ${place.city}`.trim()].filter(Boolean).join('\n')
  )
  if (parsed.street) place.street = `${parsed.street} ${parsed.streetNumber}`.trim()
  if (parsed.zipCode) {
    place.zipCode = parsed.zipCode
    place.city = parsed.city
  }
  place.countryCode ||= parsed.countryCode
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
const ON_SITE = /vor ort|\bvenue\b|day of show|on site|local contact|\bdos\b|betreuer|betreuung/

/** A festival's site rather than its name ("Sportgelände Musterdorf", "Festwiese") */
const SITE = /gelaende|sportplatz|stadion|festplatz|festwiese|wiese\b|freibad|schulhof|marktplatz/

/** "Infosheet für Bands des Muster Open Air": the festival a sheet is headed with */
const HEADING_FESTIVAL =
  /(?:^|\s)(?:des|der|vom|zum|beim|für das|fuer das|at)\s+((?:[\p{Lu}\d][\p{L}\d'.&-]*\s+){0,4}(?:[Oo]pen\s?[Aa]ir|OPEN AIR|[Ff]estival|FESTIVAL|[Ff]est)(?:\s+\d{4})?)\s*$/u

/** "Musterweg 11" alone on a line, below a "Veranstaltungsort:" */
const STREET_LINE = /^[\p{L}][\p{L} .'-]*\s\d+\s?[a-z]?$/u

/** The words of a running order line that make it another item of the day, not the show */
const NOT_A_SHOW =
  /getin|soundcheck|linecheck|loadin|loadout|dinner|essen|doors|einlass|curfew|aufbau|umbau|abbau|interview|meet|signing|catering|check|ankunft|arrival|together|abfahrt|departure|hotel|fahrzeit|changeover/

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
  if (
    /gastspielvertrag|konzertvertrag|auftrittsvertrag|kuenstlervertrag|vertragspartner/.test(
      text
    ) ||
    (/\bvertrag(es)?\b/.test(text) && /kuenstler|engagement/.test(text))
  )
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
function readTime(
  facts: ShowFacts,
  segment: string,
  bandKey: string,
  state: { showEnd: string }
): void {
  const time = timeOf(segment)
  if (!time) return
  const label = time.label
  if (!label) return
  const main = mentions(label, bandKey)
  const rest = cleanText(` ${label} `.replace(` ${bandKey} `, ' '))
  const set = (key: ItineraryKey, value: string) => {
    if (value && !facts.itinerary[key]) facts.itinerary[key] = value
  }
  const other = !main && /[a-z]{3,}/.test(rest)

  // "Umbau und Soundcheck 17:55": the sound check counts, though the change over is named too
  if (/sound ?check|line ?check/.test(label)) {
    const named = /[a-z]{3,}/.test(
      rest.replace(/sound ?check|line ?check|umbau|change ?over|und|and/g, '')
    )
    if (main || !named) set('soundCheckMainAct', time.start)
    else set('soundCheckSupport', time.start)
    return
  }
  if (IGNORED_TIME_LABELS.some((word) => label.includes(word))) return
  if (/\bget ?in\b|\bget-in\b|\baufbau\b/.test(label)) {
    if (main || !/[a-z]{3,}/.test(rest.replace(/get ?in|aufbau/g, ''))) set('getIn', time.start)
    return
  }
  if (/\bload ?in\b|\bladen\b/.test(label)) return set('loadIn', time.start)
  // a festival's sheet for one act: "Auftrittsbeginn 18:50", "Auftrittsende 19:35"
  if (
    /auftrittsbeginn|showbeginn|spielbeginn|beginn (des )?auftritt|show ?start|stage ?time/.test(
      label
    )
  ) {
    set('showTimeMainAct', time.start)
    if (time.minutes) set('showLength', String(time.minutes))
    return
  }
  if (/auftrittsende|showende|spielende|ende (des )?auftritt|show ?end/.test(label)) {
    state.showEnd ||= time.start
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

/**
 * A running order's line of the band: "MAIN 18:15 - 19:05 Beispielband", also with the letters
 * spaced apart ("M A I N 1 8 : 1 5 - 1 9 : 0 5 B e i s p i e l b a n d"). Only a time range next
 * to the band's name, with nothing else of the day (soundcheck, doors) in the line.
 */
function readRunningOrder(facts: ShowFacts, segment: string, bandKey: string): void {
  const band = bandKey.replace(/ /g, '')
  if (band.length < 3 || facts.itinerary.showTimeMainAct) return
  const tight = keyOf(segment).replace(/ /g, '')
  if (!tight.includes(band)) return
  // letters spaced apart: most "words" are one character
  const tokens = segment.trim().split(/\s+/)
  const spaced = tokens.filter((token) => token.length === 1).length > tokens.length * 0.6
  const time = timeOf(spaced ? segment.replace(/(?<=[\d:.])\s+(?=[\d:.])/g, '') : segment)
  if (!time?.end) return
  const words = tight.replace(band, '').replace(/[0-9]/g, '')
  if (NOT_A_SHOW.test(words)) return
  facts.itinerary.showTimeMainAct = time.start
  if (time.minutes) facts.itinerary.showLength ??= String(time.minutes)
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
    /tour ?manager|\btm\b|advancing|management|crew|foh|licht|merch|backline|vorproduktion/.test(
      key
    ) ||
    mentions(key, bandKey)
  )
    return 'band'
  if (
    /venue|club|festival|artist care|artist relations|artist liaison|gelaende|\bsite\b|stage manager|vor ort|production|produktion|booking|haus|halle|technik|executive|director|event|betreuer|betreuung|hauptverantwortlich|leitung/.test(
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
  if (words.some((word) => /^(gmbh|ug|ag|kg|ohg|gbr|e\.?v\.?|ltd\.?|inc\.?|llc|mbh)$/i.test(word)))
    return ''
  const name = words.filter((word) => /^[\p{Lu}][\p{L}'.-]*$/u.test(word))
  if (name.length < 2 || name.length > 4 || name.length !== words.length) return ''
  return mendWords(name.join(' ')).replace(/\.+$/, '')
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
  const state = { showEnd: '' }
  // address lines without a label below the venue's line
  let venueLines = 0

  // the festival a sheet is headed with ("Infosheet für Bands des Muster Open Air")
  for (const segment of segments.slice(0, 4)) {
    if (labelled(segment)) continue
    const heading = HEADING_FESTIVAL.exec(segment)?.[1] ?? ''
    const alone =
      segment.split(' ').length <= 6 &&
      !/\d/.test(segment) &&
      !/info|guide|sheet|rider|techni|plan|ablauf|order|liste|specs/i.test(segment) &&
      placeKindOfName(segment) === 'festival'
        ? segment
        : ''
    const name = cleanPlaceName(heading || (isTitleCase(alone) ? alone : ''))
    if (name) {
      facts.venue.name = name
      facts.venue.kind = 'festival'
      break
    }
  }

  // lines left of the band's own block ("Beispielband GbR", street, town): its address
  let ownLines = 0
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    const key = keyOf(segment)
    const pair = labelled(segment)

    if (bandKey && mentions(key, bandKey) && !TIME.test(segment)) ownLines = 4
    else if (ownLines > 0) {
      ownLines--
      if (!pair && (isStreetLine(segment) || zipCity(segment))) continue
    }

    if (venueLines > 0) {
      // "(Zufahrt über den Beispielring)" between the street and the town: skipped
      if (!pair && /^\(.*\)$/.test(segment)) continue
      venueLines--
      if (!pair && section !== 'hotel') {
        if (STREET_LINE.test(stripRemark(segment)) && !facts.venue.street) {
          facts.venue.street = stripRemark(segment)
          continue
        }
        const place = /^\d{4,5}\s/.test(joinDigits(segment)) ? zipCity(segment) : null
        if (place) {
          if (!facts.venue.zipCode) Object.assign(facts.venue, place)
          venueLines = 0
          continue
        }
      }
      venueLines = 0
    }

    // sections
    if (/^hotel\s*:/i.test(segment)) {
      section = 'hotel'
      const hotel = stripRemark(segment.replace(/^hotel\s*:/i, '')).replace(/[.,;:]+$/, '')
      facts.hotel.name = isPlaceholder(hotel) || hotel.split(' ').length > 8 ? '' : hotel
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
      if (section !== 'hotel' && kind !== 'mail') readRunningOrder(facts, segment, bandKey)
      if (section !== 'hotel' && TIME.test(segment)) readTime(facts, segment, bandKey, state)
      if (kind === 'mail') {
        const uhr = uhrOf(segment)
        if (uhr && /einlass|doors/.test(key) && !facts.itinerary.doors) facts.itinerary.doors = uhr
        if (uhr && /beginn|start/.test(key) && !facts.start) facts.start = uhr
      }
    }

    // a full address on a line of its own, below "Anreise zum Festivalgelände", "Location:" …
    // (only on sheets: a contract names the act's own address in running text)
    if (
      !pair &&
      kind !== 'contract' &&
      section !== 'hotel' &&
      !facts.venue.street &&
      /\d/.test(segment) &&
      segment.length <= 90
    ) {
      // "Gelände hinter Musterweg 33, 12345 Musterstadt"
      const parsed = parseAddress(segment.replace(/^gel(ä|ae)nde\s+(hinter|neben|vor)\s+/i, ''))
      const before = segments
        .slice(Math.max(0, index - 2), index)
        .map((line) => keyOf(line))
        .join(' ')
      if (
        parsed.streetNumber &&
        parsed.zipCode &&
        /gelaende|anfahrt|anreise|venue|location|veranstaltungsort|spielort|anschrift|adresse|navi|google/.test(
          before
        ) &&
        !/veranstalter|verein|rechnung|hotel|unterkunft/.test(before)
      ) {
        facts.venue.street = `${parsed.street} ${parsed.streetNumber}`
        facts.venue.zipCode = parsed.zipCode
        facts.venue.city = parsed.city
        facts.venue.countryCode ||= parsed.countryCode
        continue
      }
    }

    // places
    const target = section === 'hotel' ? facts.hotel : facts.venue
    // "Venueadresse:", "Adresse der Location:", "Veranstaltungsgelände Adresse:": the venue's address
    const placeAddress =
      pair !== null &&
      section !== 'hotel' &&
      /(adresse|address|anschrift)$|^(adresse|anschrift) (der|des) (location|venue|gelaende|veranstaltungsorts?)/.test(
        pair[0].replace(/ (der|des) (location|venue|gelaende|veranstaltungsorts?)$/, '')
      ) &&
      /venue|location|gelaende|veranstaltungsort|spielort|buehne|club|halle/.test(pair[0])
    if (placeAddress && pair) {
      const parsed = parseAddress(pair[1])
      if (parsed.zipCode || parsed.streetNumber) {
        if (!facts.venue.street && parsed.street)
          facts.venue.street = `${parsed.street} ${parsed.streetNumber}`.trim()
        if (!facts.venue.zipCode && parsed.zipCode) {
          facts.venue.zipCode = parsed.zipCode
          facts.venue.city = parsed.city
        }
        facts.venue.countryCode ||= parsed.countryCode
      } else if (pair[1] && !facts.venue.street && !/\d/.test(pair[1]) && !isPlaceholder(pair[1])) {
        // a street without a number, the town on the lines below
        facts.venue.street = stripRemark(pair[1])
      }
      venueLines = 2
      continue
    }
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
        !/http/.test(value) &&
        !isPlaceholder(value)
      ) {
        const placeLabel = startsWithAny(label, [
          'veranstaltungsort',
          'spielort',
          'auffuehrungsort',
          'location',
          'spielstaette'
        ])
        // "Veranstaltungsort: 12345 Musterstadt" is the town, not a name; "Musterweg 5 12345
        // Musterstadt" its address
        const full = placeLabel ? parseAddress(value) : null
        if (full?.zipCode && full.streetNumber) {
          if (!facts.venue.zipCode) {
            facts.venue.street ||= `${full.street} ${full.streetNumber}`
            facts.venue.zipCode = full.zipCode
            facts.venue.city = full.city
            facts.venue.countryCode ||= full.countryCode
          }
          venueLines = 0
          continue
        }
        const town = placeLabel ? zipCityOf(value) : null
        // a festival's site ("Veranstaltungsort: Sportgelände Musterdorf") is no name of it, and
        // in a contract the place lines name the town and the site; the event names the show
        const site =
          placeLabel &&
          !town &&
          ((SITE.test(keyOf(value)) && placeKindOfName(value) !== 'festival') ||
            (kind === 'contract' && placeKindOfName(value) !== 'festival'))
        if (town) {
          if (!facts.venue.zipCode) {
            facts.venue.zipCode = town.zipCode
            facts.venue.city = town.city
            facts.venue.countryCode ||= town.countryCode
          }
        } else if (site) {
          const name = cleanPlaceName(value) || stripRemark(value)
          // a contract's "Veranstaltungsort: Musterstadt" (a town alone) is no site
          const isTown = kind === 'contract' && startsWithAny(label, ['veranstaltungsort'])
          if (isTown) facts.venue.city ||= name
          else {
            const note = `Gelände: ${name}`
            if (!facts.venue.notes.includes(note)) facts.venue.notes.push(note)
          }
          if (SITE.test(keyOf(value))) facts.venue.kind ??= 'festival'
        } else {
          facts.venue.name ||= cleanPlaceName(value)
          // "Open Air am Berg, Musterweg 1, 12345 Musterstadt": the address behind the name
          const behind = value.includes(',')
            ? parseAddress(value.slice(value.indexOf(',') + 1))
            : null
          if (behind?.zipCode && !facts.venue.zipCode) {
            facts.venue.street ||= `${behind.street} ${behind.streetNumber}`.trim()
            facts.venue.zipCode = behind.zipCode
            facts.venue.city = behind.city
            facts.venue.countryCode ||= behind.countryCode
          }
        }
        venueLines = 2
        if (startsWithAny(label, ['festival', 'festivalgelaende'])) facts.venue.kind ??= 'festival'
        else if (startsWithAny(label, ['club'])) facts.venue.kind ??= 'venue'
      } else if (
        section !== 'hotel' &&
        /^(event|veranstaltung|eventveranstaltung|festivalname|veranstaltungsname)$/.test(
          label.replace(/ /g, '')
        ) &&
        placeKindOfName(mendWords(value)) === 'festival'
      ) {
        // "Event: Muster Open Air" names the festival, whatever a venue line said
        const name = cleanPlaceName(value)
        if (name && placeKindOfName(facts.venue.name) !== 'festival') facts.venue.name = name
        facts.venue.kind ??= 'festival'
      } else if (startsWithAny(label, ['street', 'strasse', 'str', 'adresse', 'address'])) {
        // "Musterweg 11 // 12345 Musterstadt", "Musterweg 11, 12345 Musterstadt"
        const [street, rest] = stripRemark(value).split(/\s*(?:\/\/|,)\s*(?=\d{4,5}\s)/)
        if (!value && section !== 'hotel' && !facts.venue.street) venueLines = 2
        if (!isPlaceholder(street)) target.street ||= street
        const place = rest ? zipCity(rest) : null
        if (place && !target.zipCode) Object.assign(target, place)
      } else if (
        startsWithAny(label, ['town', 'stadt', 'ort', 'city', 'plz ort', 'zip code city'])
      ) {
        const place = zipCity(value)
        if (place && !target.zipCode) Object.assign(target, place)
        // "PLZ: 12345" on a line before: the town is the one that follows it
        else if (!place && target.zipCode && !target.city && /^[\p{L}][\p{L} .-]+$/u.test(value))
          target.city = cleanText(value)
      } else if (/^(land|country|staat)$/.test(label)) {
        const code = /^[A-Z]{2}$/.test(value) ? value : countryCodeOfName(value)
        if (code) target.countryCode ||= code
      } else if (/^(plz|zip|zip code|postleitzahl)$/.test(label) && /^\d{4,5}$/.test(value)) {
        if (!target.zipCode) {
          target.zipCode = value
          target.city = ''
        }
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
        if (label === 'name') facts.venue.name ||= cleanPlaceName(spec[2])
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
        const role = mendWords(segment.split(':')[0])
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
    // "Veranstaltungsleitung: Erika Muster", then the phone and the e-mail on lines of their own
    if (pair && pair[1] && !email && !phone) {
      const name = nameOf(pair[1])
      let mail = ''
      let tel = ''
      for (let next = index + 1; name && next < Math.min(segments.length, index + 3); next++) {
        const nextPair = labelled(segments[next])
        if (
          nextPair &&
          !/^(phone|tel|telefon|mobil|handy|fon|mail|e mail|email)$/.test(nextPair[0])
        )
          break
        const line = joinSpacedDomain(nextPair ? nextPair[1] : segments[next])
        const lineMail = emailOf(line, file.links)
        const linePhone = lineMail ? '' : phoneOf(line)
        // nothing else on the line but the number or the address
        if (cleanText(line.replace(EMAIL, ' ').replace(PHONE, ' ')).length > 2) break
        mail ||= lineMail
        tel ||= linePhone
      }
      if (mail || tel) {
        const role = mendWords(segment.split(':')[0])
        const side = sideOf(role, kind, bandKey)
        addContact(facts, {
          role,
          name,
          email: mail,
          phone: tel,
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
  // "POSTWEG" named as the place and as its street: a street, no name
  if (facts.venue.name && keyOf(facts.venue.name) === keyOf(facts.venue.street))
    facts.venue.name = ''
  // a settlement or an invoice names the parties (the band, the promoter), never the venue
  if (kind === 'settlement' || kind === 'invoice') {
    Object.assign(facts.venue, { street: '', zipCode: '', city: '', countryCode: '' })
    Object.assign(facts.hotel, { street: '', zipCode: '', city: '', countryCode: '' })
  }
  // "Tour Manager Beispielband …" is the band's own person
  if (bandKey)
    for (const contact of facts.contacts)
      if (mentions(keyOf(contact.name), bandKey) || mentions(keyOf(contact.role), bandKey))
        contact.side = 'band'
  settleAddress(facts.venue)
  settleAddress(facts.hotel)
  // "Auftrittsbeginn 18:50" … "Auftrittsende 19:35": the length of the show
  const begin = facts.itinerary.showTimeMainAct
  if (begin && state.showEnd && !facts.itinerary.showLength) {
    const toMin = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
    const minutes = (toMin(state.showEnd) - toMin(begin) + 24 * 60) % (24 * 60)
    if (minutes > 0 && minutes <= 300) facts.itinerary.showLength = String(minutes)
  }
  facts.venue.kind ??= placeKindOfName(facts.venue.name) ?? placeKindOfText(file.text)
  return facts
}

/**
 * The festival's name as the archive's folder spells it: "Bik er Days" in a contract and the
 * folder "Musterstadt - Seepark Biker Days" give "Biker Days". With no name in the files, the
 * folder's own when it names a festival ("… Open Air").
 */
export function placeNameOf(found: string, folder: string, eventName = ''): string {
  const title =
    folder
      .split(/\s[-–]\s/)
      .pop()
      ?.trim() ?? ''
  const tight = (value: string) => keyOf(value).replace(/ /g, '')
  /** The words of `text` that spell `want` (spaces aside), '' when none do */
  const spelled = (text: string, want: string): string => {
    // words only: a dash between town and name is none
    const words = text.split(/\s+/).filter((word) => /[\p{L}\d]/u.test(word))
    for (let start = 0; start < words.length; start++)
      for (let end = start + 1; end <= words.length; end++) {
        const part = words.slice(start, end).join(' ')
        if (tight(part) === want) return part
      }
    return ''
  }
  // "Musterdorf Rock im Beispiel" and a contract's "Event: Rock im Beispiel": the event, as the
  // folder spells it, beats a site a sheet named ("Acker Musterdorf")
  const event = tight(eventName)
  if (event.length >= 4) {
    const part = spelled(folder, event)
    if (part) return part
  }
  if (!found) return placeKindOfName(title) === 'festival' ? title : ''
  return spelled(title, tight(found)) || found
}

/** Small words a title-case name keeps in lower case ("Rock am Beispielsee", "Just for Fun") */
const NAME_SMALL_WORDS =
  /^(am|an|im|in|auf|bei|zum|zur|der|die|das|den|dem|des|und|vom|von|for|of|and|the|at|on|de|la|le|du)$/

/**
 * A club's or festival's name as files write it, cleaned: no quotes, no remark in brackets, no
 * label left in front ("FES TIVAL: …"), no edition number or year ("33. Muster Open Air 2024"),
 * no address behind it. '' when it is no name: a placeholder, a lower-case phrase ("head of
 * festival"), a sentence or a slogan.
 */
export function cleanPlaceName(raw: string): string {
  let value = cleanText(raw.replace(/[„“”"«»]/g, ' ').replace(/\([^)]*\)/g, ' '))
  value = value.replace(/^[\p{L} ]{1,24}:\s*/u, '')
  if (/www\.|https?:|@|\.(de|com|at|ch|eu|net|org)\b/i.test(value)) return ''
  value = value.replace(/^(?:\d\s?){1,3}\.\s*/, '').replace(/\s+(?:1\s?9|2\s?0)\s?\d\s?\d$/, '')
  // "Muster Open Air, Musterweg, 12345 Musterstadt": the name before the address
  value = value.split(/\s*,\s*/)[0] ?? ''
  value = mendWords(value)
    .replace(/[.,;:!-]+$/, '')
    .trim()
  if (!value || isPlaceholder(value) || /^\d{4,5}\s/.test(value)) return ''
  if (value.split(' ').length > 7 || !/^[\p{Lu}\d]/u.test(value)) return ''
  // "32", "FESTIVAL", "Location": no name
  if (!/\p{L}/u.test(value) || value.length < 2) return ''
  if (
    /^(festival|open air|openair|club|venue|location|halle|stage|buehne|gelaende|konzert|event)$/.test(
      keyOf(value)
    )
  )
    return ''
  return value
}

/** Title case: every word capitalised but the small ones ("Germany's biggest … Festival" is none) */
const isTitleCase = (value: string): boolean =>
  value.split(' ').every((word) => !/^\p{Ll}/u.test(word) || NAME_SMALL_WORDS.test(word))

/** Two spellings of one name, apart from the spaces a PDF put in */
export const sameName = (a: string, b: string): boolean =>
  keyOf(a).replace(/ /g, '') === keyOf(b).replace(/ /g, '')

/**
 * The facts of all files into one: each value from the first file that has it, in the order
 * day sheets, venue sheets, mails, the rest - the agency's own sheet is the most current.
 */
export function mergeShowFacts(
  items: ReadonlyArray<{ kind: ShowFileKind; facts: ShowFacts }>
): ShowFacts {
  const order: ShowFileKind[] = ['daysheet', 'venue_spec', 'mail', 'contract', 'other', 'rider']
  const rank = (kind: ShowFileKind) => {
    const index = order.indexOf(kind)
    return index < 0 ? order.length : index
  }
  const sorted = [...items].sort((a, b) => rank(a.kind) - rank(b.kind))
  const merged = emptyFacts()
  // the kind of file the venue's address was taken from
  let mergedFrom: ShowFileKind | null = null
  for (const { kind, facts } of sorted) {
    for (const key of ITINERARY_KEYS)
      if (!merged.itinerary[key] && facts.itinerary[key])
        merged.itinerary[key] = facts.itinerary[key]
    merged.start ||= facts.start
    // the address is one piece: street, zip, town and country come from the same file - a venue
    // sheet's (the venue's own) beats the rest, else the first file with a street and a zip
    const venueFacts = facts.venue
    const complete = venueFacts.street !== '' && venueFacts.zipCode !== ''
    const mergedComplete = merged.venue.street !== '' && merged.venue.zipCode !== ''
    if (
      (complete && (!mergedComplete || (kind === 'venue_spec' && mergedFrom !== 'venue_spec'))) ||
      (!merged.venue.street && !merged.venue.zipCode)
    ) {
      if (complete || venueFacts.street || venueFacts.zipCode) {
        merged.venue.street = venueFacts.street
        merged.venue.zipCode = venueFacts.zipCode
        merged.venue.city = venueFacts.city
        merged.venue.countryCode = venueFacts.countryCode
        mergedFrom = kind
      }
    }
    merged.venue.name ||= venueFacts.name
    if (!merged.venue.city && !merged.venue.zipCode) merged.venue.city = venueFacts.city
    for (const key of ['name', 'street', 'zipCode', 'city', 'countryCode'] as const)
      merged.hotel[key] ||= facts.hotel[key]
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
    // the contract names the promoter for sure; a sheet's only fills what it leaves empty
    const promoter = facts.promoter
    if (
      promoter &&
      (!merged.promoter || (kind === 'contract' && merged.promoterKind !== 'contract'))
    ) {
      const sheet = merged.promoter
      merged.promoter = { ...promoter }
      merged.promoterKind = kind
      if (sheet && sameName(sheet.name, promoter.name))
        for (const key of Object.keys(sheet) as Array<keyof typeof sheet>)
          merged.promoter[key] ||= sheet[key]
    } else if (promoter && merged.promoter && sameName(promoter.name, merged.promoter.name)) {
      for (const key of Object.keys(promoter) as Array<keyof typeof promoter>)
        merged.promoter[key] ||= promoter[key]
    }
    merged.invoice ??= facts.invoice
    merged.contractDate ||= facts.contractDate
    merged.eventName ||= facts.eventName ?? ''
    for (const contact of facts.contacts) addContact(merged, { ...contact })
  }
  if (merged.venue.name && keyOf(merged.venue.name) === keyOf(merged.venue.street))
    merged.venue.name = ''
  // values the service added after the files were read (a contract's town) get their country too
  settleAddress(merged.venue)
  settleAddress(merged.hotel)
  // a name that says festival ("… Open Air") decides; a club-like name ("Halle …") only fills in,
  // since festivals take place in halls too
  const byName = placeKindOfName(merged.venue.name)
  merged.venue.kind = byName === 'festival' ? byName : (merged.venue.kind ?? byName)
  return merged
}
